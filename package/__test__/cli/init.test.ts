import { appendFileSync, chmodSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { CliUiTest } from "@effected/cli-kit/ui/testing";
import { Effect, Exit, Option } from "effect";
import { initHandler } from "../../src/cli/commands/init.js";
import type { Config } from "../../src/schemas/config.js";
import type { Credentials } from "../../src/schemas/credentials.js";
import { configSchemaHost, credentialsSchemaHost } from "../../src/schemas/hosted.js";
import { ReposetsConfigFile, ReposetsCredentialsFile } from "../../src/services/ConfigFiles.js";
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

/**
 * An existing `.gitignore` is the one file `init` rewrites rather than creates,
 * and it is the user's, so a crash mid-write must not leave it truncated. A new
 * inode is the observable sign of a temp-then-rename write.
 */
describe("init, new files", () => {
	it("get the mode a plain write would give them, with no temp file left", async () => {
		const outcome = await runOutcome(init(true));
		assert.strictEqual(outcome.exitCode, 0);
		const expected = 0o666 & ~process.umask();
		for (const name of ["reposets.config.toml", "reposets.credentials.toml", ".gitignore"]) {
			assert.strictEqual(statSync(join(temp.dir(), name)).mode & 0o777, expected, name);
		}
		assert.deepStrictEqual(
			readdirSync(temp.dir()).filter((name) => name.endsWith(".tmp")),
			[],
		);
	});
});

describe("init, an existing .gitignore", () => {
	const gitignore = (): string => join(temp.dir(), ".gitignore");
	const USER_LINES = "node_modules\ndist";

	it("is replaced whole: the user's lines kept, the mode kept, no temp file left", async () => {
		writeFileSync(gitignore(), USER_LINES);
		chmodSync(gitignore(), 0o640);
		const before = statSync(gitignore()).ino;

		const outcome = await runOutcome(init(true));

		assert.strictEqual(outcome.exitCode, 0);
		assert.strictEqual(readFileSync(gitignore(), "utf-8"), `${USER_LINES}\nreposets.credentials.toml\n`);
		assert.notStrictEqual(statSync(gitignore()).ino, before);
		assert.strictEqual(statSync(gitignore()).mode & 0o777, 0o640);
		assert.deepStrictEqual(
			readdirSync(temp.dir()).filter((name) => name.endsWith(".tmp")),
			[],
		);
	});

	// Root ignores permission bits, so the failure would never happen under root.
	it.skipIf(process.getuid?.() === 0)("in a read-only directory is left alone and the run exits 1", async () => {
		writeFileSync(gitignore(), USER_LINES);
		writeFileSync(inProject(), "");
		writeFileSync(join(temp.dir(), "reposets.credentials.toml"), "");
		chmodSync(temp.dir(), 0o555);
		try {
			const outcome = await runOutcome(init(true));
			assert.strictEqual(outcome.exitCode, 1);
			assert.include(on(outcome.lines, "stderr").join("\n"), `Could not write: ${gitignore()}`);
			assert.strictEqual(readFileSync(gitignore(), "utf-8"), USER_LINES);
		} finally {
			chmodSync(temp.dir(), 0o755);
		}
	});
});

describe("init, the #:schema directive", () => {
	const inProjectCredentials = (): string => join(temp.dir(), "reposets.credentials.toml");

	it("opens the config with the config schema's directive, then a blank line", async () => {
		await runOutcome(init(true));
		const [first, second] = readFileSync(inProject(), "utf8").split("\n");
		assert.strictEqual(first, `#:schema ${configSchemaHost.$id}`);
		assert.strictEqual(second, "");
	});

	it("opens the credentials file with the credentials schema's directive, then a blank line", async () => {
		await runOutcome(init(true));
		const [first, second] = readFileSync(inProjectCredentials(), "utf8").split("\n");
		assert.strictEqual(first, `#:schema ${credentialsSchemaHost.$id}`);
		assert.strictEqual(second, "");
	});

	it("stamps the versioned root URLs the schema build writes as $id", () => {
		// Pinned literally: these URLs ship in every scaffolded file, so a change
		// to the hosted identity must be a deliberate edit here too.
		assert.strictEqual(
			configSchemaHost.$id,
			"https://raw.githubusercontent.com/spencerbeggs/reposets/main/schemas/3.0/config.json",
		);
		assert.strictEqual(
			credentialsSchemaHost.$id,
			"https://raw.githubusercontent.com/spencerbeggs/reposets/main/schemas/3.0/credentials.json",
		);
	});

	it("a stamped scaffold still decodes through the strict file services", async () => {
		await runOutcome(init(true));
		// Real content after the directive, so the load can only pass by reading
		// the file through the directive line, not by finding an empty document.
		appendFileSync(inProject(), '\n[groups.mine]\nrepos = ["r"]\ncredentials = "personal"\n');
		appendFileSync(inProjectCredentials(), '\n[profiles.personal]\nusername = "me"\ngithub_token = { env = "T" }\n');
		let config: Config | undefined;
		let credentials: Credentials | undefined;
		const load = Effect.gen(function* () {
			config = yield* (yield* ReposetsConfigFile).load;
			credentials = yield* (yield* ReposetsCredentialsFile).load;
		});
		const outcome = await runOutcome(withServices(load, temp.dir(), temp.home()));
		assert.strictEqual(outcome.exitCode, 0);
		assert.deepStrictEqual(config?.groups?.mine?.repos, ["r"]);
		assert.isDefined(credentials?.profiles.personal);
	});
});
