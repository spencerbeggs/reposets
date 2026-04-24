import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FileSystem } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import { ConfigProvider, Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import type { ConfigError } from "xdg-effect";
import { AppDirs, AppDirsConfig, ConfigFile, ExplicitPath, FirstMatch, TomlCodec, XdgConfigLive } from "xdg-effect";
import type { Config } from "../../src/schemas/config.js";
import { ConfigSchema } from "../../src/schemas/config.js";
import type { Credentials } from "../../src/schemas/credentials.js";
import { CredentialsSchema } from "../../src/schemas/credentials.js";
import { validateConfigRefs } from "../../src/services/ConfigFiles.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "../fixtures");

function fixture(name: string): string {
	return join(fixturesDir, name);
}

function fixtureContent(name: string): string {
	return readFileSync(fixture(name), "utf-8");
}

// Tags for test-scoped config file services
const TestConfigFile = ConfigFile.Tag<Config>("test/Config");
const TestCredentialsFile = ConfigFile.Tag<Credentials>("test/Credentials");

/**
 * Build a config layer with ExplicitPath resolver pointing at a known file.
 * Requires a ConfigProvider with HOME set (for XdgConfigLive internals).
 */
function makeConfigLayer(configPath: string) {
	return XdgConfigLive({
		app: new AppDirsConfig({ namespace: "reposets" }),
		config: {
			tag: TestConfigFile,
			schema: ConfigSchema,
			codec: TomlCodec,
			strategy: FirstMatch,
			resolvers: [ExplicitPath(configPath)],
			validate: validateConfigRefs,
		},
	});
}

function makeCredentialsLayer(credentialsPath: string, configLayer: ReturnType<typeof makeConfigLayer>) {
	return ConfigFile.Live({
		tag: TestCredentialsFile,
		schema: CredentialsSchema,
		codec: TomlCodec,
		strategy: FirstMatch,
		resolvers: [ExplicitPath(credentialsPath)],
	}).pipe(Layer.provide(configLayer));
}

const testProvider = ConfigProvider.fromMap(new Map([["HOME", "/test/home"]]));

function runWithProvider<A, E, R extends FileSystem.FileSystem>(effect: Effect.Effect<A, E, R>) {
	return Effect.runPromise(
		effect.pipe(Effect.withConfigProvider(testProvider), Effect.provide(NodeFileSystem.layer)) as Effect.Effect<A, E>,
	);
}

function runScoped<A, E, R extends FileSystem.FileSystem>(effect: Effect.Effect<A, E, R>) {
	return Effect.runPromise(
		effect.pipe(
			Effect.scoped,
			Effect.withConfigProvider(testProvider),
			Effect.provide(NodeFileSystem.layer),
		) as Effect.Effect<A, E>,
	);
}

// ---------------------------------------------------------------------------
// ConfigFileService - loading valid configs
// ---------------------------------------------------------------------------

describe("ConfigFileService config loading", () => {
	it("loads a minimal valid config via ExplicitPath", async () => {
		const layer = makeConfigLayer(fixture("valid-minimal.toml"));
		const result = await runWithProvider(
			Effect.gen(function* () {
				const cf = yield* TestConfigFile;
				return yield* cf.load;
			}).pipe(Effect.provide(layer)),
		);

		expect(result.groups["my-projects"]).toBeDefined();
		expect(result.groups["my-projects"].repos).toEqual(["repo-one", "repo-two"]);
		expect(result.log_level).toBe("info"); // default
	});

	it("loads a full config with all sections", async () => {
		const layer = makeConfigLayer(fixture("valid-full.toml"));
		const result = await runWithProvider(
			Effect.gen(function* () {
				const cf = yield* TestConfigFile;
				return yield* cf.load;
			}).pipe(Effect.provide(layer)),
		);

		expect(result.owner).toBe("test-owner");
		expect(result.log_level).toBe("verbose");
		expect(result.settings.defaults).toBeDefined();
		expect(result.settings.defaults.has_wiki).toBe(false);
		expect(result.secrets.inline).toBeDefined();
		expect(result.variables.common).toBeDefined();
		expect(result.groups["my-projects"].settings).toEqual(["defaults"]);
	});

	it("discovers config sources and returns path info", async () => {
		const layer = makeConfigLayer(fixture("valid-minimal.toml"));
		const result = await runWithProvider(
			Effect.gen(function* () {
				const cf = yield* TestConfigFile;
				return yield* cf.discover;
			}).pipe(Effect.provide(layer)),
		);

		expect(result).toHaveLength(1);
		expect(result[0].path).toBe(fixture("valid-minimal.toml"));
		expect(result[0].value.groups["my-projects"]).toBeDefined();
	});

	it("loads config from a specific path via loadFrom", async () => {
		const layer = makeConfigLayer(fixture("valid-minimal.toml"));
		const result = await runWithProvider(
			Effect.gen(function* () {
				const cf = yield* TestConfigFile;
				return yield* cf.loadFrom(fixture("valid-full.toml"));
			}).pipe(Effect.provide(layer)),
		);

		expect(result.owner).toBe("test-owner");
	});
});

// ---------------------------------------------------------------------------
// ConfigFileService - error cases
// ---------------------------------------------------------------------------

describe("ConfigFileService error handling", () => {
	it("fails when config file does not exist", async () => {
		const layer = makeConfigLayer(fixture("nonexistent.toml"));
		const result = await runWithProvider(
			Effect.gen(function* () {
				const cf = yield* TestConfigFile;
				return yield* Effect.either(cf.load);
			}).pipe(Effect.provide(layer)),
		);

		expect(result._tag).toBe("Left");
	});

	it("fails on invalid TOML syntax", async () => {
		const layer = makeConfigLayer(fixture("invalid-syntax.toml"));
		const result = await runWithProvider(
			Effect.gen(function* () {
				const cf = yield* TestConfigFile;
				return yield* Effect.either(cf.load);
			}).pipe(Effect.provide(layer)),
		);

		expect(result._tag).toBe("Left");
	});

	it("fails on valid TOML but invalid schema", async () => {
		const layer = makeConfigLayer(fixture("invalid-schema.toml"));
		const result = await runWithProvider(
			Effect.gen(function* () {
				const cf = yield* TestConfigFile;
				return yield* Effect.either(cf.load);
			}).pipe(Effect.provide(layer)),
		);

		expect(result._tag).toBe("Left");
	});

	it("fails on empty config file", async () => {
		const layer = makeConfigLayer(fixture("empty.toml"));
		const result = await runWithProvider(
			Effect.gen(function* () {
				const cf = yield* TestConfigFile;
				return yield* Effect.either(cf.load);
			}).pipe(Effect.provide(layer)),
		);

		expect(result._tag).toBe("Left");
	});
});

// ---------------------------------------------------------------------------
// validateConfigRefs
// ---------------------------------------------------------------------------

describe("validateConfigRefs", () => {
	it("rejects config with unknown settings group reference", async () => {
		const layer = makeConfigLayer(fixture("bad-refs.toml"));
		const result = await runWithProvider(
			Effect.gen(function* () {
				const cf = yield* TestConfigFile;
				return yield* Effect.either(cf.load);
			}).pipe(Effect.provide(layer)),
		);

		expect(result._tag).toBe("Left");
		if (result._tag === "Left") {
			const error = result.left as ConfigError;
			expect(error._tag).toBe("ConfigError");
			expect(error.reason).toContain("unknown settings group 'nonexistent-settings'");
		}
	});

	it("rejects config with unknown secrets group reference", async () => {
		const layer = makeConfigLayer(fixture("bad-refs.toml"));
		const result = await runWithProvider(
			Effect.gen(function* () {
				const cf = yield* TestConfigFile;
				return yield* Effect.either(cf.load);
			}).pipe(Effect.provide(layer)),
		);

		expect(result._tag).toBe("Left");
		if (result._tag === "Left") {
			const error = result.left as ConfigError;
			expect(error._tag).toBe("ConfigError");
			expect(error.reason).toContain("unknown secrets group 'nonexistent-secrets'");
		}
	});

	it("rejects config with unknown environment reference", async () => {
		const layer = makeConfigLayer(fixture("bad-env-refs.toml"));
		const result = await runWithProvider(
			Effect.gen(function* () {
				const cf = yield* TestConfigFile;
				return yield* Effect.either(cf.load);
			}).pipe(Effect.provide(layer)),
		);

		expect(result._tag).toBe("Left");
		if (result._tag === "Left") {
			const error = result.left as ConfigError;
			expect(error._tag).toBe("ConfigError");
			expect(error.reason).toContain("unknown environment 'nonexistent-env'");
		}
	});

	it("accepts config with all valid cross-references", async () => {
		const layer = makeConfigLayer(fixture("valid-full.toml"));
		const result = await runWithProvider(
			Effect.gen(function* () {
				const cf = yield* TestConfigFile;
				return yield* cf.load;
			}).pipe(Effect.provide(layer)),
		);

		expect(result.owner).toBe("test-owner");
		expect(result.groups["my-projects"]).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// CredentialsFileService
// ---------------------------------------------------------------------------

describe("ConfigFileService credentials loading", () => {
	it("loads valid credentials with a profile", async () => {
		const configLayer = makeConfigLayer(fixture("valid-minimal.toml"));
		const credsLayer = makeCredentialsLayer(fixture("valid-credentials.toml"), configLayer);
		const layer = Layer.mergeAll(configLayer, credsLayer);

		const result = await runWithProvider(
			Effect.gen(function* () {
				const cf = yield* TestCredentialsFile;
				return yield* cf.load;
			}).pipe(Effect.provide(layer)),
		);

		expect(result.profiles.personal).toBeDefined();
		expect(result.profiles.personal.github_token).toMatch(/^ghp_/);
	});

	it("loads credentials with multiple profiles", async () => {
		const configLayer = makeConfigLayer(fixture("valid-minimal.toml"));
		const credsLayer = makeCredentialsLayer(fixture("credentials-multi-profile.toml"), configLayer);
		const layer = Layer.mergeAll(configLayer, credsLayer);

		const result = await runWithProvider(
			Effect.gen(function* () {
				const cf = yield* TestCredentialsFile;
				return yield* cf.load;
			}).pipe(Effect.provide(layer)),
		);

		expect(Object.keys(result.profiles)).toHaveLength(2);
		expect(result.profiles.personal.github_token).toMatch(/^ghp_/);
		expect(result.profiles.work.github_token).toMatch(/^ghp_/);
		expect(result.profiles.work.op_service_account_token).toMatch(/^ops_/);
	});

	it("fails when credentials file does not exist", async () => {
		const configLayer = makeConfigLayer(fixture("valid-minimal.toml"));
		const credsLayer = makeCredentialsLayer(fixture("nonexistent-creds.toml"), configLayer);
		const layer = Layer.mergeAll(configLayer, credsLayer);

		const result = await runWithProvider(
			Effect.gen(function* () {
				const cf = yield* TestCredentialsFile;
				return yield* Effect.either(cf.load);
			}).pipe(Effect.provide(layer)),
		);

		expect(result._tag).toBe("Left");
	});
});

// ---------------------------------------------------------------------------
// Full layer with temp directories (filesystem integration)
// ---------------------------------------------------------------------------

describe("ConfigFiles filesystem integration", () => {
	it("writes and reads config round-trip via ConfigFileService", async () => {
		const result = await runScoped(
			// @ts-expect-error -- Scope requirement from makeTempDirectoryScoped widens R beyond FileSystem constraint
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const tmpDir = yield* fs.makeTempDirectoryScoped();
				const configPath = join(tmpDir, "config.toml");

				yield* fs.writeFileString(configPath, fixtureContent("valid-full.toml"));

				const layer = makeConfigLayer(configPath);
				return yield* Effect.provide(
					Effect.gen(function* () {
						const cf = yield* TestConfigFile;
						const config = yield* cf.load;

						// Write it back
						const writePath = join(tmpDir, "config-out.toml");
						yield* cf.write(config, writePath);

						// Read it back
						return yield* cf.loadFrom(writePath);
					}),
					layer,
				);
			}),
		);

		expect(result.owner).toBe("test-owner");
		expect(result.log_level).toBe("verbose");
		expect(result.groups["my-projects"].repos).toEqual(["repo-one", "repo-two"]);
	});

	it("AppDirs resolves config directory from XDG_CONFIG_HOME", async () => {
		const provider = ConfigProvider.fromMap(
			new Map([
				["HOME", "/test/home"],
				["XDG_CONFIG_HOME", "/test/xdg-config"],
			]),
		);

		const layer = XdgConfigLive({
			app: new AppDirsConfig({ namespace: "reposets" }),
			config: {
				tag: TestConfigFile,
				schema: ConfigSchema,
				codec: TomlCodec,
				strategy: FirstMatch,
				resolvers: [ExplicitPath(fixture("valid-minimal.toml"))],
			},
		});

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const appDirs = yield* AppDirs;
				return yield* appDirs.config;
			}).pipe(Effect.withConfigProvider(provider), Effect.provide(layer), Effect.provide(NodeFileSystem.layer)),
		);

		expect(result).toBe("/test/xdg-config/reposets");
	});

	it("AppDirs falls back to HOME/.reposets when XDG_CONFIG_HOME is unset", async () => {
		const provider = ConfigProvider.fromMap(new Map([["HOME", "/test/home"]]));

		const layer = XdgConfigLive({
			app: new AppDirsConfig({ namespace: "reposets" }),
			config: {
				tag: TestConfigFile,
				schema: ConfigSchema,
				codec: TomlCodec,
				strategy: FirstMatch,
				resolvers: [ExplicitPath(fixture("valid-minimal.toml"))],
			},
		});

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const appDirs = yield* AppDirs;
				return yield* appDirs.config;
			}).pipe(Effect.withConfigProvider(provider), Effect.provide(layer), Effect.provide(NodeFileSystem.layer)),
		);

		expect(result).toBe("/test/home/.reposets");
	});

	it("loads both config and credentials from temp directory", async () => {
		const result = await runScoped(
			// @ts-expect-error -- Scope requirement from makeTempDirectoryScoped widens R beyond FileSystem constraint
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const tmpDir = yield* fs.makeTempDirectoryScoped();

				yield* fs.writeFileString(join(tmpDir, "config.toml"), fixtureContent("valid-full.toml"));
				yield* fs.writeFileString(join(tmpDir, "credentials.toml"), fixtureContent("valid-credentials.toml"));

				const configLayer = makeConfigLayer(join(tmpDir, "config.toml"));
				const credsLayer = makeCredentialsLayer(join(tmpDir, "credentials.toml"), configLayer);
				const layer = Layer.mergeAll(configLayer, credsLayer);

				return yield* Effect.provide(
					Effect.gen(function* () {
						const configFile = yield* TestConfigFile;
						const credsFile = yield* TestCredentialsFile;

						const config = yield* configFile.load;
						const creds = yield* credsFile.load;

						return { config, creds };
					}),
					layer,
				);
			}),
		);

		expect(result.config.owner).toBe("test-owner");
		expect(result.creds.profiles.personal.github_token).toMatch(/^ghp_/);
	});
});
