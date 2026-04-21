// @ts-nocheck -- Effect Command/Layer variance makes precise typing impractical for CLI test helpers
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "@effect/cli";
import { NodeContext } from "@effect/platform-node";
import { ConfigProvider, Effect, Layer, Option } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppDirsConfig, ConfigFile, ExplicitPath, FirstMatch, TomlCodec, XdgConfigLive } from "xdg-effect";
import { credentialsCommand } from "../../src/cli/commands/credentials.js";
import { doctorCommand } from "../../src/cli/commands/doctor.js";
import { initCommand } from "../../src/cli/commands/init.js";
import { listCommand } from "../../src/cli/commands/list.js";
import { syncCommand } from "../../src/cli/commands/sync.js";
import { validateCommand } from "../../src/cli/commands/validate.js";
import { ConfigSchema } from "../../src/schemas/config.js";
import { CredentialsSchema } from "../../src/schemas/credentials.js";
import { RepoSyncConfigFile, RepoSyncCredentialsFile } from "../../src/services/ConfigFiles.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_MINIMAL_CONFIG = `[groups.my-projects]\nrepos = ["repo-one", "repo-two"]\n`;

const VALID_FULL_CONFIG = `owner = "test-owner"
log_level = "verbose"

[settings.defaults]
has_wiki = false
has_issues = true
delete_branch_on_merge = true

[secrets.inline.value]
MY_SECRET = "secret-value"

[variables.common.value]
NODE_ENV = "production"

[groups.my-projects]
repos = ["repo-one", "repo-two"]
settings = ["defaults"]
secrets = { actions = ["inline"] }
variables = { actions = ["common"] }
`;

const VALID_CREDENTIALS = `[profiles.personal]\ngithub_token = "ghp_test1234567890abcdefghijklmnopqrstuv"\n`;

const INVALID_TOML = `[groups.broken\nrepos = ["missing-bracket"\n`;

const INVALID_SCHEMA = `owner = "test-owner"\nlog_level = "info"\n`;

const CONFIG_WITH_BAD_REFS = `[settings.defaults]
has_wiki = false

[groups.my-projects]
repos = ["repo-one"]
settings = ["nonexistent-settings"]
secrets = { actions = ["nonexistent-secrets"] }
variables = { actions = ["nonexistent-vars"] }
rulesets = ["nonexistent-ruleset"]
`;

const CONFIG_WITH_TYPOS = `ownr = "test-owner"
log_levl = "info"

[groups.my-projects]
repos = ["repo-one"]
rpos = ["typo"]
`;

const CONFIG_WITH_CLEANUP_TYPOS = `[groups.my-projects]
repos = ["repo-one"]

[groups.my-projects.cleanup]
secerts = true
variabls = true

[groups.my-projects.cleanup.secrets]
actionz = true

[groups.my-projects.cleanup.variables]
actionz = true
`;

const CONFIG_WITH_ALL_SCOPES = `owner = "test-owner"

[settings.defaults]
has_wiki = false

[secrets.deploy.value]
DEPLOY_KEY = "key"

[secrets.bot.value]
BOT_TOKEN = "token"

[variables.common.value]
NODE_ENV = "production"

[variables.env-vars.value]
CI = "true"

[rulesets.protect-main]
name = "protect-main"
type = "branch"
enforcement = "active"

[rulesets.protect-main.conditions.ref_name]
include = ["~DEFAULT_BRANCH"]
exclude = []

[[rulesets.protect-main.rules]]
type = "deletion"

[groups.my-projects]
repos = ["repo-one", "repo-two"]
credentials = "personal"
settings = ["defaults"]
environments = ["staging"]
secrets = { actions = ["deploy"], dependabot = ["bot"], codespaces = ["deploy"], environments = { staging = ["deploy"] } }
variables = { actions = ["common"], environments = { staging = ["env-vars"] } }
rulesets = ["protect-main"]

[groups.my-projects.cleanup]
rulesets = true
environments = true

[groups.my-projects.cleanup.secrets]
actions = true

[groups.my-projects.cleanup.variables]
actions = true

[environments.staging]
wait_timer = 0
`;

const CONFIG_WITH_FILE_SECRETS = `[secrets.from-files.file]
APP_KEY = "./keys/app-key.pem"

[variables.from-files.file]
CERT = "./certs/cert.pem"

[groups.my-projects]
repos = ["repo-one"]
secrets = { actions = ["from-files"] }
variables = { actions = ["from-files"] }
`;

const CREDENTIALS_WITH_BAD_PROFILE_REF = `[profiles.personal]
github_token = "ghp_test1234567890abcdefghijklmnopqrstuv"
`;

const CONFIG_WITH_CREDS_REF = `[groups.my-projects]
repos = ["repo-one"]
credentials = "nonexistent-profile"
`;

const CONFIG_WITH_BAD_ENV_REFS = `[groups.my-projects]
repos = ["repo-one"]
environments = ["nonexistent-env"]
secrets = { environments = { ghost = ["missing-secrets"] } }
variables = { environments = { ghost = ["missing-vars"] } }
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
	tmpDir = join(tmpdir(), `reposets-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
	vi.restoreAllMocks();
});

const testProvider = ConfigProvider.fromMap(new Map([["HOME", "/test/home"]]));

function makeTestConfigLayer(configPath: string) {
	return XdgConfigLive({
		app: new AppDirsConfig({ namespace: "reposets", fallbackDir: Option.none(), dirs: Option.none() }),
		config: {
			tag: RepoSyncConfigFile,
			schema: ConfigSchema,
			codec: TomlCodec,
			strategy: FirstMatch,
			resolvers: [ExplicitPath(configPath)],
		},
	});
}

function makeTestCredentialsLayer(credentialsPath: string, configLayer: ReturnType<typeof makeTestConfigLayer>) {
	return ConfigFile.Live({
		tag: RepoSyncCredentialsFile,
		schema: CredentialsSchema,
		codec: TomlCodec,
		strategy: FirstMatch,
		resolvers: [ExplicitPath(credentialsPath)],
	}).pipe(Layer.provide(configLayer));
}

/**
 * Build a layer with AppDirs pointing config dir at the given path.
 * Uses an explicit dirs override so no real XDG resolution happens.
 */
function makeAppDirsLayer(configDir: string) {
	return XdgConfigLive({
		app: new AppDirsConfig({
			namespace: "reposets",
			fallbackDir: Option.none(),
			dirs: Option.some({
				config: Option.some(configDir),
				data: Option.none(),
				cache: Option.none(),
				state: Option.none(),
				runtime: Option.none(),
			}),
		}),
		config: {
			tag: RepoSyncConfigFile,
			schema: ConfigSchema,
			codec: TomlCodec,
			strategy: FirstMatch,
			resolvers: [ExplicitPath(join(configDir, "reposets.config.toml"))],
		},
	});
}

/**
 * Build a layer with AppDirs + RepoSyncCredentialsFile pointing at the given config dir.
 * Used for credentials command tests that need the credentials service.
 */
function makeAppDirsWithCredsLayer(configDir: string) {
	const credsPath = join(configDir, "reposets.credentials.toml");
	const base = makeAppDirsLayer(configDir);
	const credsLayer = ConfigFile.Live({
		tag: RepoSyncCredentialsFile,
		schema: CredentialsSchema,
		codec: TomlCodec,
		strategy: FirstMatch,
		resolvers: [ExplicitPath(credsPath)],
		defaultPath: Effect.succeed(credsPath),
	}).pipe(Layer.provide(base));
	return Layer.mergeAll(base, credsLayer);
}

function writeFixture(dir: string, filename: string, content: string): string {
	const path = join(dir, filename);
	writeFileSync(path, content);
	return path;
}

// biome-ignore lint/suspicious/noExplicitAny: Effect Command/Layer variance prevents precise typing in test helpers
function runCommand(command: any, args: string[], layer: any) {
	const root = Command.make("reposets").pipe(Command.withSubcommands([command]));
	const cli = Command.run(root, { name: "reposets", version: "0.0.0" });
	return Effect.runPromise(
		Effect.suspend(() => cli(["node", "reposets", ...args])).pipe(
			Effect.withConfigProvider(testProvider),
			Effect.provide(layer),
			Effect.provide(NodeContext.layer),
		),
	);
}

// ---------------------------------------------------------------------------
// init command
// ---------------------------------------------------------------------------

describe("init command", () => {
	it("creates config and credentials files in project directory", async () => {
		const layer = makeAppDirsLayer(tmpDir);
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

		await runCommand(initCommand, ["init", "--project"], layer);

		expect(existsSync(join(tmpDir, "reposets.config.toml"))).toBe(true);
		expect(existsSync(join(tmpDir, "reposets.credentials.toml"))).toBe(true);

		const config = readFileSync(join(tmpDir, "reposets.config.toml"), "utf-8");
		expect(config).toContain("reposets configuration");

		const creds = readFileSync(join(tmpDir, "reposets.credentials.toml"), "utf-8");
		expect(creds).toContain("reposets credentials");
	});

	it("creates .gitignore with credentials file in project mode", async () => {
		const layer = makeAppDirsLayer(tmpDir);
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

		await runCommand(initCommand, ["init", "--project"], layer);

		const gitignore = readFileSync(join(tmpDir, ".gitignore"), "utf-8");
		expect(gitignore).toContain("reposets.credentials.toml");
	});

	it("does not overwrite existing config files", async () => {
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
		const layer = makeAppDirsLayer(tmpDir);
		writeFixture(tmpDir, "reposets.config.toml", "# existing config");
		writeFixture(tmpDir, "reposets.credentials.toml", "# existing creds");

		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await runCommand(initCommand, ["init", "--project"], layer);

		const config = readFileSync(join(tmpDir, "reposets.config.toml"), "utf-8");
		expect(config).toBe("# existing config");

		const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
		expect(output).toContain("already exists");
	});

	it("creates files in XDG config dir when --project is not set", async () => {
		const xdgDir = join(tmpDir, "xdg-config", "reposets");
		const layer = makeAppDirsLayer(xdgDir);

		await runCommand(initCommand, ["init"], layer);

		expect(existsSync(join(xdgDir, "reposets.config.toml"))).toBe(true);
		expect(existsSync(join(xdgDir, "reposets.credentials.toml"))).toBe(true);
	});

	it("appends to existing .gitignore in project mode", async () => {
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
		const layer = makeAppDirsLayer(tmpDir);
		writeFixture(tmpDir, ".gitignore", "node_modules\n");

		await runCommand(initCommand, ["init", "--project"], layer);

		const gitignore = readFileSync(join(tmpDir, ".gitignore"), "utf-8");
		expect(gitignore).toContain("node_modules");
		expect(gitignore).toContain("reposets.credentials.toml");
	});
});

// ---------------------------------------------------------------------------
// credentials command
// ---------------------------------------------------------------------------

describe("credentials command", () => {
	it("creates a new credential profile", async () => {
		const xdgDir = join(tmpDir, "xdg-config", "reposets");
		mkdirSync(xdgDir, { recursive: true });
		const layer = makeAppDirsWithCredsLayer(xdgDir);

		await runCommand(
			credentialsCommand,
			["credentials", "create", "--profile", "test", "--github-token", "ghp_testtoken123"],
			layer,
		);

		const credsPath = join(xdgDir, "reposets.credentials.toml");
		expect(existsSync(credsPath)).toBe(true);
		const content = readFileSync(credsPath, "utf-8");
		expect(content).toContain("ghp_testtoken123");
		expect(content).toContain("test");
	});

	it("lists credential profiles", async () => {
		const xdgDir = join(tmpDir, "xdg-config", "reposets");
		mkdirSync(xdgDir, { recursive: true });
		writeFixture(xdgDir, "reposets.credentials.toml", VALID_CREDENTIALS);
		const layer = makeAppDirsWithCredsLayer(xdgDir);

		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await runCommand(credentialsCommand, ["credentials", "list"], layer);

		const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
		expect(output).toContain("[personal]");
		expect(output).toContain("ghp_");
	});

	it("deletes a credential profile", async () => {
		const xdgDir = join(tmpDir, "xdg-config", "reposets");
		mkdirSync(xdgDir, { recursive: true });
		writeFixture(xdgDir, "reposets.credentials.toml", VALID_CREDENTIALS);
		const layer = makeAppDirsWithCredsLayer(xdgDir);

		await runCommand(credentialsCommand, ["credentials", "delete", "--profile", "personal"], layer);

		const content = readFileSync(join(xdgDir, "reposets.credentials.toml"), "utf-8");
		expect(content).not.toContain("personal");
	});

	it("reports error when creating duplicate profile", async () => {
		const xdgDir = join(tmpDir, "xdg-config", "reposets");
		mkdirSync(xdgDir, { recursive: true });
		writeFixture(xdgDir, "reposets.credentials.toml", VALID_CREDENTIALS);
		const layer = makeAppDirsWithCredsLayer(xdgDir);

		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		await runCommand(
			credentialsCommand,
			["credentials", "create", "--profile", "personal", "--github-token", "ghp_new"],
			layer,
		);

		const output = errorSpy.mock.calls.map((c) => c[0]).join("\n");
		expect(output).toContain("already exists");
	});

	it("reports error when deleting nonexistent profile", async () => {
		const xdgDir = join(tmpDir, "xdg-config", "reposets");
		mkdirSync(xdgDir, { recursive: true });
		writeFixture(xdgDir, "reposets.credentials.toml", VALID_CREDENTIALS);
		const layer = makeAppDirsWithCredsLayer(xdgDir);

		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		await runCommand(credentialsCommand, ["credentials", "delete", "--profile", "nonexistent"], layer);

		const output = errorSpy.mock.calls.map((c) => c[0]).join("\n");
		expect(output).toContain("not found");
	});

	it("shows message when no profiles exist", async () => {
		const xdgDir = join(tmpDir, "xdg-config", "reposets");
		mkdirSync(xdgDir, { recursive: true });
		const layer = makeAppDirsWithCredsLayer(xdgDir);

		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await runCommand(credentialsCommand, ["credentials", "list"], layer);

		const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
		expect(output).toContain("No credential profiles");
	});

	it("rejects create with no tokens provided", async () => {
		const xdgDir = join(tmpDir, "xdg-config", "reposets");
		mkdirSync(xdgDir, { recursive: true });
		const layer = makeAppDirsWithCredsLayer(xdgDir);

		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		await runCommand(credentialsCommand, ["credentials", "create", "--profile", "empty"], layer);

		const output = errorSpy.mock.calls.map((c) => c[0]).join("\n");
		expect(output).toContain("--github-token or --op-token");
	});
});

// ---------------------------------------------------------------------------
// list command
// ---------------------------------------------------------------------------

describe("list command", () => {
	it("lists groups and repos from a valid config", async () => {
		const configPath = writeFixture(tmpDir, "config.toml", VALID_FULL_CONFIG);
		const configLayer = makeTestConfigLayer(configPath);

		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await runCommand(listCommand, ["list", "--config", configPath], configLayer);

		const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
		expect(output).toContain("test-owner");
		expect(output).toContain("[my-projects]");
		expect(output).toContain("repo-one");
		expect(output).toContain("repo-two");
		expect(output).toContain("settings: defaults");
	});

	it("lists minimal config with defaults", async () => {
		const configPath = writeFixture(tmpDir, "config.toml", VALID_MINIMAL_CONFIG);
		const configLayer = makeTestConfigLayer(configPath);

		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await runCommand(listCommand, ["list", "--config", configPath], configLayer);

		const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
		expect(output).toContain("(not set)");
		expect(output).toContain("[my-projects]");
	});

	it("lists all scope types (secrets, variables, rulesets, credentials, environments)", async () => {
		const configPath = writeFixture(tmpDir, "config.toml", CONFIG_WITH_ALL_SCOPES);
		const configLayer = makeTestConfigLayer(configPath);

		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await runCommand(listCommand, ["list", "--config", configPath], configLayer);

		const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
		expect(output).toContain("secrets:");
		expect(output).toContain("actions:");
		expect(output).toContain("dependabot:");
		expect(output).toContain("codespaces:");
		expect(output).toContain("environments.staging:");
		expect(output).toContain("variables:");
		expect(output).toContain("rulesets: protect-main");
		expect(output).toContain("credentials: personal");
		expect(output).toContain("environments: staging");
	});
});

// ---------------------------------------------------------------------------
// validate command
// ---------------------------------------------------------------------------

describe("validate command", () => {
	it("validates a correct config successfully", async () => {
		const configPath = writeFixture(tmpDir, "config.toml", VALID_FULL_CONFIG);
		const credsPath = writeFixture(tmpDir, "creds.toml", VALID_CREDENTIALS);
		const configLayer = makeTestConfigLayer(configPath);
		const credsLayer = makeTestCredentialsLayer(credsPath, configLayer);
		const layer = Layer.mergeAll(configLayer, credsLayer);

		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await runCommand(validateCommand, ["validate", "--config", configPath], layer);

		const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
		expect(output).toContain("Config schema: valid");
	});

	it("reports cross-reference errors", async () => {
		const configPath = writeFixture(tmpDir, "config.toml", CONFIG_WITH_BAD_REFS);
		const configLayer = makeTestConfigLayer(configPath);
		// No credentials file — provide a failing credentials layer
		const credsLayer = makeTestCredentialsLayer(join(tmpDir, "nonexistent.toml"), configLayer);
		const layer = Layer.mergeAll(configLayer, credsLayer);

		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "log").mockImplementation(() => {});
		await runCommand(validateCommand, ["validate", "--config", configPath], layer);

		const errors = errorSpy.mock.calls.map((c) => c[0]).join("\n");
		expect(errors).toContain("unknown settings group 'nonexistent-settings'");
		expect(errors).toContain("unknown secrets group 'nonexistent-secrets'");
		expect(errors).toContain("unknown variables group 'nonexistent-vars'");
		expect(errors).toContain("unknown ruleset 'nonexistent-ruleset'");
	});

	it("reports config validation failure for invalid schema", async () => {
		const configPath = writeFixture(tmpDir, "config.toml", INVALID_SCHEMA);
		const configLayer = makeTestConfigLayer(configPath);
		const credsLayer = makeTestCredentialsLayer(join(tmpDir, "nonexistent.toml"), configLayer);
		const layer = Layer.mergeAll(configLayer, credsLayer);

		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "log").mockImplementation(() => {});
		await runCommand(validateCommand, ["validate", "--config", configPath], layer);

		const errors = errorSpy.mock.calls.map((c) => c[0]).join("\n");
		expect(errors).toContain("validation failed");
	});

	it("reports credentials as optional when not found", async () => {
		const configPath = writeFixture(tmpDir, "config.toml", VALID_MINIMAL_CONFIG);
		const configLayer = makeTestConfigLayer(configPath);
		const credsLayer = makeTestCredentialsLayer(join(tmpDir, "nonexistent.toml"), configLayer);
		const layer = Layer.mergeAll(configLayer, credsLayer);

		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await runCommand(validateCommand, ["validate", "--config", configPath], layer);

		const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
		expect(output).toContain("not found (optional)");
	});

	it("reports missing file references in secrets and variables", async () => {
		const configPath = writeFixture(tmpDir, "config.toml", CONFIG_WITH_FILE_SECRETS);
		const configLayer = makeTestConfigLayer(configPath);
		const credsLayer = makeTestCredentialsLayer(join(tmpDir, "nonexistent.toml"), configLayer);
		const layer = Layer.mergeAll(configLayer, credsLayer);

		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "log").mockImplementation(() => {});
		await runCommand(validateCommand, ["validate", "--config", configPath], layer);

		const errors = errorSpy.mock.calls.map((c) => c[0]).join("\n");
		expect(errors).toContain("secrets.from-files.file.APP_KEY: file not found");
		expect(errors).toContain("variables.from-files.file.CERT: file not found");
	});

	it("reports unknown credentials profile reference", async () => {
		const configPath = writeFixture(tmpDir, "config.toml", CONFIG_WITH_CREDS_REF);
		const credsPath = writeFixture(tmpDir, "creds.toml", CREDENTIALS_WITH_BAD_PROFILE_REF);
		const configLayer = makeTestConfigLayer(configPath);
		const credsLayer = makeTestCredentialsLayer(credsPath, configLayer);
		const layer = Layer.mergeAll(configLayer, credsLayer);

		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "log").mockImplementation(() => {});
		await runCommand(validateCommand, ["validate", "--config", configPath], layer);

		const errors = errorSpy.mock.calls.map((c) => c[0]).join("\n");
		expect(errors).toContain("unknown credentials profile 'nonexistent-profile'");
	});

	it("reports unknown environment and environment-scoped group references", async () => {
		const configPath = writeFixture(tmpDir, "config.toml", CONFIG_WITH_BAD_ENV_REFS);
		const configLayer = makeTestConfigLayer(configPath);
		const credsLayer = makeTestCredentialsLayer(join(tmpDir, "nonexistent.toml"), configLayer);
		const layer = Layer.mergeAll(configLayer, credsLayer);

		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "log").mockImplementation(() => {});
		await runCommand(validateCommand, ["validate", "--config", configPath], layer);

		const errors = errorSpy.mock.calls.map((c) => c[0]).join("\n");
		expect(errors).toContain("unknown environment 'nonexistent-env'");
		expect(errors).toContain("secrets.environments.ghost references unknown secrets group 'missing-secrets'");
		expect(errors).toContain("variables.environments.ghost references unknown variables group 'missing-vars'");
	});
});

// ---------------------------------------------------------------------------
// doctor command
// ---------------------------------------------------------------------------

describe("doctor command", () => {
	it("passes schema validation on valid config", async () => {
		const configPath = writeFixture(tmpDir, "reposets.config.toml", VALID_MINIMAL_CONFIG);
		const configLayer = makeTestConfigLayer(configPath);

		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await runCommand(doctorCommand, ["doctor", "--config", configPath], configLayer);

		const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
		expect(output).toContain("Schema validation: passed");
		expect(output).toContain("No unknown keys detected");
	});

	it("detects unknown top-level keys and suggests corrections", async () => {
		const configPath = writeFixture(tmpDir, "reposets.config.toml", CONFIG_WITH_TYPOS);
		const configLayer = makeTestConfigLayer(configPath);

		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await runCommand(doctorCommand, ["doctor", "--config", configPath], configLayer);

		const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
		expect(output).toContain("unknown top-level key 'ownr'");
		expect(output).toContain("did you mean 'owner'");
		expect(output).toContain("unknown top-level key 'log_levl'");
		expect(output).toContain("did you mean 'log_level'");
		expect(output).toContain("warning(s) found");
	});

	it("detects unknown group keys", async () => {
		const configPath = writeFixture(tmpDir, "reposets.config.toml", CONFIG_WITH_TYPOS);
		const configLayer = makeTestConfigLayer(configPath);

		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await runCommand(doctorCommand, ["doctor", "--config", configPath], configLayer);

		const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
		expect(output).toContain("unknown key 'rpos' in groups.my-projects");
		expect(output).toContain("did you mean 'repos'");
	});

	it("detects cleanup section typos including secrets and variables sub-keys", async () => {
		const configPath = writeFixture(tmpDir, "reposets.config.toml", CONFIG_WITH_CLEANUP_TYPOS);
		const configLayer = makeTestConfigLayer(configPath);

		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await runCommand(doctorCommand, ["doctor", "--config", configPath], configLayer);

		const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
		expect(output).toContain("unknown key 'secerts' in groups.my-projects.cleanup");
		expect(output).toContain("did you mean 'secrets'");
		expect(output).toContain("unknown key 'variabls' in groups.my-projects.cleanup");
		expect(output).toContain("did you mean 'variables'");
		expect(output).toContain("unknown key 'actionz' in groups.my-projects.cleanup.secrets");
		expect(output).toContain("did you mean 'actions'");
		expect(output).toContain("unknown key 'actionz' in groups.my-projects.cleanup.variables");
	});

	it("reports TOML parse error on invalid syntax", async () => {
		const configPath = writeFixture(tmpDir, "reposets.config.toml", INVALID_TOML);
		// The config layer will fail, but doctor catches loadConfigWithDir failure
		// However, doctor then tries raw TOML parsing separately
		const configLayer = makeTestConfigLayer(configPath);

		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "log").mockImplementation(() => {});
		await runCommand(doctorCommand, ["doctor", "--config", configPath], configLayer);

		const errors = errorSpy.mock.calls.map((c) => c[0]).join("\n");
		// Doctor should report either the config load error or the TOML parse error
		expect(errors.length).toBeGreaterThan(0);
	});

	it("displays token permission requirements", async () => {
		const configPath = writeFixture(tmpDir, "reposets.config.toml", VALID_MINIMAL_CONFIG);
		const configLayer = makeTestConfigLayer(configPath);

		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await runCommand(doctorCommand, ["doctor", "--config", configPath], configLayer);

		const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
		expect(output).toContain("Administration");
		expect(output).toContain("Secrets");
		expect(output).toContain("Variables");
		expect(output).toContain("GPG keys");
	});
});

// ---------------------------------------------------------------------------
// sync command (early-exit paths only — full sync requires live API stubs)
// ---------------------------------------------------------------------------

describe("sync command", () => {
	it("reports error when no GitHub token is found (no credentials)", async () => {
		const configPath = writeFixture(tmpDir, "config.toml", VALID_MINIMAL_CONFIG);
		const configLayer = makeTestConfigLayer(configPath);
		const credsLayer = makeTestCredentialsLayer(join(tmpDir, "nonexistent.toml"), configLayer);
		const layer = Layer.mergeAll(configLayer, credsLayer);

		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		await runCommand(syncCommand, ["sync", "--config", configPath], layer);

		const output = errorSpy.mock.calls.map((c) => c[0]).join("\n");
		expect(output).toContain("No GitHub token found");
	});

	it("reports error when credentials exist but have no token", async () => {
		const configPath = writeFixture(tmpDir, "config.toml", VALID_MINIMAL_CONFIG);
		const credsPath = writeFixture(tmpDir, "creds.toml", "[profiles]\n");
		const configLayer = makeTestConfigLayer(configPath);
		const credsLayer = makeTestCredentialsLayer(credsPath, configLayer);
		const layer = Layer.mergeAll(configLayer, credsLayer);

		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		await runCommand(syncCommand, ["sync", "--config", configPath], layer);

		const output = errorSpy.mock.calls.map((c) => c[0]).join("\n");
		expect(output).toContain("No GitHub token found");
	});

	it("applies --log-level flag and prints dry-run banner before engine invocation", async () => {
		const configPath = writeFixture(tmpDir, "config.toml", VALID_MINIMAL_CONFIG);
		const credsPath = writeFixture(tmpDir, "creds.toml", VALID_CREDENTIALS);
		const configLayer = makeTestConfigLayer(configPath);
		const credsLayer = makeTestCredentialsLayer(credsPath, configLayer);
		const layer = Layer.mergeAll(configLayer, credsLayer);

		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		// This will fail at the SyncEngine layer (no real API), but we exercise
		// the --log-level and --dry-run branches before that point
		try {
			await runCommand(syncCommand, ["sync", "--config", configPath, "--dry-run", "--log-level", "verbose"], layer);
		} catch {
			// Expected: SyncEngine layer construction fails without real API client
		}

		const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
		expect(output).toContain("DRY RUN");
	});
});
