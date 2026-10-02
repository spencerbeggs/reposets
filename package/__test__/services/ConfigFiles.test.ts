import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { App } from "@effected/app";
import { ConfigProvider, Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	CONFIG_FILENAME,
	ConfigFlagMissingConfig,
	ConfigFlagNotFound,
	ReposetsConfigFile,
	makeConfigFilesLive,
} from "../../src/services/ConfigFiles.js";
import { migrations } from "../../src/store/migrations.js";

/**
 * `--config` is an explicit request, so it must fail loudly rather than fall
 * through to the XDG tier `AppConfig` appends — see
 * `okf/decisions/config-flag-replaces-the-upward-walk.md`.
 *
 * Every test here plants a valid config in the temp XDG config directory as a
 * decoy. A `--config` that silently fell through would load it, so each
 * refusal is checked against a file that really is there to be found — and
 * the first test is the control proving that it is.
 */

const NAMESPACE = "reposets-configfiles-test";

let dir: string;
let home: string;
let xdgConfig: string;

const config = (group: string): string => `[groups.${group}]\nrepos = ["r"]\ncredentials = "me"\n`;

beforeEach(() => {
	dir = join(tmpdir(), `reposets-configfiles-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	home = join(dir, "home");
	xdgConfig = join(home, ".config", NAMESPACE, CONFIG_FILENAME);
	mkdirSync(join(home, ".config", NAMESPACE), { recursive: true });
	writeFileSync(xdgConfig, config("from-xdg"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

/** Discover every config source for one `--config` value, or fail with the layer's error. */
const discover = (configFlag: string) =>
	Effect.gen(function* () {
		const file = yield* ReposetsConfigFile;
		const sources = yield* file.discover;
		return { paths: sources.map((source) => source.path), loaded: yield* file.load };
	}).pipe(
		Effect.provide(
			makeConfigFilesLive(configFlag).pipe(
				Layer.provideMerge(App.layer({ namespace: NAMESPACE, store: { migrations } })),
				Layer.provideMerge(NodeServices.layer),
				Layer.provideMerge(
					ConfigProvider.layer(
						ConfigProvider.fromEnv({
							env: {
								HOME: home,
								XDG_CONFIG_HOME: join(home, ".config"),
								XDG_STATE_HOME: join(home, ".local/state"),
								XDG_CACHE_HOME: join(home, ".cache"),
							},
						}),
					),
				),
			),
		),
		Effect.result,
		Effect.runPromise,
	);

describe("--config", () => {
	it("naming a directory with a config loads that config, ahead of the XDG one", async () => {
		const project = join(dir, "project");
		mkdirSync(project, { recursive: true });
		writeFileSync(join(project, CONFIG_FILENAME), config("from-project"));

		const result = await discover(project);

		expect(result._tag).toBe("Success");
		if (result._tag !== "Success") return;
		expect(Object.keys(result.success.loaded.groups)).toEqual(["from-project"]);
		// The control: the XDG decoy is on the chain and found, so the refusals
		// below are refusing to load a file that is genuinely there.
		expect(result.success.paths).toEqual([join(project, CONFIG_FILENAME), xdgConfig]);
	});

	it("naming a directory with no config fails, naming the directory and the file, and loads no XDG config", async () => {
		const empty = join(dir, "empty");
		mkdirSync(empty, { recursive: true });

		const result = await discover(empty);

		expect(result._tag).toBe("Failure");
		if (result._tag !== "Failure") return;
		expect(result.failure).toBeInstanceOf(ConfigFlagMissingConfig);
		expect((result.failure as ConfigFlagMissingConfig).message).toBe(
			`--config directory has no ${CONFIG_FILENAME}: ${empty}`,
		);
	});

	it("naming a path that does not exist still fails with ConfigFlagNotFound", async () => {
		const missing = join(dir, "nope", CONFIG_FILENAME);

		const result = await discover(missing);

		expect(result._tag).toBe("Failure");
		if (result._tag !== "Failure") return;
		expect(result.failure).toBeInstanceOf(ConfigFlagNotFound);
		expect((result.failure as ConfigFlagNotFound).message).toBe(`--config path does not exist: ${missing}`);
	});

	it("naming a directory whose config does not decode resolves it rather than refusing", async () => {
		// The directory check is existence, not validity: `doctor` diagnoses a
		// broken file only if the layer hands it over.
		const broken = join(dir, "broken");
		mkdirSync(broken, { recursive: true });
		// Not TOML at all, so the failure is the file's own and says where it is.
		writeFileSync(join(broken, CONFIG_FILENAME), "[groups\n");

		const result = await discover(broken);

		expect(result._tag).toBe("Failure");
		if (result._tag !== "Failure") return;
		expect(result.failure).not.toBeInstanceOf(ConfigFlagMissingConfig);
		expect(result.failure).not.toBeInstanceOf(ConfigFlagNotFound);
		expect(JSON.stringify(result.failure)).toContain(join(broken, CONFIG_FILENAME));
	});
});
