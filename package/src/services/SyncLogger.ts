import { Context, Effect, Layer, Ref } from "effect";
import type { Decision } from "../sync/decide.js";

/** A drift decision, the only variant this service reports specially. */
type DriftDecision = Extract<Decision, { readonly _tag: "Drift" }>;

/** One failure, held until {@link SyncLoggerShape.finish} summarises them. */
interface SyncErrorRecord {
	readonly repo: string;
	readonly context: string;
	readonly message: string;
}

/**
 * Everything the sync pipeline can say.
 *
 * @public
 */
export interface SyncLoggerShape {
	/** Header for a group of repositories. */
	/**
	 * Header for one group.
	 *
	 * @param selected - how many repositories this run will act on.
	 * @param declared - how many the group declares. When a `--repo` filter
	 * narrows the run these differ, and printing only one of them is what made a
	 * filtered run read as `(3 repos)` above a `1 repo(s)` summary.
	 */
	readonly groupStart: (name: string, selected: number, declared: number) => Effect.Effect<void>;
	/** Header for one repository, and the repo errors are attributed to. */
	readonly repoStart: (owner: string, repo: string) => Effect.Effect<void>;
	/** The settings PATCH landed. */
	/**
	 * The settings write landed.
	 *
	 * @param fields - the keys actually sent, after gating and dependent-key
	 * dropping. Named because a dry run that says only "would apply settings"
	 * cannot be reviewed: the whole reason to read one is to see whether a
	 * conditional field survived, and that is exactly what the summary hid.
	 */
	readonly settingsApplied: (fields: ReadonlyArray<string>) => Effect.Effect<void>;
	/** How many of one resource were removed, and which. */
	readonly cleanupSummary: (resource: string, count: number, names: string[]) => Effect.Effect<void>;
	/** One resource-level operation. Verbose and below. */
	readonly syncOperation: (
		verb: "sync" | "apply" | "delete" | "skip",
		resource: string,
		name: string,
		detail?: string,
		source?: string,
	) => Effect.Effect<void>;
	/**
	 * Someone changed a resource outside reposets since the last run.
	 *
	 * @remarks
	 * Visible at `info` — see {@link SyncLogger} for why this outranks the
	 * ordinary change lines.
	 */
	readonly driftDetected: (resource: string, name: string, drift: DriftDecision) => Effect.Effect<void>;
	/** A failure, reported inline and again in the closing summary. */
	readonly syncError: (context: string, message: string) => Effect.Effect<void>;
	/** The closing line, listing every error the run accumulated. */
	readonly finish: () => Effect.Effect<void>;
}

/**
 * How a run is configured to talk.
 *
 * @public
 */
export interface SyncLoggerConfig {
	/** Whether this run writes anything. Changes every verb. */
	readonly dryRun: boolean;
	/**
	 * Add the diagnostic annotations: where a value came from, and the applied
	 * and live fingerprints behind a drift report.
	 *
	 * @remarks
	 * Suffixes on lines that print either way, never lines of their own — which
	 * is why this is a flag you reach for while diagnosing something rather than
	 * a level stored in the config file.
	 */
	readonly debug: boolean;
}

/** Plural forms the naive `+ "s"` gets wrong. */
function pluralize(resource: string, count: number): string {
	if (count === 1) return resource;
	if (resource === "ruleset") return "rulesets";
	if (resource === "security feature") return "security features";
	if (resource === "code scanning") return "code scanning";
	return `${resource}s`;
}

/**
 * Dry-run-aware output for the sync pipeline.
 *
 * @remarks
 * Every line a run prints goes through here, so `SyncEngine` describes what
 * happened and this service decides how to say it.
 *
 * **There are no verbosity tiers.** There were four — `silent`, `info`,
 * `verbose`, `debug` — and enumerating what they actually gated is what
 * retired them: `verbose` guarded exactly one call site, the per-resource
 * operation line, which is the entire content of a sync. So the boundary did
 * not fall between summary and detail; it fell between *settings* and
 * everything else, and a dry run at the default tier reported a change count
 * with four fifths of the list suppressed.
 *
 * `silent` was worse: it suppressed errors too, so a failing run printed
 * nothing at all and the exit code was the only signal. Redirecting stdout does
 * that job better, because errors go to stderr and survive it.
 *
 * What remains is one output, plus `debug` for two diagnostic suffixes.
 *
 * **Drift outranks everything else a run reports.** `synced 3 secrets` says
 * reposets did its job; a drift line says *someone else* changed the repository
 * and reposets has just overwritten them. That is the one thing a human needs to
 * see without asking for it, so it is emitted at `info` alongside the summaries
 * rather than at `verbose` with the per-resource operations, and it is worded as
 * an observation about a person rather than as an action by the tool.
 *
 * Drift is reported even when nothing was written — the case where an
 * out-of-band edit happens to match the config. The tool has no work to do; the
 * human still changed something, and staying quiet would hide it.
 *
 * Lines are emitted with `Effect.log`, never `Console.log`: the CLI entrypoint
 * installs a logger that routes Effect's output, and a direct console write
 * would bypass both it and the filtering above.
 *
 * @public
 */
export class SyncLogger extends Context.Service<SyncLogger, SyncLoggerShape>()("reposets/SyncLogger") {}

/**
 * Build a live logger for one run.
 *
 * @remarks
 * A factory rather than a bare layer because both settings are per-invocation:
 * they come from the `--dry-run` and `--debug` flags, which are only known once
 * the command has parsed.
 *
 * @public
 */
export function SyncLoggerLive(config: SyncLoggerConfig): Layer.Layer<SyncLogger> {
	const { dryRun, debug } = config;

	return Layer.effect(
		SyncLogger,
		Effect.gen(function* () {
			const errors = yield* Ref.make<SyncErrorRecord[]>([]);
			const currentRepo = yield* Ref.make<string>("");

			const emit = (line: string): Effect.Effect<void> => Effect.log(line);

			/**
			 * Failures, on the error channel.
			 *
			 * @remarks
			 * v3 put these on stdout with everything else. They move to stderr —
			 * where the CLI entrypoint routes `logError` — so that
			 * `reposets sync > log.txt` still shows failures on the terminal while
			 * the log captures progress. A deliberate change to piping behavior,
			 * permitted because CLI output compatibility is not a goal of the
			 * rebuild.
			 */
			const emitError = (line: string): Effect.Effect<void> => Effect.logError(line);

			/**
			 * Pad a verb so the content after it lines up. Past-tense verbs pad to
			 * 8; the dry-run `would <present>` forms pad to 14. The result is
			 * concatenated directly, with no separating space.
			 */
			const formatVerb = (pastTense: string, presentTense: string): string =>
				dryRun ? `would ${presentTense}`.padEnd(14) : pastTense.padEnd(8);

			return {
				groupStart: (name, selected, declared) => {
					// Say both numbers when a filter narrowed the run, so the header and
					// the summary agree about what happened. The noun agrees with the
					// number nearest it — "1 of 3 repos", not "1 of 3 repo".
					const scope =
						selected === declared
							? `${selected} ${selected === 1 ? "repo" : "repos"}`
							: `${selected} of ${declared} ${declared === 1 ? "repo" : "repos"}`;
					return emit(`group: ${name} (${scope})`);
				},

				repoStart: (owner, repo) => {
					const repoSlug = `${owner}/${repo}`;
					// Tracked as well as printed: errors are attributed to whichever
					// repository was current when they happened.
					return Ref.set(currentRepo, repoSlug).pipe(Effect.andThen(emit(`  repo: ${repoSlug}`)));
				},

				settingsApplied: (fields) => {
					const named = [...fields].sort();
					// Long groups get a count rather than a wrapped wall of keys; the
					// a long list is summarised rather than wrapped across the terminal.
					const detail =
						named.length === 0
							? ""
							: named.length <= 6
								? ` (${named.join(", ")})`
								: ` (${named.length} fields: ${named.slice(0, 5).join(", ")}, …)`;
					return emit(`    ${formatVerb("applied", "apply")}settings${detail}`);
				},

				cleanupSummary: (resource, count, names) => {
					const suffix = names.length > 0 ? ` (${names.join(", ")})` : "";
					return emit(`    ${formatVerb("deleted", "delete")}${count} ${pluralize(resource, count)}${suffix}`);
				},

				syncOperation: (verb, resource, name, detail, source) => {
					const nameStr = name ? ` ${name}` : "";
					const suffix = detail ? ` ${detail}` : "";
					const sourceSuffix = source && debug ? ` <- ${source}` : "";
					return emit(`    ${formatVerb(verb, verb)}${resource}${nameStr}${suffix}${sourceSuffix}`);
				},

				driftDetected: (resource, name, drift) => {
					// `drift` is an observation, not an operation, so it never takes the
					// dry-run `would ` prefix — the drift happened either way. What the
					// dry run changes is the consequence, which is the clause after it.
					const consequence = !drift.needsApply
						? "already matches config, nothing written"
						: dryRun
							? "would overwrite"
							: "overwritten";
					const fingerprints = debug ? ` <- applied ${drift.applied} live ${drift.live}` : "";
					return emit(
						`    ${"drift".padEnd(8)}${resource} ${name} changed outside reposets — ${consequence}${fingerprints}`,
					);
				},

				syncError: (context, message) =>
					Effect.gen(function* () {
						const repo = yield* Ref.get(currentRepo);
						// Recorded even when silent, so `finish` can still account for
						// them; only the inline line is suppressed.
						yield* Ref.update(errors, (errs) => [...errs, { repo, context, message }]);
						yield* emitError(`    error   ${context}: ${message}`);
					}),

				finish: () =>
					Effect.gen(function* () {
						const errs = yield* Ref.get(errors);
						if (errs.length === 0) {
							yield* emit("Sync complete!");
							return;
						}
						// The whole closing block follows the run's outcome to one
						// stream: splitting the header from the list it introduces
						// would interleave badly under any redirection.
						yield* emitError(`Sync complete with ${errs.length} ${errs.length === 1 ? "error" : "errors"}:`);
						for (const err of errs) {
							// A run-level failure — an unmatched `--repo`, say — belongs to
							// no repository, and prefixing it with an empty slug reads as a
							// rendering bug rather than as a run-level error.
							yield* emitError(
								err.repo === ""
									? `  ${err.context} — ${err.message}`
									: `  ${err.repo}: ${err.context} — ${err.message}`,
							);
						}
					}),
			} satisfies SyncLoggerShape;
		}),
	);
}
