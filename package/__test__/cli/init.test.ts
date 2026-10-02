import { existsSync } from "node:fs";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { CliUiTest } from "@effected/cli/ui/testing";
import { Effect, Exit, Option } from "effect";
import { initHandler } from "../../src/cli/commands/init.js";
import { on, runOutcome } from "../utils/capture.js";
import { interactive, useTempDirs, withServices } from "./fixture.js";

/**
 * Where `init` writes is the one thing it decides. `--project` /
 * `--no-project` decide it outright; omitted, a person is asked and anything
 * else gets the XDG directory, as `init` always did.
 */

const temp = useTempDirs();

const init = (project: boolean | undefined) => withServices(initHandler(project), temp.dir(), temp.home());

const inProject = (): string => join(temp.dir(), "reposets.config.toml");
// The fixture's `App.layer` namespace names the XDG subdirectory.
const xdgDir = (): string => join(temp.home(), ".config", "reposets-ui-test");
const inXdg = (): string => join(xdgDir(), "reposets.config.toml");

describe("init, not interactive", () => {
	it("omitted --project writes to the XDG directory, as before", async () => {
		const outcome = await runOutcome(init(undefined));
		assert.strictEqual(outcome.exitCode, 0);
		assert.isTrue(existsSync(inXdg()));
		assert.isFalse(existsSync(inProject()));
		assert.include(on(outcome.lines, "stdout").join("\n"), `Created: ${inXdg()}`);
	});

	it("closes with both ways to add a credential: the guided one and the flag form", async () => {
		const outcome = await runOutcome(init(undefined));
		const err = on(outcome.lines, "stderr").join("\n");
		assert.include(err, "reposets credentials create        (on a terminal, asks for each value)");
		assert.include(err, "reposets credentials create --profile personal --username YOU --op");
	});

	it("--project writes to the working directory", async () => {
		await runOutcome(init(true));
		assert.isTrue(existsSync(inProject()));
		assert.isFalse(existsSync(inXdg()));
	});

	it("reports what it created and found on stdout as plain status lines", async () => {
		await runOutcome(init(true));
		const outcome = await runOutcome(init(true));
		const out = on(outcome.lines, "stdout");
		assert.include(out.join("\n"), `Already exists: ${inProject()}`);
		assert.notInclude(out.join("\n"), "\u001b[");
	});
});

describe("init, interactive", () => {
	it.effect("asks where, offering both resolved paths; enter takes the XDG directory", () =>
		Effect.gen(function* () {
			const run = yield* interactive(init(undefined));
			const screen = yield* run.next("Where should reposets keep its config?");
			const frame = yield* screen.plainFrame;
			assert.include(frame, xdgDir());
			assert.include(frame, temp.dir());
			yield* screen.press("enter");
			assert.deepStrictEqual(yield* run.done, Exit.succeed(0));
			assert.isTrue(existsSync(inXdg()));
			assert.isFalse(existsSync(inProject()));
		}).pipe(Effect.scoped),
	);

	it.effect("choosing this directory writes there", () =>
		Effect.gen(function* () {
			const run = yield* interactive(init(undefined));
			yield* (yield* run.next("Where should reposets keep its config?")).press("down", "enter");
			assert.deepStrictEqual(yield* run.done, Exit.succeed(0));
			assert.isTrue(existsSync(inProject()));
			assert.isFalse(existsSync(inXdg()));
			assert.include(yield* run.session.stdout, `Created: ${inProject()}`);
		}).pipe(Effect.scoped),
	);

	it.effect("--no-project given: no question", () =>
		Effect.gen(function* () {
			const run = yield* interactive(init(false));
			assert.deepStrictEqual(yield* run.done, Exit.succeed(0));
			assert.strictEqual(yield* run.session.mounts, 0);
			assert.isTrue(existsSync(inXdg()));
		}).pipe(Effect.scoped),
	);

	it.effect("Esc cancels and writes nothing", () =>
		Effect.gen(function* () {
			const run = yield* interactive(init(undefined));
			yield* (yield* run.next("Where should reposets keep its config?")).press("escape");
			assert.deepStrictEqual(CliUiTest.cancelReason(yield* run.done), Option.some("escape"));
			assert.isFalse(existsSync(inProject()));
			assert.isFalse(existsSync(inXdg()));
		}).pipe(Effect.scoped),
	);
});
