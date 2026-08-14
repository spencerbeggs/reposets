import type { Layer } from "effect";
import { Console, LogLevel, Logger } from "effect";

/**
 * Renders one log record as a plain CLI line.
 *
 * @remarks
 * Effect's default logger emits `[23:04:05.891] INFO (#2): message`, which is
 * the right shape for a service and the wrong one for a command-line tool: the
 * timestamp, level and fiber id are noise in front of output a human is reading,
 * and they make a formatted block — `doctor`'s permission table, for instance —
 * unreadable.
 *
 * A message that is an array is joined with a space, matching how `Effect.log`
 * accepts variadic parts.
 */
const render = (message: unknown): string => (Array.isArray(message) ? message.map(String).join(" ") : String(message));

/**
 * The CLI's output logger: plain lines, errors on stderr.
 *
 * @remarks
 * Routing by level is the contract `SyncLogger` is written against — it emits
 * failures with `Effect.logError` precisely so that `reposets sync > log.txt`
 * still shows them on the terminal while the log captures progress. Without a
 * logger that honors the distinction, that choice does nothing.
 *
 * `Logger.layer` replaces the default logger rather than merging with it, so
 * nothing is emitted twice.
 *
 * A `Logger`'s callback is **synchronous**, so it cannot yield an `Effect` and
 * therefore cannot reach `Stdio`'s sinks. The way out is not to write to
 * `process.stdout` — it is the one core's own loggers take: read the `Console`
 * off the fiber. `Console.Console` is a `Context.Reference`, so it carries a
 * default and never appears in `R`, and a test swaps the reference instead of
 * stubbing a global.
 *
 * `console.log`/`console.error` supply their own newline, which is why nothing
 * here appends one.
 *
 * @public
 */
export const CliLoggerLive: Layer.Layer<never> = Logger.layer([
	Logger.make<unknown, void>(({ fiber, logLevel, message }) => {
		const console = fiber.getRef(Console.Console);

		// v4's LogLevel is a string union, not a namespace of constants, and its
		// ordinal rises with severity — Fatal 50000, Error 40000, Warn 30000 — so
		// this catches Error and Fatal and nothing below.
		const write = LogLevel.isGreaterThanOrEqualTo(logLevel, "Error") ? console.error : console.log;

		write(render(message));
	}),
]);
