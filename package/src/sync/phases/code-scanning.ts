import type { Repo } from "@effected/github";
import { CodeScanning, WorkflowDispatch } from "@effected/github";
import { Effect, Option } from "effect";
import { fingerprint } from "../../lib/fingerprint.js";
import type { CodeScanningGroup, CodeScanningLanguage } from "../../schemas/config.js";
import { SyncLogger } from "../../services/SyncLogger.js";
import { AppliedState, lookup } from "../../store/AppliedState.js";
import { RepoCache } from "../../store/RepoCache.js";
import type { ChangeRecord } from "../../store/SyncJournal.js";
import { decide, isDrift, needsApply } from "../decide.js";
import type { Phase, PhaseResult, RepoContext } from "../phase.js";
import { read } from "./resource.js";

/**
 * Stands in for live state this phase cannot read.
 *
 * @remarks
 * `decide` needs three fingerprints, and GitHub exposes no read of these
 * resources comparable to what is written — the PATCH surface and the GET
 * surface differ, and some fields are not on the GET at all. So live is taken
 * to be the last applied value, and this sentinel covers the case where there
 * is no last applied value.
 *
 * It must never equal a real fingerprint. Using the desired fingerprint here
 * instead would make `FirstSync` compute `needsApply: desired !== live` as
 * `false` — and the very first sync of a repository would write nothing at all.
 *
 * The consequence, stated plainly: **this phase reports config change, not
 * drift.** A baseline that differs reads as `ConfigChanged`, never as `Drift`,
 * because there is no independent observation to attribute the difference to.
 */
const UNREADABLE = "\u0000unreadable";

const KIND = "code_scanning";

/** A repository has one default-setup configuration. */
const NAME = "default-setup";

/**
 * GitHub's repository language names mapped to CodeQL default-setup languages.
 *
 * @remarks
 * The two vocabularies differ: `listLanguages` reports `TypeScript`, CodeQL
 * wants `javascript-typescript`, and several source languages collapse onto one
 * analyzer. A language with no mapping is dropped from the detected set —
 * CodeQL cannot analyse it, so it cannot corroborate a configured language.
 */
const REPO_LANG_TO_CODEQL: Readonly<Record<string, string>> = {
	JavaScript: "javascript-typescript",
	TypeScript: "javascript-typescript",
	C: "c-cpp",
	"C++": "c-cpp",
	"C#": "csharp",
	Go: "go",
	Java: "java-kotlin",
	Kotlin: "java-kotlin",
	Python: "python",
	Ruby: "ruby",
	Swift: "swift",
};

/** Last-write-wins merge of the code scanning groups a repository references. */
const mergeCodeScanning = (ctx: RepoContext): CodeScanningGroup => {
	const refs = ctx.config.groups[ctx.group]?.code_scanning ?? [];
	const merged: Record<string, unknown> = {};

	for (const ref of refs) {
		const group = ctx.config.code_scanning[ref];
		if (group === undefined) continue;
		for (const [key, value] of Object.entries(group)) {
			if (value !== undefined) merged[key] = value;
		}
	}

	return merged as CodeScanningGroup;
};

/**
 * CodeQL default setup, gated by the languages GitHub actually detects.
 *
 * @remarks
 * Configuring a language the repository does not contain makes GitHub reject
 * the whole request, so the configured list is intersected with the detected
 * one and the difference is reported rather than sent. That read goes through
 * {@link RepoCache}, whose languages entry is deliberately short-lived — a repo
 * that just gained a language should start scanning it within the hour, not the
 * month.
 *
 * `actions` is checked against the repository's **workflow count** rather than
 * against its languages, because GitHub validates it and `listRepoLanguages`
 * cannot see it. Passing it through unconditionally — which this did — answers
 *
 * > One or more languages you selected are not present in the repository.
 *
 * with a 422 on a repository that has no workflows. The check runs only when
 * `actions` is actually configured.
 *
 * Historically it analysed workflow YAML rather
 * than a repository language, so `listLanguages` never reports it and filtering
 * on detection would remove it from every repository.
 *
 * @public
 */
export const codeScanningPhase = Effect.gen(function* () {
	const codeScanning = yield* CodeScanning;
	const workflows = yield* WorkflowDispatch;
	const cache = yield* RepoCache;
	const applied = yield* AppliedState;
	const logger = yield* SyncLogger;

	const run = (ctx: RepoContext): Effect.Effect<PhaseResult, never, Repo> =>
		Effect.gen(function* () {
			const merged = mergeCodeScanning(ctx);
			if (Object.keys(merged).length === 0) {
				return { changes: [], errors: [] };
			}

			const errors: Array<{ readonly context: string; readonly message: string }> = [];
			let desired: CodeScanningGroup = merged;

			if (merged.languages !== undefined) {
				const detected = yield* cache.repoLanguages(ctx.owner, ctx.repo, codeScanning.languages()).pipe(
					Effect.map(Option.some),
					Effect.orElseSucceed(() => Option.none<ReadonlyArray<string>>()),
				);

				if (Option.isNone(detected)) {
					errors.push({ context: "list repo languages", message: "could not read repository languages" });
				}

				const detectedCodeQL = new Set<string>();
				for (const language of Option.getOrElse(detected, () => [] as ReadonlyArray<string>)) {
					const mapped = REPO_LANG_TO_CODEQL[language];
					if (mapped !== undefined) detectedCodeQL.add(mapped);
				}

				// `actions` is not a repository language, so `listRepoLanguages` can
				// never confirm it. GitHub validates it against workflow files, so
				// that is what this asks — and only when it is configured, so a
				// config without `actions` costs nothing.
				const wantsActions = merged.languages.includes("actions" as CodeScanningLanguage);
				const hasWorkflows = wantsActions
					? yield* read(
							cache.repoWorkflows(
								ctx.owner,
								ctx.repo,
								// Only workflows that are FILES in the repository.
								//
								// Configuring default setup makes GitHub add a synthetic
								// workflow of its own — `CodeQL`, at
								// `dynamic/github-code-scanning/codeql` — which is not a file
								// and appears in this listing. Counting it makes the check
								// satisfy itself: a repository with no workflows drops
								// `actions` on the first run, CodeQL's own workflow appears,
								// and every run after that sees "a workflow" and sends
								// `actions` on the strength of an artifact we created.
								//
								// The synthetic workflow also SURVIVES setting default setup
								// back to `not-configured`, so a repository that was ever
								// configured reports it forever — the path filter is not a
								// nicety, it is the only correct reading of this listing.
								//
								// State is deliberately not filtered. Verified live: one
								// `disabled_manually` workflow is accepted, zero workflows is
								// 422, and the synthetic one alone is 422. GitHub's rule is the
								// path, so narrowing to `active` here would 422 exactly the
								// repositories that park a workflow instead of deleting it.
								Effect.map(
									workflows.list,
									(found) => found.filter((workflow) => workflow.path.startsWith(".github/workflows/")).length,
								),
							),
						)
					: { value: 0 };

				const filtered: CodeScanningLanguage[] = [];
				for (const language of merged.languages) {
					if (language === "actions") {
						if ("failed" in hasWorkflows) {
							errors.push({
								context: "code_scanning",
								message: `could not count workflows: ${hasWorkflows.failed}`,
							});
						} else if (hasWorkflows.value > 0) {
							filtered.push(language);
						} else {
							yield* logger.syncOperation("skip", "code_scanning language", language, "(no workflow files)");
						}
						continue;
					}

					if (detectedCodeQL.has(language)) {
						filtered.push(language);
					} else {
						yield* logger.syncOperation("skip", "code_scanning language", language, "(not detected in repository)");
					}
				}

				// Every configured language was filtered out, so there is nothing
				// left to configure. Sending `state: configured` with an empty list
				// is a request GitHub cannot satisfy — the same 422 the filtering
				// exists to avoid, arrived at from the other direction.
				if (filtered.length === 0) {
					yield* logger.syncOperation(
						"skip",
						"code_scanning",
						NAME,
						"(no configured language is present in this repository)",
					);
					return { changes: [], errors };
				}

				desired = { ...merged, languages: filtered };
			}

			const baselines = yield* applied.getMany(ctx.slug).pipe(Effect.orElseSucceed(() => new Map()));

			// The default-setup GET reports a status rather than the configuration
			// that produced it, so — as with settings — live is taken to equal the
			// last applied value. This phase reports config change, not drift.
			const baseline = Option.map(lookup(baselines, KIND, NAME), (record) => record.fingerprint);
			const desiredPrint = fingerprint(desired);
			const decision = decide(
				desiredPrint,
				Option.getOrElse(baseline, () => UNREADABLE),
				baseline,
			);

			if (isDrift(decision)) {
				yield* logger.driftDetected(KIND, NAME, decision);
			}

			if (!needsApply(decision)) {
				return { changes: [], errors };
			}

			if (!ctx.dryRun) {
				const failure = yield* codeScanning.configure(desired).pipe(
					Effect.as(Option.none<string>()),
					Effect.catch((error: { readonly message?: string }) =>
						Effect.succeed(Option.some(error.message ?? String(error))),
					),
				);

				if (Option.isSome(failure)) {
					return {
						changes: [],
						errors: [...errors, { context: "code_scanning default setup", message: failure.value }],
					};
				}

				yield* applied.record({ repo: ctx.slug, kind: KIND, name: NAME }, desiredPrint, ctx.runId).pipe(Effect.ignore);
			}

			yield* logger.syncOperation("sync", KIND, desired.state ?? NAME);

			const changes: ChangeRecord[] = [
				{
					repo: ctx.slug,
					kind: KIND,
					name: NAME,
					action: isDrift(decision) ? "drift-overwritten" : "updated",
				},
			];

			return { changes, errors };
		});

	return {
		name: "code-scanning",
		appliesTo: (ctx) => (ctx.config.groups[ctx.group]?.code_scanning?.length ?? 0) > 0,
		run,
	} satisfies Phase;
});
