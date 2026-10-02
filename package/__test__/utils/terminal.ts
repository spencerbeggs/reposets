import { PassThrough, Writable } from "node:stream";
import { CliInteractive, CliTheme } from "@effected/cli";
import { UiStreams } from "@effected/cli/ui";
import { Audience, TerminalEnv } from "@effected/env";
import { Layer, Option } from "effect";

/**
 * An in-memory terminal a live view mounts on, keeping every byte written.
 *
 * @remarks
 * `CliUiTest.session` keeps each mount's frames but not the lines a live view
 * writes above its frame through `logConsole`, and `CliUiTest.live` builds its
 * own view rather than the one a handler builds. This is the piece neither
 * gives: the handler's own view on streams whose whole output a test can
 * read. stderr is the same stream as stdout, as on a real terminal, so a
 * `logError` routed above the frame shows up in order with everything else.
 *
 * Ink is mounted with `interactive: true` by the kit, so it draws here whether
 * or not the test runs under CI.
 */
export const capturedTerminal = (columns = 120, rows = 30) => {
	const chunks: Array<string> = [];
	const stdout = new Writable({
		write(chunk: Buffer | string, _encoding, callback) {
			chunks.push(chunk.toString());
			callback();
		},
	});
	Object.assign(stdout, { isTTY: true, columns, rows });
	const stdin = new PassThrough();
	Object.assign(stdin, { isTTY: true, setRawMode: () => stdin, ref: () => stdin, unref: () => stdin });
	const stream = { isTerminal: true, color: "none" as const, hyperlinks: false, columns: Option.some(columns) };
	const terminal = TerminalEnv.layerTest({ stdinIsTerminal: true, stdout: stream, stderr: stream });
	const layer = Layer.mergeAll(
		CliTheme.layer().pipe(Layer.provide(terminal)),
		terminal,
		Audience.layerTest("human"),
		CliInteractive.layerTest(true),
		Layer.succeed(UiStreams, {
			stdin: stdin as unknown as NodeJS.ReadStream,
			stdout: stdout as unknown as NodeJS.WriteStream,
			stderr: stdout as unknown as NodeJS.WriteStream,
		}),
	);
	return {
		layer,
		/** Every byte written, escapes stripped. */
		written: (): string => chunks.join("").replace(ESCAPE, ""),
	};
};

/** CSI sequences (cursor moves, erases, colour), built from its code so the pattern holds no control character. */
const ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, "g");
