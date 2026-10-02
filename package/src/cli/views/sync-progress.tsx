import { Fmt } from "@effected/cli";
import type { LiveOptions } from "@effected/cli/ui";
import { DocView, Styled, useGlyphs } from "@effected/cli/ui";
import { Box, Text } from "ink";
import type { ReactElement } from "react";
import type { SyncEvent } from "../../services/SyncLogger.js";
import type { SyncProgressState } from "./sync-progress-model.js";
import {
	initialSyncProgress,
	isSyncRunEnd,
	isSyncRunStart,
	reduceSyncProgress,
	syncSummaryBlock,
} from "./sync-progress-model.js";

/**
 * The redrawing footer of an interactive `sync` or `drift`.
 *
 * @remarks
 * While the run goes: a spinner, the repository being worked on, and the
 * counts so far. Once `RunEnded` arrives the spinner line goes and only the
 * counts remain — that frame is committed to the terminal, so it IS the run's
 * closing summary, the same block a non-interactive run prints statically.
 *
 * A component rather than a bare function so the glyph hook runs inside the
 * providers the live view mounts it under.
 */
const SyncProgress = (props: { readonly state: SyncProgressState; readonly frame: number }): ReactElement => {
	const glyphs = useGlyphs();
	const { state, frame } = props;
	const summary = <DocView doc={syncSummaryBlock(state)} />;
	if (state.finished) return summary;
	const spinner = glyphs.spinner[frame % glyphs.spinner.length] ?? "";
	const doing = state.dryRun ? "checking" : "syncing";
	return (
		<Box flexDirection="column">
			<Text>
				<Styled token="accent">{spinner}</Styled>{" "}
				{state.current === undefined ? "starting…" : `${doing} ${Fmt.sanitize(state.current)}`}
			</Text>
			{summary}
		</Box>
	);
};

/**
 * The sync progress view: every `CliUi.live` option but `events`.
 *
 * @remarks
 * Defined once and exported so the handler and its test drive the same value —
 * a test that rebuilt the options would exercise a copy. `hosted` because a
 * run that cannot draw (a pipe, an agent, CI) has its own closing output — the
 * static summary `sync` prints — so the view must print nothing there; the
 * handler does not mount it on such a run in the first place.
 *
 * This module is the only one that holds JSX, and `sync` imports it
 * dynamically on the drawing path alone, so a non-interactive run never loads
 * React or Ink.
 *
 * @public
 */
export const syncProgressView: Omit<LiveOptions<SyncEvent, SyncProgressState>, "events"> = {
	initial: initialSyncProgress,
	reduce: reduceSyncProgress,
	render: (state, frame) => <SyncProgress state={state} frame={frame} />,
	isStart: isSyncRunStart,
	isTerminal: isSyncRunEnd,
	mode: "hosted",
};
