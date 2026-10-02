import type { Block } from "@effected/cli";
import { Doc, Status } from "@effected/cli";
import type { SyncEvent, SyncRunSummary } from "../../services/SyncLogger.js";

/**
 * What the sync progress view folds its events into.
 *
 * @remarks
 * Kept in a module with no JSX and no React import, so `sync` can build the
 * static summary from it on a run that draws nothing — the non-interactive
 * path must never load React — and so the reducer is testable as a plain
 * function.
 *
 * @public
 */
export interface SyncProgressState extends SyncRunSummary {
	/** Whether this is a dry run; labels the summary. */
	readonly dryRun: boolean;
	/** Repositories the run selected, the denominator of `repos`. */
	readonly total: number;
	/** The repository being worked on, while a run is going. */
	readonly current: string | undefined;
	/** Whether `RunEnded` has arrived: the frame is then the run's summary. */
	readonly finished: boolean;
}

/**
 * The state before any event.
 *
 * @public
 */
export const initialSyncProgress: SyncProgressState = {
	dryRun: false,
	total: 0,
	repos: 0,
	changes: 0,
	drifted: 0,
	errors: 0,
	current: undefined,
	finished: false,
};

/**
 * Fold one event into the progress state.
 *
 * @remarks
 * The live counts are the view's own approximation — one per operation line,
 * one per drift line — because the engine counts journal changes, which a
 * settings write can make several of. `RunEnded` carries the engine's totals
 * and replaces them, so the committed final frame says exactly what the static
 * summary of a non-interactive run says.
 *
 * `repos` counts repositories *finished*: a repository is done when the next
 * one starts. A `RunEnded` with no totals is a run that did not finish (the
 * handler publishes one when the work fails or is interrupted), so it keeps
 * every live count and does not count the repository in flight as done.
 *
 * @public
 */
export const reduceSyncProgress = (state: SyncProgressState, event: SyncEvent): SyncProgressState => {
	switch (event._tag) {
		case "RunStarted":
			// The kit never resets state between runs; a fresh run starts here.
			return { ...initialSyncProgress, total: event.total, dryRun: event.dryRun };
		case "GroupStarted":
			return state;
		case "RepoStarted":
			return { ...state, repos: state.current === undefined ? state.repos : state.repos + 1, current: event.slug };
		case "Operation":
			return event.verb === "skip" ? state : { ...state, changes: state.changes + event.count };
		case "Drift":
			return { ...state, drifted: state.drifted + 1 };
		case "Error":
			return { ...state, errors: state.errors + 1 };
		case "RunEnded":
			return {
				...state,
				// Without totals the run did not finish — it failed or was
				// interrupted — so the repository in flight was not done.
				repos: event.repos ?? state.repos,
				changes: event.changes ?? state.changes,
				drifted: event.drifted ?? state.drifted,
				errors: event.errors ?? state.errors,
				current: undefined,
				finished: true,
			};
	}
};

/**
 * A run begins at `RunStarted`.
 *
 * @public
 */
export const isSyncRunStart = (event: SyncEvent): boolean => event._tag === "RunStarted";

/**
 * A run ends at `RunEnded`, whose frame is committed as the summary.
 *
 * @public
 */
export const isSyncRunEnd = (event: SyncEvent): boolean => event._tag === "RunEnded";

const noun = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/**
 * The run's counts as one document block: `Dry run: 2/3 repos, 4 changes, 1
 * drifted, 0 errors`.
 *
 * @remarks
 * The one summary both paths draw — the live view inside its frame through
 * `DocView`, a non-interactive run as a static `Doc.print` — so the two read
 * byte for byte alike. Every counter shows at zero: `0 errors` is the line a
 * reader looks for, and a counter that vanishes at zero makes the line change
 * shape between runs.
 *
 * @public
 */
export const syncSummaryBlock = (state: Omit<SyncProgressState, "current" | "finished">): Block =>
	Doc.counts({
		layout: "inline",
		label: state.dryRun ? "Dry run" : "Sync",
		// The share headline is `repos/total`: the selected repositories, not the
		// sum of every counter.
		total: () => state.total,
		counters: [
			Doc.counter(Status.core, "success", {
				key: "repos",
				label: noun(state.total, "repo", "repos"),
				n: state.repos,
				showZero: true,
			}),
			Doc.counter(Status.core, "info", {
				key: "changes",
				label: noun(state.changes, "change", "changes"),
				n: state.changes,
				showZero: true,
			}),
			Doc.counter(Status.core, "warning", { key: "drifted", label: "drifted", n: state.drifted, showZero: true }),
			Doc.counter(Status.core, "failure", {
				key: "errors",
				label: noun(state.errors, "error", "errors"),
				n: state.errors,
				showZero: true,
			}),
		],
	});
