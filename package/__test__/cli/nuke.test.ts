import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { CliUiTest } from "@effected/cli/ui/testing";
import { Effect, Exit, Option } from "effect";
import { nukeHandler } from "../../src/cli/commands/nuke.js";
import { on, runOutcome } from "../utils/capture.js";
import { interactive, useTempDirs, withServices } from "./fixture.js";

/**
 * `nuke` deletes files that cannot all be rebuilt, so what these pin is who
 * gets to say yes: a person, through two screens that both default to keeping
 * things; never a run with nobody there. The non-interactive paths run under
 * the agent audience `runOutcome` defaults to.
 */

const temp = useTempDirs();

const projectConfig = (): string => join(temp.dir(), "reposets.config.toml");
// The fixture's `App.layer` namespace names the XDG subdirectories.
const userConfig = (): string => join(temp.home(), ".config", "reposets-ui-test", "reposets.config.toml");
// `App.layer` opens the store as it builds, so the state database is always a target here.
const stateDb = (): string => join(temp.home(), ".local", "state", "reposets-ui-test", "store.db");

/**
 * One project file and one user file; with the state database, three targets
 * in three sections.
 */
const seed = (): void => {
	writeFileSync(projectConfig(), "# project\n");
	mkdirSync(join(temp.home(), ".config", "reposets-ui-test"), { recursive: true });
	writeFileSync(userConfig(), "# user\n");
};

const nuke = (force: boolean) => withServices(nukeHandler(force), temp.dir(), temp.home());

describe("nuke, not interactive", () => {
	it("refuses without --force: exit 64, names --force, deletes nothing", async () => {
		seed();
		const outcome = await runOutcome(nuke(false));
		assert.strictEqual(outcome.exitCode, 64);
		assert.include(on(outcome.lines, "stderr").join("\n"), "--force was not given");
		assert.isTrue(existsSync(projectConfig()));
		assert.isTrue(existsSync(userConfig()));
	});

	it("still lists what it found, on stdout, before refusing", async () => {
		seed();
		const outcome = await runOutcome(nuke(false));
		const out = on(outcome.lines, "stdout").join("\n");
		assert.include(out, "This will delete:");
		assert.include(out, projectConfig());
		assert.include(out, "project config — loses your groups and settings");
		assert.include(out, "Nothing on GitHub is touched");
		assert.notInclude(out, "\u001b[");
	});

	it("says the state database loss cannot be undone when it is a target", async () => {
		const outcome = await runOutcome(nuke(false));
		const out = on(outcome.lines, "stdout").join("\n");
		assert.include(out, "drift detection restarts from nothing");
		assert.include(out, "WARNING: Deleting the state database cannot be undone");
	});

	it("--force removes everything and reports each path", async () => {
		seed();
		const outcome = await runOutcome(nuke(true));
		assert.strictEqual(outcome.exitCode, 0);
		const out = on(outcome.lines, "stdout").join("\n");
		assert.include(out, `removed ${projectConfig()}`);
		assert.include(out, `removed ${userConfig()}`);
		assert.include(out, `removed ${stateDb()}`);
		assert.include(out, "Done. 3 files removed.");
		assert.isFalse(existsSync(projectConfig()));
	});
});

describe("nuke, interactive", () => {
	it.effect("all pre-selected, confirmed: removes every file", () =>
		Effect.gen(function* () {
			seed();
			const run = yield* interactive(nuke(false));
			const picker = yield* run.next("Delete which files?");
			const frame = yield* picker.plainFrame;
			assert.include(frame, "Project files");
			assert.include(frame, "User files");
			assert.include(frame, "State");
			// The highlighted row's detail is the absolute path (in full on a
			// wide terminal; the list printed above always has it in full).
			assert.include(frame, projectConfig());
			yield* picker.press("enter");
			const confirm = yield* run.next("Delete 3 files?");
			yield* confirm.type("y");
			yield* confirm.press("enter");
			const exit = yield* run.done;
			assert.deepStrictEqual(exit, Exit.succeed(0));
			assert.isFalse(existsSync(projectConfig()));
			assert.isFalse(existsSync(userConfig()));
			assert.isFalse(existsSync(stateDb()));
			assert.include(yield* run.session.stdout, `removed ${projectConfig()}`);
		}).pipe(Effect.scoped),
	);

	it.effect("rows are short enough for 80 columns: what, then a ./ or ~ path", () =>
		Effect.gen(function* () {
			seed();
			const run = yield* interactive(nuke(false), { columns: 80 });
			const picker = yield* run.next("Delete which files?");
			const frame = yield* picker.plainFrame;
			assert.include(frame, "project config: ./reposets.config.toml");
			assert.include(frame, "user config: ~/.config/reposets-ui-test/reposets.config.toml");
			assert.include(frame, "state database: ~/.local/state/reposets-ui-test/store.db");
			yield* picker.press("escape");
			yield* run.done;
		}).pipe(Effect.scoped),
	);

	it.effect("project files at different levels stay distinguishable", () =>
		Effect.gen(function* () {
			const sub = join(temp.dir(), "sub");
			mkdirSync(sub);
			writeFileSync(join(sub, "reposets.config.toml"), "# sub\n");
			writeFileSync(projectConfig(), "# parent\n");
			const run = yield* interactive(withServices(nukeHandler(false), sub, temp.home()), { columns: 80 });
			const picker = yield* run.next("Delete which files?");
			const frame = yield* picker.plainFrame;
			assert.include(frame, "project config: ./reposets.config.toml");
			assert.include(frame, "project config: ../reposets.config.toml");
			yield* picker.press("escape");
			yield* run.done;
		}).pipe(Effect.scoped),
	);

	it.effect("deselecting one keeps it and removes the rest", () =>
		Effect.gen(function* () {
			seed();
			const run = yield* interactive(nuke(false));
			const picker = yield* run.next("Delete which files?");
			// The cursor starts on the first item: the project file.
			yield* picker.press("space", "enter");
			const confirm = yield* run.next("Delete 2 files?");
			yield* confirm.type("y");
			yield* confirm.press("enter");
			assert.deepStrictEqual(yield* run.done, Exit.succeed(0));
			assert.isTrue(existsSync(projectConfig()));
			assert.isFalse(existsSync(userConfig()));
			assert.isFalse(existsSync(stateDb()));
		}).pipe(Effect.scoped),
	);

	it.effect("enter alone on the confirmation answers no: nothing deleted, exit 0", () =>
		Effect.gen(function* () {
			seed();
			const run = yield* interactive(nuke(false));
			yield* (yield* run.next("Delete which files?")).press("enter");
			yield* (yield* run.next("Delete 3 files?")).press("enter");
			assert.deepStrictEqual(yield* run.done, Exit.succeed(0));
			assert.include(yield* run.session.stdout, "Nothing was deleted.");
			assert.isTrue(existsSync(projectConfig()));
			assert.isTrue(existsSync(userConfig()));
		}).pipe(Effect.scoped),
	);

	it.effect("deselecting everything deletes nothing and never asks to confirm", () =>
		Effect.gen(function* () {
			seed();
			const run = yield* interactive(nuke(false));
			const picker = yield* run.next("Delete which files?");
			yield* picker.press("space", "down", "space", "down", "space", "enter");
			assert.deepStrictEqual(yield* run.done, Exit.succeed(0));
			assert.include(yield* run.session.stdout, "Nothing was deleted.");
			assert.strictEqual(yield* run.session.mounts, 1);
			assert.isTrue(existsSync(projectConfig()));
		}).pipe(Effect.scoped),
	);

	it.effect("Esc on the picker is a cancel, not a no: Cancelled, nothing deleted", () =>
		Effect.gen(function* () {
			seed();
			const run = yield* interactive(nuke(false));
			yield* (yield* run.next("Delete which files?")).press("escape");
			const exit = yield* run.done;
			assert.deepStrictEqual(CliUiTest.cancelReason(exit), Option.some("escape"));
			assert.strictEqual(yield* run.session.mounts, 1);
			assert.isTrue(existsSync(projectConfig()));
		}).pipe(Effect.scoped),
	);

	it.effect("q on the confirmation cancels too", () =>
		Effect.gen(function* () {
			seed();
			const run = yield* interactive(nuke(false));
			yield* (yield* run.next("Delete which files?")).press("enter");
			yield* (yield* run.next("Delete 3 files?")).type("q");
			assert.deepStrictEqual(CliUiTest.cancelReason(yield* run.done), Option.some("escape"));
			assert.isTrue(existsSync(userConfig()));
		}).pipe(Effect.scoped),
	);

	it.effect("--force never mounts a screen", () =>
		Effect.gen(function* () {
			seed();
			const run = yield* interactive(nuke(true));
			assert.deepStrictEqual(yield* run.done, Exit.succeed(0));
			assert.strictEqual(yield* run.session.mounts, 0);
			assert.isFalse(existsSync(projectConfig()));
		}).pipe(Effect.scoped),
	);
});
