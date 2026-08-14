import { Console, Effect, References } from "effect";
import { describe, expect, it } from "vitest";
import { CliLoggerLive } from "../../src/cli/logger.js";

/**
 * A `Console` that keeps the two streams apart.
 *
 * @remarks
 * This test exists because `CliLoggerLive` reads the `Console` off the fiber
 * rather than writing to `process.stdout`. Before that, asserting the
 * stdout-versus-stderr split meant monkey-patching a global inside a test
 * runner that is itself writing to those streams — so it was never asserted,
 * and the routing `SyncLogger` depends on was unproven.
 *
 * `Object.create(console)` inherits the members neither the logger nor these
 * assertions touch, so the double stays a `Console` without restating one.
 */
const capturing = (): { readonly console: Console.Console; readonly out: string[]; readonly err: string[] } => {
	const out: string[] = [];
	const err: string[] = [];
	const console_: Console.Console = Object.assign(Object.create(console) as Console.Console, {
		log: (...args: ReadonlyArray<unknown>) => out.push(args.map(String).join(" ")),
		error: (...args: ReadonlyArray<unknown>) => err.push(args.map(String).join(" ")),
	});
	return { console: console_, out, err };
};

const capture = async (program: Effect.Effect<void>): Promise<{ out: string[]; err: string[] }> => {
	const { console: double, out, err } = capturing();
	await Effect.runPromise(program.pipe(Effect.provide(CliLoggerLive), Effect.provideService(Console.Console, double)));
	return { out, err };
};

describe("CliLoggerLive", () => {
	it("writes info to stdout and error to stderr", async () => {
		const { out, err } = await capture(
			Effect.gen(function* () {
				yield* Effect.log("progress");
				yield* Effect.logError("broke");
			}),
		);

		expect(out).toEqual(["progress"]);
		expect(err).toEqual(["broke"]);
	});

	it("routes every level at or above Error to stderr, and nothing below", async () => {
		const { out, err } = await capture(
			Effect.gen(function* () {
				yield* Effect.logDebug("debug");
				yield* Effect.logInfo("info");
				yield* Effect.logWarning("warn");
				yield* Effect.logError("error");
				yield* Effect.logFatal("fatal");
			}).pipe(Effect.provideService(References.MinimumLogLevel, "Debug")),
		);

		expect(err).toEqual(["error", "fatal"]);
		// Warn is the boundary that matters: it must NOT go to stderr.
		expect(out).toEqual(["debug", "info", "warn"]);
	});

	it("renders plainly, with no timestamp, level or fiber id", async () => {
		const { out } = await capture(Effect.log("a plain line"));

		expect(out).toEqual(["a plain line"]);
		expect(out[0]).not.toMatch(/^\[|INFO|\(#\d+\)/);
	});

	it("joins a variadic message with spaces", async () => {
		const { out } = await capture(Effect.log("synced", 3, "repos"));

		expect(out).toEqual(["synced 3 repos"]);
	});
});
