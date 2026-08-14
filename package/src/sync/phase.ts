import type { OwnerType, Repo } from "@effected/github";
import type { Redacted } from "effect";
import { Effect } from "effect";
import type { Config } from "../schemas/config.js";
import type { ChangeRecord } from "../store/SyncJournal.js";

/**
 * Everything a phase needs about the repository it is acting on.
 *
 * @remarks
 * Assembled once per repository by the engine, so a phase never re-resolves
 * credentials, re-detects the owner type, or re-reads the config. A phase is a
 * function of this context and nothing else — which is what makes it testable
 * without the engine.
 *
 * @public
 */
export interface RepoContext {
	/** The account that owns the repository. */
	readonly owner: string;
	/** The repository name, without the owner prefix. */
	readonly repo: string;
	/** `owner/repo`, since almost every consumer wants it pre-joined. */
	readonly slug: string;
	/** Which group this repository was reached through. */
	readonly group: string;
	/** Whether the owner is a user or an organization. Gates org-only settings. */
	readonly ownerType: OwnerType;
	/** The whole parsed config; a phase reads the sections it owns. */
	readonly config: Config;
	/** Named credential values for this group's profile, resolved once. */
	readonly credentials: ReadonlyMap<string, Redacted.Redacted<string>>;
	/** The journal run this phase's changes belong to. */
	readonly runId: string;
	/** Whether this run writes anything. */
	readonly dryRun: boolean;
	/** Whether cleanup of undeclared resources is suppressed for this run. */
	readonly noCleanup: boolean;
	/**
	 * The directory the config was loaded from.
	 *
	 * @remarks
	 * `{ file }` secret and variable groups name paths **relative to the config
	 * file**, not to the working directory. Without this a phase would have to
	 * resolve against `process.cwd()`, which reads a different file depending on
	 * where the CLI was invoked from — silently, and into a secret.
	 */
	readonly configDir: string;
}

/**
 * What a phase did.
 *
 * @remarks
 * Returned rather than logged directly so the engine owns journalling and
 * output ordering. A phase decides *what* happened; the engine decides how it
 * is recorded and whether anyone hears about it.
 *
 * @public
 */
export interface PhaseResult {
	/** One entry per resource the phase touched, for the journal. */
	readonly changes: ReadonlyArray<ChangeRecord>;
	/** Failures that should not abort the run — one repository's bad ruleset does not stop the rest. */
	readonly errors: ReadonlyArray<{ readonly context: string; readonly message: string }>;
}

/** A phase that touched nothing and failed at nothing. */
export const emptyResult: PhaseResult = { changes: [], errors: [] };

/**
 * The phases a run can execute, in the order they must run.
 *
 * @remarks
 * Order is not cosmetic. Environments exist before the secrets and variables
 * scoped to them, and settings land before the security toggles that read the
 * repository's state. The array *is* the contract.
 *
 * @public
 */
export const PHASE_NAMES = [
	"settings",
	"security",
	"code-scanning",
	"environments",
	"secrets",
	"variables",
	"rulesets",
	"cleanup",
] as const;

/**
 * One of {@link PHASE_NAMES}.
 *
 * @public
 */
export type PhaseName = (typeof PHASE_NAMES)[number];

/**
 * One step of a sync run.
 *
 * @remarks
 * Phases are **data**, not a hardcoded sequence: the engine walks a list, which
 * is what lets `--only` and `--skip` select a subset without the engine knowing
 * what any particular phase does.
 *
 * `appliesTo` lets a phase decline cheaply — a repository with no rulesets
 * configured should not cost a round trip to discover that. The engine skips a
 * declining phase without logging it, since "did nothing because nothing was
 * configured" is not news.
 *
 * @public
 */
export interface Phase {
	readonly name: PhaseName;
	/** Whether this phase has anything to do for this repository. */
	readonly appliesTo: (ctx: RepoContext) => boolean;
	/**
	 * Do it.
	 *
	 * @remarks
	 * Services are bound at layer construction, so they do not appear here —
	 * leaving them on `run` would push every phase's dependencies through
	 * `SyncEngine` and out to every caller.
	 *
	 * `Repo` is the exception, and deliberately so. `@effected/github`'s resource
	 * services take no `owner`/`repo` argument: each resolves `Repo` from context
	 * **per call**, which is what makes a scoped override mean something. A phase
	 * therefore carries `Repo` in `R`, and the engine discharges it once at the
	 * repository loop — the single place that knows which repository is in play.
	 */
	readonly run: (ctx: RepoContext) => Effect.Effect<PhaseResult, never, Repo>;
}

/**
 * Select the phases a run should execute.
 *
 * @remarks
 * `only` wins over `skip` when both name the same phase — an explicit inclusion
 * is a stronger statement than an exclusion, and the alternative is silently
 * running nothing.
 *
 * Selection preserves {@link PHASE_NAMES} order regardless of the order the
 * flags were given, because the order is a correctness property rather than a
 * preference.
 *
 * @public
 */
export const selectPhases = (
	phases: ReadonlyArray<Phase>,
	options: { readonly only?: ReadonlySet<PhaseName>; readonly skip?: ReadonlySet<PhaseName> },
): ReadonlyArray<Phase> =>
	phases.filter((phase) =>
		options.only !== undefined && options.only.size > 0
			? options.only.has(phase.name)
			: !(options.skip?.has(phase.name) ?? false),
	);

/**
 * Merge results from several phases.
 *
 * @public
 */
export const mergeResults = (results: ReadonlyArray<PhaseResult>): PhaseResult => ({
	changes: results.flatMap((r) => r.changes),
	errors: results.flatMap((r) => r.errors),
});

/**
 * Lift a fallible operation into a phase result, recording the failure rather
 * than aborting the run.
 *
 * @remarks
 * A sync run spans many repositories and many resources. One repository's
 * rejected ruleset must not stop the other nineteen — the run reports it and
 * carries on, which is why {@link Phase.run} has `never` in its error channel.
 *
 * @public
 */
export const attempt = <A, E, R>(
	context: string,
	effect: Effect.Effect<A, E, R>,
): Effect.Effect<{ readonly value: A } | { readonly error: PhaseResult["errors"][number] }, never, R> =>
	effect.pipe(
		Effect.map((value) => ({ value })),
		Effect.catch((error: E) =>
			Effect.succeed({
				error: { context, message: error instanceof Error ? error.message : String(error) },
			}),
		),
	);
