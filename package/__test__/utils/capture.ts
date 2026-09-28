import { CliExit, CliLogger } from "@effected/cli";
import { Cause, Console, Effect, Exit, MutableRef } from "effect";
import { CliError } from "effect/cli";

/** One line a program wrote, and the stream it landed on. */
export interface Line {
	readonly stream: "stdout" | "stderr";
	readonly text: string;
}

/** Every line, in order, plus the exit code the run would have produced. */
export interface Outcome {
	readonly lines: ReadonlyArray<Line>;
	readonly exitCode: number;
}

/**
 * A `Console` that records which stream each write went to.
 *
 * @remarks
 * `CliLogger` reads the `Console` off the fiber, so providing this one captures
 * `Console.log` (program output, stdout) and every `Effect.log*` call
 * (diagnostics, stderr under `CliLogger.layer()`'s default) through the same
 * routing the shipped bin uses — no global is stubbed. `Object.create(console)`
 * inherits the members nothing here touches, so the double stays a `Console`.
 */
export const capturingConsole = (): { readonly console: Console.Console; readonly lines: Line[] } => {
	const lines: Line[] = [];
	const push =
		(stream: Line["stream"]) =>
		(...args: ReadonlyArray<unknown>): void => {
			lines.push({ stream, text: args.map(String).join(" ") });
		};
	const console_: Console.Console = Object.assign(Object.create(console) as Console.Console, {
		log: push("stdout"),
		error: push("stderr"),
	});
	return { console: console_, lines };
};

/**
 * Run a handler the way `CliRuntime.main` would, capturing both streams.
 *
 * @remarks
 * - A fresh `CliExit` cell is provided and read back after success, so a
 *   finding that calls `CliExit.set(1)` reports exit `1` here too.
 * - A `CliError.UserError` is written to stderr once and reported as exit
 *   `64`, standing in for `Command.runWith`'s own rendering plus
 *   `CliRuntime.main`'s `usageExitCode`.
 * - Any other failure is rethrown, so a handler that dies unexpectedly still
 *   fails the test loudly rather than reading as an exit code.
 */
export const runOutcome = async (handler: Effect.Effect<void, unknown, CliExit>): Promise<Outcome> => {
	const { console: double, lines } = capturingConsole();
	const program = Effect.gen(function* () {
		const cell = yield* CliExit;
		const exit = yield* Effect.exit(handler);
		if (Exit.isSuccess(exit)) return MutableRef.get(cell.code);
		const error = Cause.squash(exit.cause);
		if (CliError.isCliError(error) && error._tag === "UserError") {
			yield* Console.error(error.message);
			return 64;
		}
		return yield* Effect.failCause(exit.cause);
	});
	const exitCode = await Effect.runPromise(
		program.pipe(
			Effect.provide(CliExit.layer),
			Effect.provide(CliLogger.layer()),
			Effect.provideService(Console.Console, double),
		),
	);
	return { lines, exitCode };
};

/** {@link runOutcome}, keeping only the lines. */
export const run = async (handler: Effect.Effect<void, unknown, CliExit>): Promise<ReadonlyArray<Line>> =>
	(await runOutcome(handler)).lines;

/** Every line's text, joined — for `toContain` assertions that span both streams. */
export const text = (lines: ReadonlyArray<Line>): string => lines.map((line) => line.text).join("\n");

/** The lines written to one stream. */
export const on = (lines: ReadonlyArray<Line>, stream: Line["stream"]): ReadonlyArray<string> =>
	lines.filter((line) => line.stream === stream).map((line) => line.text);
