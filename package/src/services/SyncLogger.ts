import type { CoreStatusName } from "@effected/cli";
import { CliLog, CliTheme, Fmt, Status } from "@effected/cli";
import { Audience } from "@effected/env";
import { Console, Context, Effect, Layer, PubSub, Ref } from "effect";
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
 * What a whole run amounted to, as the caller tallied it.
 *
 * @remarks
 * The engine counts changes from the phases' results, not from the lines this
 * service printed — a settings write is one line and several journal changes —
 * so the closing numbers are handed in rather than re-derived here, and a live
 * view's final frame agrees with the static summary to the digit.
 *
 * @public
 */
export interface SyncRunSummary {
	readonly repos: number;
	readonly changes: number;
	readonly drifted: number;
	readonly errors: number;
}

/**
 * One thing a run reported, as data, for a view that redraws progress.
 *
 * @remarks
 * Published by {@link SyncLoggerLive} beside — never instead of — the line each
 * hook prints, so a live view and the streamed report cannot disagree about
 * what happened: they are fed by the same call. `RunStarted` and `RunEnded`
 * bracket a run, which is what a view keys its start and its committed final
 * frame on.
 *
 * @public
 */
export type SyncEvent =
	| { readonly _tag: "RunStarted"; readonly total: number; readonly dryRun: boolean }
	| { readonly _tag: "GroupStarted"; readonly name: string; readonly selected: number; readonly declared: number }
	| { readonly _tag: "RepoStarted"; readonly slug: string }
	| {
			readonly _tag: "Operation";
			readonly verb: "sync" | "apply" | "delete" | "skip";
			readonly resource: string;
			/** How many resources the one line covers: a cleanup summary is one line for several deletions. */
			readonly count: number;
	  }
	| { readonly _tag: "Drift"; readonly resource: string; readonly name: string; readonly needsApply: boolean }
	| { readonly _tag: "Error"; readonly repo: string; readonly context: string; readonly message: string }
	| ({ readonly _tag: "RunEnded" } & Partial<SyncRunSummary>);

/**
 * Everything the sync pipeline can say.
 *
 * @public
 */
export interface SyncLoggerShape {
	/**
	 * A run begins.
	 *
	 * @remarks
	 * Prints nothing — the report has always started at the first group header —
	 * and exists to publish `RunStarted` with the number of repositories the run
	 * selected, which is what lets a progress view say `2/5` rather than `2`.
	 *
	 * @param total - repositories the run will act on, computed by the caller
	 * with the same selection rule the engine applies.
	 */
	readonly runStart: (total: number) => Effect.Effect<void>;
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
	/** One resource-level operation. */
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
	/**
	 * The closing line, listing every error the run accumulated.
	 *
	 * @param summary - the run's totals, carried on `RunEnded` so a progress
	 * view's committed final frame is the run's summary. Optional: without it
	 * the view keeps the counts it folded along the way.
	 */
	readonly finish: (summary?: SyncRunSummary) => Effect.Effect<void>;
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
	/**
	 * Where to publish a {@link SyncEvent} for every hook, for a live view.
	 *
	 * @remarks
	 * Optional because only an interactive run draws one; without it the hooks
	 * print exactly as they always did and publish nothing.
	 */
	readonly events?: PubSub.PubSub<SyncEvent> | undefined;
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
 * **Every action line leads with a status glyph**, from the kit's core
 * vocabulary: a change made is `success`, a dry run's `would …` is `info`, a
 * deletion and a drift are `warning`, a failure is `failure`, a skip is `skip`.
 * The glyph is painted for a person; an agent gets it unpainted and the text
 * plain, through `CliTheme.forAudience` — the rule `CliMessage` paints by. The
 * failure lines with a glyph — the per-repository `error` line, at the action
 * lines' indent, and the closing `Sync complete with N errors:` header — go
 * through `CliLog.status`, which paints its glyph the same way on the log
 * channel (the logger strips every escape a program logs itself). Headers
 * (`group:`, `repo:`) take none — they are structure, not outcomes. The glyph
 * sits after the indent and before the padded verb, so the verbs still line
 * up with each other.
 *
 * **The report is the product; failures are diagnostics.** What a run did —
 * group and repository headers, every operation, every drift line, the closing
 * "Sync complete!" — is the output of `sync` and `drift`, so it is written with
 * `Console.log` to stdout, where `reposets drift > report.txt` captures it.
 * Failures are emitted with `Effect.logError`, which the CLI logger routes to
 * stderr, so they stay on the terminal when stdout is redirected. A consequence
 * worth knowing: `--log-level` filters diagnostics only — it does not silence
 * the report.
 *
 * Both go through the fiber's `Console`, which is the seam a live progress view
 * uses: providing its `logConsole` around the run puts every one of these lines
 * above the redrawing frame without this service knowing a view exists.
 *
 * @public
 */
export class SyncLogger extends Context.Service<SyncLogger, SyncLoggerShape>()("reposets/SyncLogger") {}

/**
 * Build a live logger for one run.
 *
 * @remarks
 * A factory rather than a bare layer because its settings are per-invocation:
 * they come from the `--dry-run` and `--debug` flags, and the event sink from
 * whether this run draws a view — all known only once the command has parsed.
 *
 * Requires `CliTheme` and `Audience`, read once when the layer builds, to paint
 * the status glyphs; under the bin both come from the environment
 * `CliRuntime.main` builds.
 *
 * @public
 */
export function SyncLoggerLive(config: SyncLoggerConfig): Layer.Layer<SyncLogger, never, CliTheme | Audience> {
	const { dryRun, debug, events } = config;

	return Layer.effect(
		SyncLogger,
		Effect.gen(function* () {
			const theme = yield* CliTheme;
			const audience = yield* Audience;
			const errors = yield* Ref.make<SyncErrorRecord[]>([]);
			const currentRepo = yield* Ref.make<string>("");

			const publish = (event: SyncEvent): Effect.Effect<void> =>
				events === undefined ? Effect.void : PubSub.publish(events, event);

			/** stdout's theme as this run's audience sees it: unpainted for an agent. */
			const stdoutTheme = CliTheme.forAudience(theme.forStream("stdout"), audience.kind);

			/** A status glyph for a report line on stdout. */
			const mark = (status: CoreStatusName): string => stdoutTheme.status(Status.core, status);

			/**
			 * A failure status line, glyph painted for a person, `indent` spaces in.
			 *
			 * @remarks
			 * `CliLog.status` logs at `Error` (the status's rank), so the line goes
			 * where `Effect.logError` goes — stderr — and its text is sanitised. The
			 * theme and audience this layer was built with are provided, so the
			 * glyph follows the same audience the stdout lines do. In the ASCII set
			 * the glyph is the word `[FAIL]`.
			 */
			const emitFailure = (text: string, indent = 0): Effect.Effect<void> =>
				CliLog.status(Status.core, "failure", text, { indent }).pipe(
					Effect.provideService(CliTheme, theme),
					Effect.provideService(Audience, audience),
				);

			// Every line interpolates config and API text — repository names,
			// resource names, a GitHub error message — so each is sanitised before
			// it reaches the terminal: an escape in a value must not repaint it.
			const emit = (line: string): Effect.Effect<void> => Console.log(Fmt.sanitize(line));

			/** An action line: indent, glyph, then the padded verb and its content. */
			const action = (status: CoreStatusName, body: string): Effect.Effect<void> =>
				Console.log(`    ${mark(status)} ${Fmt.sanitize(body)}`);

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

			/** A change made reads as done; the same change on a dry run, as information. */
			const changeStatus: CoreStatusName = dryRun ? "info" : "success";

			return {
				runStart: (total) => publish({ _tag: "RunStarted", total, dryRun }),

				groupStart: (name, selected, declared) => {
					// Say both numbers when a filter narrowed the run, so the header and
					// the summary agree about what happened. The noun agrees with the
					// number nearest it — "1 of 3 repos", not "1 of 3 repo".
					const scope =
						selected === declared
							? `${selected} ${selected === 1 ? "repo" : "repos"}`
							: `${selected} of ${declared} ${declared === 1 ? "repo" : "repos"}`;
					return emit(`group: ${name} (${scope})`).pipe(
						Effect.andThen(publish({ _tag: "GroupStarted", name, selected, declared })),
					);
				},

				repoStart: (owner, repo) => {
					const repoSlug = `${owner}/${repo}`;
					// Tracked as well as printed: errors are attributed to whichever
					// repository was current when they happened.
					return Ref.set(currentRepo, repoSlug).pipe(
						Effect.andThen(emit(`  repo: ${repoSlug}`)),
						Effect.andThen(publish({ _tag: "RepoStarted", slug: repoSlug })),
					);
				},

				settingsApplied: (fields) => {
					const named = [...fields].sort();
					// A long list is summarised rather than wrapped across the terminal.
					const detail =
						named.length === 0
							? ""
							: named.length <= 6
								? ` (${named.join(", ")})`
								: ` (${named.length} fields: ${named.slice(0, 5).join(", ")}, …)`;
					return action(changeStatus, `${formatVerb("applied", "apply")}settings${detail}`).pipe(
						Effect.andThen(publish({ _tag: "Operation", verb: "apply", resource: "settings", count: 1 })),
					);
				},

				cleanupSummary: (resource, count, names) => {
					const suffix = names.length > 0 ? ` (${names.join(", ")})` : "";
					// A deletion is a warning on a real run and a dry run alike: it is
					// the one change that cannot be undone by running sync again.
					return action(
						"warning",
						`${formatVerb("deleted", "delete")}${count} ${pluralize(resource, count)}${suffix}`,
					).pipe(Effect.andThen(publish({ _tag: "Operation", verb: "delete", resource, count })));
				},

				syncOperation: (verb, resource, name, detail, source) => {
					const nameStr = name ? ` ${name}` : "";
					const suffix = detail ? ` ${detail}` : "";
					const sourceSuffix = source && debug ? ` <- ${source}` : "";
					const status: CoreStatusName = verb === "skip" ? "skip" : verb === "delete" ? "warning" : changeStatus;
					return action(status, `${formatVerb(verb, verb)}${resource}${nameStr}${suffix}${sourceSuffix}`).pipe(
						Effect.andThen(publish({ _tag: "Operation", verb, resource, count: 1 })),
					);
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
					return action(
						"warning",
						`${"drift".padEnd(8)}${resource} ${name} changed outside reposets — ${consequence}${fingerprints}`,
					).pipe(Effect.andThen(publish({ _tag: "Drift", resource, name, needsApply: drift.needsApply })));
				},

				syncError: (context, message) =>
					Effect.gen(function* () {
						const repo = yield* Ref.get(currentRepo);
						// Recorded as well as printed, so `finish` can account for them.
						yield* Ref.update(errors, (errs) => [...errs, { repo, context, message }]);
						yield* emitFailure(`error   ${context}: ${message}`, 4);
						yield* publish({ _tag: "Error", repo, context, message });
					}),

				finish: (summary) =>
					Effect.gen(function* () {
						const errs = yield* Ref.get(errors);
						if (errs.length === 0) {
							yield* Console.log(`${mark("success")} Sync complete!`);
						} else {
							// The whole closing block follows the run's outcome to one
							// stream: splitting the header from the list it introduces
							// would interleave badly under any redirection.
							yield* emitFailure(`Sync complete with ${errs.length} ${errs.length === 1 ? "error" : "errors"}:`);
							for (const err of errs) {
								// A run-level failure — an unmatched `--repo`, say — belongs to
								// no repository, and prefixing it with an empty slug reads as a
								// rendering bug rather than as a run-level error.
								yield* emitError(
									Fmt.sanitize(
										err.repo === ""
											? `  ${err.context} — ${err.message}`
											: `  ${err.repo}: ${err.context} — ${err.message}`,
									),
								);
							}
						}
						// Last, after every line: a view commits its final frame on this,
						// so nothing the run printed may land below it.
						yield* publish({ _tag: "RunEnded", ...summary });
					}),
			} satisfies SyncLoggerShape;
		}),
	);
}
