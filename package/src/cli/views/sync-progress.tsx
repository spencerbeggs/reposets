import { Fmt } from "@effected/cli";
import { DocView, Styled, useGlyphs } from "@effected/cli/ui";
import { Box, Text } from "ink";
import type { ReactElement } from "react";
import type { SyncProgressState } from "./sync-progress-model.js";
import { syncSummaryBlock } from "./sync-progress-model.js";

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
 * The sync progress view's `render`.
 *
 * @remarks
 * This module is the only one that holds JSX. It is loaded through
 * `CliUi.lazyView` by `syncProgressView` in `sync-progress-view.ts`, so only
 * a run that draws it ever loads React or Ink.
 *
 * @public
 */
export const syncProgressRender = (state: SyncProgressState, frame: number): ReactElement => (
	<SyncProgress state={state} frame={frame} />
);
