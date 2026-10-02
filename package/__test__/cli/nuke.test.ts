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
// The fixture's `AppDirs` namespace names the XDG subdirectories.
const configDir = (): string => join(temp.home(), ".config", "reposets-ui-test");
const stateDir = (): string => join(temp.home(), ".local", "state", "reposets-ui-test");
const cacheDir = (): string => join(temp.home(), ".cache", "reposets-ui-test");
const userConfig = (): string => join(configDir(), "reposets.config.toml");
const userGitignore = (): string => join(configDir(), ".gitignore");
const stateDb = (): string => join(stateDir(), "store.db");
const cacheDb = (): string => join(cacheDir(), "cache.db");

/** Write a file, creating its directory. */
const put = (file: string, contents: string): void => {
	mkdirSync(join(file, ".."), { recursive: true });
	writeFileSync(file, contents);
};

/**
 * One project file, one user file and the state database: three targets in
 * three sections. The fixture opens no database, so the state database exists
 * only because this writes it.
 */
const seed = (): void => {
	put(projectConfig(), "# project\n");
	put(userConfig(), "# user\n");
	put(stateDb(), "");
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
		put(stateDb(), "");
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

describe("nuke, what it finds", () => {
	it("nothing on the machine: says so and exits 0, with or without --force", async () => {
		for (const force of [true, false]) {
			const outcome = await runOutcome(nuke(force));
			assert.strictEqual(outcome.exitCode, 0);
			const out = on(outcome.lines, "stdout").join("\n");
			assert.include(out, "Nothing to remove — no reposets files found on this machine.");
			assert.notInclude(out, "This will delete:");
		}
	});

	it("a database and its WAL companions are one target, removed together", async () => {
		put(cacheDb(), "");
		put(`${cacheDb()}-wal`, "");
		put(`${cacheDb()}-shm`, "");
		const outcome = await runOutcome(nuke(true));
		assert.strictEqual(outcome.exitCode, 0);
		const out = on(outcome.lines, "stdout").join("\n");
		assert.strictEqual(out.split("cache database — ").length - 1, 1);
		assert.include(out, "loses cached GitHub reads — rebuilt on the next sync");
		assert.include(out, `removed ${cacheDb()}-wal`);
		// Counted in files, the unit of the `removed` lines above it.
		assert.include(out, "Done. 3 files removed.");
		// The cache is rebuildable, so it carries no irreversible-loss warning.
		assert.notInclude(out, "cannot be undone");
		for (const file of [cacheDb(), `${cacheDb()}-wal`, `${cacheDb()}-shm`]) assert.isFalse(existsSync(file));
	});

	it("companions orphaned without their database are still found and removed", async () => {
		put(`${stateDb()}-wal`, "");
		put(`${stateDb()}-shm`, "");
		const outcome = await runOutcome(nuke(true));
		assert.strictEqual(outcome.exitCode, 0);
		const out = on(outcome.lines, "stdout").join("\n");
		assert.include(out, "state database — ");
		assert.include(out, "Done. 2 files removed.");
		assert.isFalse(existsSync(`${stateDb()}-wal`));
		assert.isFalse(existsSync(`${stateDb()}-shm`));
	});

	it("removes the user .gitignore when it holds only what init writes", async () => {
		put(userGitignore(), "\nreposets.credentials.toml\n\n");
		const outcome = await runOutcome(nuke(true));
		assert.strictEqual(outcome.exitCode, 0);
		assert.include(on(outcome.lines, "stdout").join("\n"), "user .gitignore — written by init");
		assert.isFalse(existsSync(userGitignore()));
	});

	it("keeps a user .gitignore with any other line, and does not list it", async () => {
		put(userGitignore(), "reposets.credentials.toml\n*.bak\n");
		const outcome = await runOutcome(nuke(true));
		assert.include(on(outcome.lines, "stdout").join("\n"), "Nothing to remove");
		assert.isTrue(existsSync(userGitignore()));
	});

	it("never touches a project directory's .gitignore", async () => {
		seed();
		put(join(temp.dir(), ".gitignore"), "reposets.credentials.toml\n");
		await runOutcome(nuke(true));
		assert.isTrue(existsSync(join(temp.dir(), ".gitignore")));
	});

	it("removes reposets' directories once empty, and keeps one with anything left in it", async () => {
		seed();
		put(cacheDb(), "");
		put(join(configDir(), "notes.txt"), "mine\n");
		const outcome = await runOutcome(nuke(true));
		assert.strictEqual(outcome.exitCode, 0);
		const out = on(outcome.lines, "stdout").join("\n");
		assert.include(out, `removed empty directory ${stateDir()}`);
		assert.isFalse(existsSync(stateDir()));
		assert.isFalse(existsSync(cacheDir()));
		// Not a target, and not reposets' to delete: the directory stays with it.
		assert.isTrue(existsSync(join(configDir(), "notes.txt")));
		assert.notInclude(out, `removed empty directory ${configDir()}`);
		// The XDG homes themselves are not reposets' and are never removed.
		assert.isTrue(existsSync(join(temp.home(), ".local", "state")));
	});

	it("a refused run leaves empty directories alone", async () => {
		seed();
		mkdirSync(cacheDir(), { recursive: true });
		const outcome = await runOutcome(nuke(false));
		assert.strictEqual(outcome.exitCode, 64);
		assert.isTrue(existsSync(cacheDir()));
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

	it.effect("the confirmation counts files, so a database's companions are included", () =>
		Effect.gen(function* () {
			// One row in the checklist, three files on disk.
			put(stateDb(), "");
			put(`${stateDb()}-wal`, "");
			put(`${stateDb()}-shm`, "");
			const run = yield* interactive(nuke(false));
			yield* (yield* run.next("Delete which files?")).press("enter");
			const confirm = yield* run.next("Delete 3 files?");
			yield* confirm.type("y");
			yield* confirm.press("enter");
			assert.deepStrictEqual(yield* run.done, Exit.succeed(0));
			assert.include(yield* run.session.stdout, "Done. 3 files removed.");
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

	it.effect("the cache has its own section, apart from State", () =>
		Effect.gen(function* () {
			seed();
			put(cacheDb(), "");
			const run = yield* interactive(nuke(false), { columns: 80 });
			const picker = yield* run.next("Delete which files?");
			const frame = yield* picker.plainFrame;
			assert.include(frame, "Cache");
			assert.include(frame, "cache database: ~/.cache/reposets-ui-test/cache.db");
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
