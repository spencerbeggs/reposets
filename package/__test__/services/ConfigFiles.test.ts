import { AppTest } from "@effected/app/testing";
import type { MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import {
	CONFIG_FILENAME,
	ConfigFlagMissingConfig,
	ConfigFlagNotFound,
	ReposetsConfigFile,
	makeConfigFilesLive,
} from "../../src/services/ConfigFiles.js";
import { Invocation } from "../../src/services/Invocation.js";

/**
 * `--config` is an explicit request, so it must fail loudly rather than fall
 * through to the XDG tier `AppConfig` appends — see
 * `okf/decisions/config-flag-replaces-the-upward-walk.md`.
 *
 * Every test here plants a valid config in the XDG config directory as a
 * decoy. A `--config` that silently fell through would load it, so each
 * refusal is checked against a file that really is there to be found — and
 * the first test is the control proving that it is.
 *
 * Hermetic: `AppTest.layer` supplies fixed XDG paths under `/home/test` on an
 * in-memory volume, and the working directory is {@link Invocation}'s, so
 * nothing here touches the disk or the process's own cwd.
 */

const NAMESPACE = "reposets-configfiles-test";

/** The working directory the commands run in. */
const CWD = "/work";

const xdgConfig = `/home/test/.config/${NAMESPACE}/${CONFIG_FILENAME}`;

const config = (group: string): string => `[groups.${group}]\nrepos = ["r"]\ncredentials = "me"\n`;

/** Discover every config source for one `--config` value, or fail with the layer's error. */
const discover = (configFlag: string | undefined, files: MemoryFileSystemSeed = {}, cwd: string = CWD) =>
	Effect.gen(function* () {
		const file = yield* ReposetsConfigFile;
		const sources = yield* file.discover;
		return { paths: sources.map((source) => source.path), loaded: yield* file.load };
	}).pipe(
		Effect.provide(
			makeConfigFilesLive(configFlag).pipe(
				Layer.provideMerge(Invocation.layer({ cwd, version: "0.0.0-test" })),
				Layer.provideMerge(
					AppTest.layer({ namespace: NAMESPACE, files: { [xdgConfig]: config("from-xdg"), ...files } }),
				),
			),
		),
		Effect.result,
		Effect.runPromise,
	);

describe("--config", () => {
	it("naming a directory with a config loads that config, ahead of the XDG one", async () => {
		const project = "/work/project";

		const result = await discover(project, { [`${project}/${CONFIG_FILENAME}`]: config("from-project") });

		expect(result._tag).toBe("Success");
		if (result._tag !== "Success") return;
		expect(Object.keys(result.success.loaded.groups)).toEqual(["from-project"]);
		// The control: the XDG decoy is on the chain and found, so the refusals
		// below are refusing to load a file that is genuinely there.
		expect(result.success.paths).toEqual([`${project}/${CONFIG_FILENAME}`, xdgConfig]);
	});

	it("naming a directory with no config fails, naming the directory and the file, and loads no XDG config", async () => {
		const empty = "/work/empty";

		const result = await discover(empty, { [empty]: MemoryFileSystem.directory() });

		expect(result._tag).toBe("Failure");
		if (result._tag !== "Failure") return;
		expect(result.failure).toBeInstanceOf(ConfigFlagMissingConfig);
		expect((result.failure as ConfigFlagMissingConfig).message).toBe(
			`--config directory has no ${CONFIG_FILENAME}: ${empty}`,
		);
	});

	it("naming a path that does not exist still fails with ConfigFlagNotFound", async () => {
		const missing = `/work/nope/${CONFIG_FILENAME}`;

		const result = await discover(missing);

		expect(result._tag).toBe("Failure");
		if (result._tag !== "Failure") return;
		expect(result.failure).toBeInstanceOf(ConfigFlagNotFound);
		expect((result.failure as ConfigFlagNotFound).message).toBe(`--config path does not exist: ${missing}`);
	});

	it("naming a directory whose config does not decode resolves it rather than refusing", async () => {
		// The directory check is existence, not validity: `doctor` diagnoses a
		// broken file only if the layer hands it over.
		const broken = "/work/broken";

		// Not TOML at all, so the failure is the file's own and says where it is.
		const result = await discover(broken, { [`${broken}/${CONFIG_FILENAME}`]: "[groups\n" });

		expect(result._tag).toBe("Failure");
		if (result._tag !== "Failure") return;
		expect(result.failure).not.toBeInstanceOf(ConfigFlagMissingConfig);
		expect(result.failure).not.toBeInstanceOf(ConfigFlagNotFound);
		expect(JSON.stringify(result.failure)).toContain(`${broken}/${CONFIG_FILENAME}`);
	});

	it("a relative --config resolves against the invocation's working directory, not the process's", async () => {
		const result = await discover("project", { [`${CWD}/project/${CONFIG_FILENAME}`]: config("from-relative") });

		expect(result._tag).toBe("Success");
		if (result._tag !== "Success") return;
		expect(Object.keys(result.success.loaded.groups)).toEqual(["from-relative"]);
		expect(result.success.paths[0]).toBe(`${CWD}/project/${CONFIG_FILENAME}`);
	});
});

describe("the upward walk", () => {
	it("starts at the invocation's working directory and finds a config above it", async () => {
		const deeper = `${CWD}/nested/deeper`;
		const result = await discover(
			undefined,
			{ [`${CWD}/${CONFIG_FILENAME}`]: config("from-walk"), [deeper]: MemoryFileSystem.directory() },
			deeper,
		);

		expect(result._tag).toBe("Success");
		if (result._tag !== "Success") return;
		expect(Object.keys(result.success.loaded.groups)).toEqual(["from-walk"]);
		expect(result.success.paths).toEqual([`${CWD}/${CONFIG_FILENAME}`, xdgConfig]);
	});
});
