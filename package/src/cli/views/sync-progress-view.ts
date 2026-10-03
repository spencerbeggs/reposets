import type { LiveOptions } from "@effected/cli/ui";
import { CliUi } from "@effected/cli/ui";
import type { SyncEvent } from "../../services/SyncLogger.js";
import type { SyncProgressState } from "./sync-progress-model.js";
import { initialSyncProgress, isSyncRunEnd, isSyncRunStart, reduceSyncProgress } from "./sync-progress-model.js";

/**
 * The sync progress view: every `CliUi.live` option but `events`.
 *
 * @remarks
 * Defined once and exported so the handler and its tests drive the same value —
 * a test that rebuilt the options would exercise a copy. `hosted` because a
 * run that cannot draw (a pipe, an agent, CI) has its own closing output — the
 * static summary `sync` prints — so the view must print nothing there; the
 * handler does not mount it on such a run in the first place.
 *
 * `render` is `CliUi.lazyView`: the JSX module is imported only when a run
 * first draws, so importing this module — and `sync` — loads neither React
 * nor Ink. It lives apart from the model because the JSX module imports the
 * model, and a lazy import back into it is still an import cycle.
 *
 * @public
 */
export const syncProgressView: Omit<LiveOptions<SyncEvent, SyncProgressState>, "events"> = {
	initial: initialSyncProgress,
	reduce: reduceSyncProgress,
	render: CliUi.lazyView(() => import("./sync-progress.js").then((module) => module.syncProgressRender)),
	isStart: isSyncRunStart,
	isTerminal: isSyncRunEnd,
	mode: "hosted",
};
