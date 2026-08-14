import type { Repo } from "@effected/github";
import { GitHubRepository, Ruleset as RulesetService } from "@effected/github";
import { Effect, Option } from "effect";
import { fingerprint } from "../../lib/fingerprint.js";
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

const KIND = "settings";

/**
 * A repository has exactly one settings resource, so its drift key is fixed.
 *
 * @remarks
 * The alternative — one resource per field — would report twenty drift lines
 * for one person toggling twenty checkboxes in the UI. Settings move together
 * and are reported together.
 */
const NAME = "settings";

/**
 * `security_and_analysis` fields GitHub only accepts on organization-owned
 * repositories.
 *
 * @remarks
 * Sending one to a personal repository is rejected outright, taking the whole
 * PATCH with it — so they are stripped and reported rather than attempted.
 */
const ORG_ONLY_SAA_FIELDS: ReadonlySet<string> = new Set([
	"secret_scanning_delegated_alert_dismissal",
	"secret_scanning_delegated_bypass",
	"delegated_bypass_reviewers",
]);

/**
 * Settings fields only valid on organization-owned repositories.
 *
 * @remarks
 * Checkable from `ownerType` alone, which the engine already resolved — so
 * these cost nothing to gate.
 */
const ORG_ONLY_SETTINGS: ReadonlySet<string> = new Set<string>();

/**
 * Fields needing an organization owner **and** a private repository.
 *
 * @remarks
 * `allow_forking` lived in {@link ORG_ONLY_SETTINGS} and was gated on owner type
 * alone, which is half of GitHub's rule: it answers
 *
 * > Allow forks setting can only be changed on org-owned private repositories
 *
 * with a 422 that takes the **whole PATCH** with it — so one unsettable field
 * costs the repository every other setting in the same request.
 *
 * Visibility is not in the config and not in `ownerType`, so gating these means
 * asking GitHub. The read happens only when one of these fields actually
 * survives the merge, so a config that never mentions them never pays for it.
 */
const ORG_PRIVATE_ONLY_SETTINGS: ReadonlySet<string> = new Set(["allow_forking"]);

/** What the merge produced, before reviewer resolution. */
interface MergedSettings {
	readonly settings: Record<string, unknown>;
	readonly securityAndAnalysis: Record<string, unknown> | undefined;
	/** Org-only keys dropped because the owner is a personal account. */
	readonly skipped: ReadonlyArray<{ readonly where: string; readonly key: string; readonly reason: string }>;
	/** Fields that survived the merge and still need a live check before sending. */
	readonly conditional: ReadonlyArray<string>;
}

/**
 * Merge every settings group the repository's group references.
 *
 * @remarks
 * Last write wins, and `security_and_analysis` is merged separately: it is a
 * nested block, so `Object.assign` across groups would replace it wholesale
 * rather than merging its fields.
 */
const mergeSettings = (ctx: RepoContext): MergedSettings => {
	const refs = ctx.config.groups[ctx.group]?.settings ?? [];
	const settings: Record<string, unknown> = {};
	const saa: Record<string, unknown> = {};
	let sawSaa = false;

	for (const ref of refs) {
		const group = ctx.config.settings[ref];
		if (group === undefined) continue;
		const { security_and_analysis, ...rest } = group as Record<string, unknown> & {
			security_and_analysis?: Record<string, unknown>;
		};
		Object.assign(settings, rest);
		if (security_and_analysis !== undefined) {
			sawSaa = true;
			for (const [key, value] of Object.entries(security_and_analysis)) {
				if (value !== undefined) saa[key] = value;
			}
		}
	}

	const skipped: Array<{ readonly where: string; readonly key: string; readonly reason: string }> = [];

	if (ctx.ownerType === "User") {
		// A personal account fails both gates, so the private check below never
		// needs to run for one.
		for (const key of ORG_PRIVATE_ONLY_SETTINGS) {
			if (key in settings) {
				delete settings[key];
				skipped.push({ where: "setting", key, reason: "org-only, owner is a personal account" });
			}
		}
		for (const key of ORG_ONLY_SETTINGS) {
			if (key in settings) {
				delete settings[key];
				skipped.push({ where: "setting", key, reason: "org-only, owner is a personal account" });
			}
		}
		for (const key of ORG_ONLY_SAA_FIELDS) {
			if (key in saa) {
				delete saa[key];
				skipped.push({ where: "security_and_analysis", key, reason: "org-only, owner is a personal account" });
			}
		}
	}

	return {
		settings,
		securityAndAnalysis: sawSaa && Object.keys(saa).length > 0 ? saa : undefined,
		skipped,
		conditional: [...ORG_PRIVATE_ONLY_SETTINGS].filter((key) => key in settings),
	};
};

/**
 * Repository settings, over REST and the GraphQL mutation.
 *
 * @remarks
 * The whole settings block is one drift resource — see {@link NAME}.
 *
 * Delegated-bypass reviewers are config-level `{ team }` or `{ role }` names
 * that GitHub wants as numeric `reviewer_id`. Resolution happens here, before
 * the fingerprint is taken, so the fingerprint covers what was actually sent: a
 * team renamed under the same id must not read as drift, and a team pointing at
 * a different id must.
 *
 * @public
 */
export const settingsPhase = Effect.gen(function* () {
	const settingsClient = yield* GitHubRepository;
	const rulesets = yield* RulesetService;
	const cache = yield* RepoCache;
	const applied = yield* AppliedState;
	const logger = yield* SyncLogger;

	/** Turn `{ team }` / `{ role }` reviewer entries into `{ reviewer_id, reviewer_type }`. */
	const resolveReviewers = (
		ctx: RepoContext,
		reviewers: ReadonlyArray<Record<string, unknown>>,
	): Effect.Effect<
		{
			readonly resolved: ReadonlyArray<Record<string, unknown>>;
			readonly errors: ReadonlyArray<{ readonly context: string; readonly message: string }>;
		},
		never,
		Repo
	> =>
		Effect.gen(function* () {
			const resolved: Array<Record<string, unknown>> = [];
			const errors: Array<{ readonly context: string; readonly message: string }> = [];

			for (const reviewer of reviewers) {
				const entry: Record<string, unknown> = {};

				if (typeof reviewer.team === "string") {
					const slug = reviewer.team;
					const id = yield* cache.teamId(ctx.owner, slug, rulesets.teamId(slug)).pipe(
						Effect.map(Option.some),
						Effect.orElseSucceed(() => Option.none<number>()),
					);
					if (Option.isNone(id)) {
						errors.push({ context: `resolve team '${slug}'`, message: "could not resolve team slug" });
						continue;
					}
					entry.reviewer_id = id.value;
					entry.reviewer_type = "TEAM";
				} else if (typeof reviewer.role === "string") {
					const name = reviewer.role;
					const id = yield* rulesets.roleId(name).pipe(
						Effect.map(Option.some),
						Effect.orElseSucceed(() => Option.none<number>()),
					);
					if (Option.isNone(id)) {
						errors.push({ context: `resolve role '${name}'`, message: "could not resolve organization role" });
						continue;
					}
					entry.reviewer_id = id.value;
					entry.reviewer_type = "ROLE";
				} else {
					continue;
				}

				if (reviewer.mode !== undefined) entry.mode = reviewer.mode;
				resolved.push(entry);
			}

			return { resolved, errors };
		});

	const run = (ctx: RepoContext): Effect.Effect<PhaseResult, never, Repo> =>
		Effect.gen(function* () {
			const merged = mergeSettings(ctx);
			const errors: Array<{ readonly context: string; readonly message: string }> = [];

			const desired: Record<string, unknown> = { ...merged.settings };
			const skipped = [...merged.skipped];

			// The one live precondition check, paid for only when the config uses a
			// field that has one. `private` is not in the config and not implied by
			// owner type, so the alternative is a 422 that discards every other
			// setting in the same request.
			if (merged.conditional.length > 0) {
				const repository = yield* read(cache.repoPrivate(ctx.owner, ctx.repo, settingsClient.settings));
				if ("failed" in repository) {
					errors.push({ context: "settings", message: `could not read repository visibility: ${repository.failed}` });
				} else if (!repository.value) {
					for (const key of merged.conditional) {
						delete desired[key];
						skipped.push({ where: "setting", key, reason: "org-owned private repositories only; this one is public" });
					}
				}
			}

			for (const { where, key, reason } of skipped) {
				yield* logger.syncOperation("skip", where, key, `(${reason})`);
			}

			if (merged.securityAndAnalysis !== undefined) {
				const saa: Record<string, unknown> = { ...merged.securityAndAnalysis };
				const reviewers = saa.delegated_bypass_reviewers;
				if (Array.isArray(reviewers)) {
					const outcome = yield* resolveReviewers(ctx, reviewers as ReadonlyArray<Record<string, unknown>>);
					errors.push(...outcome.errors);
					saa.delegated_bypass_reviewers = outcome.resolved;
				}
				if (Object.keys(saa).length > 0) desired.security_and_analysis = saa;
			}

			if (Object.keys(desired).length === 0) {
				return { changes: [], errors };
			}

			const baselines = yield* applied.getMany(ctx.slug).pipe(Effect.orElseSucceed(() => new Map()));

			// There is no cheap read of "the settings GitHub currently has" that is
			// comparable to what we send — the PATCH surface and the GET surface
			// differ, and the GraphQL fields are not on the GET at all. So live is
			// taken to equal the last thing we applied, which makes the comparison
			// config-versus-applied. The consequence is honest and worth stating:
			// **this phase cannot detect settings drift**, only config change. A
			// baseline that exists and differs from the config reads as
			// `ConfigChanged`, never as `Drift`.
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

			// What the package actually sent, when it sent anything. A dry run has
			// no such answer — see the report below.
			let sent: ReadonlyArray<string> | undefined;

			if (!ctx.dryRun) {
				const outcome = yield* settingsClient.applySettings(desired).pipe(
					Effect.map(
						(applied) =>
							({ applied }) as
								| { applied: { rest: ReadonlyArray<string>; graphql: ReadonlyArray<string> } }
								| { failed: string },
					),
					Effect.catch((error: { readonly message?: string }) =>
						Effect.succeed({ failed: error.message ?? String(error) } as
							| { applied: { rest: ReadonlyArray<string>; graphql: ReadonlyArray<string> } }
							| { failed: string }),
					),
				);

				if ("failed" in outcome) {
					return { changes: [], errors: [...errors, { context: KIND, message: outcome.failed }] };
				}

				// Taken after `preparePatch`, so these are the keys that went on the
				// wire rather than the ones this phase asked for.
				sent = [...outcome.applied.rest, ...outcome.applied.graphql];

				// Only after the write landed: a fingerprint for settings we failed
				// to apply would make the next run believe they are in place.
				yield* applied.record({ repo: ctx.slug, kind: KIND, name: NAME }, desiredPrint, ctx.runId).pipe(Effect.ignore);
			}

			// On a real run these are the keys `applySettings` reports having sent,
			// after `preparePatch` dropped whatever GitHub would have rejected.
			//
			// A **dry run** never calls it, so there is nothing to report but the
			// request — which can still name a dependent key that a real run would
			// drop (`merge_commit_title` when `allow_merge_commit` is false). The
			// rule is not re-derived here: two copies of one rule that can drift
			// apart is the shape of the bugs the precondition pass removed, and a
			// reporting copy is worse because nothing fails when it diverges.
			yield* logger.settingsApplied(sent ?? Object.keys(desired));

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
		name: "settings",
		appliesTo: (ctx) => (ctx.config.groups[ctx.group]?.settings?.length ?? 0) > 0,
		run,
	} satisfies Phase;
});
