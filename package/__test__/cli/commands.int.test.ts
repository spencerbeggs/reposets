// @ts-nocheck -- Effect Command/Layer variance makes precise typing impractical for CLI test helpers
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "@effect/cli";
import { NodeContext } from "@effect/platform-node";
import { ConfigProvider, Effect, LogLevel, Logger } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { credentialsCommand } from "../../src/cli/commands/credentials.js";
import { doctorCommand } from "../../src/cli/commands/doctor.js";
import { initCommand } from "../../src/cli/commands/init.js";
import { listCommand } from "../../src/cli/commands/list.js";
import { syncCommand } from "../../src/cli/commands/sync.js";
import { validateCommand } from "../../src/cli/commands/validate.js";

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

function writeFixture(dir: string, filename: string, content: string): string {
	const path = join(dir, filename);
	writeFileSync(path, content);
	return path;
}

/**
 * Run a CLI command in isolation. Commands provide their own config layers
 * via makeConfigFilesLive() internally; this helper only supplies
 * NodeContext, a custom ConfigProvider (for HOME etc.), and a test logger
 * that captures output into arrays instead of writing to console.
 */
// biome-ignore lint/suspicious/noExplicitAny: Effect Command/Layer variance prevents precise typing in test helpers
function runCommand(command: any, args: string[], provider?: ConfigProvider.ConfigProvider) {
	const messages: string[] = [];
	const errors: string[] = [];
	const testLogger = Logger.make(({ logLevel, message }) => {
		const text = typeof message === "string" ? message : String(message);
		if (LogLevel.greaterThanEqual(logLevel, LogLevel.Error)) {
			errors.push(text);
		} else {
			messages.push(text);
		}
	});

	const root = Command.make("reposets").pipe(Command.withSubcommands([command]));
	const cli = Command.run(root, { name: "reposets", version: "0.0.0" });
	const promise = Effect.runPromise(
		Effect.suspend(() => cli(["node", "reposets", ...args])).pipe(
			Effect.withConfigProvider(provider ?? ConfigProvider.fromMap(new Map([["HOME", tmpDir]]))),
			Effect.provide(Logger.replace(Logger.defaultLogger, testLogger)),
			Effect.provide(NodeContext.layer),
		),
	);
	return Object.assign(promise, { messages, errors });
}

// ---------------------------------------------------------------------------
// init command
// ---------------------------------------------------------------------------

describe("init command", () => {
	it("creates config and credentials files in project directory", async () => {
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

		await runCommand(initCommand, ["init", "--project"]);

		expect(existsSync(join(tmpDir, "reposets.config.toml"))).toBe(true);
		expect(existsSync(join(tmpDir, "reposets.credentials.toml"))).toBe(true);

		const config = readFileSync(join(tmpDir, "reposets.config.toml"), "utf-8");
		expect(config).toContain("reposets configuration");

		const creds = readFileSync(join(tmpDir, "reposets.credentials.toml"), "utf-8");
		expect(creds).toContain("reposets credentials");
	});

	it("creates .gitignore with credentials file in project mode", async () => {
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

		await runCommand(initCommand, ["init", "--project"]);

		const gitignore = readFileSync(join(tmpDir, ".gitignore"), "utf-8");
		expect(gitignore).toContain("reposets.credentials.toml");
	});

	it("does not overwrite existing config files", async () => {
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
		writeFixture(tmpDir, "reposets.config.toml", "# existing config");
		writeFixture(tmpDir, "reposets.credentials.toml", "# existing creds");

		const result = runCommand(initCommand, ["init", "--project"]);
		await result;

		const config = readFileSync(join(tmpDir, "reposets.config.toml"), "utf-8");
		expect(config).toBe("# existing config");

		expect(result.messages.join("\n")).toContain("already exists");
	});

	it("creates files in XDG config dir when --project is not set", async () => {
		// With HOME=tmpDir, AppDirs resolves config to tmpDir/.reposets
		const expectedDir = join(tmpDir, ".reposets");

		await runCommand(initCommand, ["init"]);

		expect(existsSync(join(expectedDir, "reposets.config.toml"))).toBe(true);
		expect(existsSync(join(expectedDir, "reposets.credentials.toml"))).toBe(true);
	});

	it("appends to existing .gitignore in project mode", async () => {
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
		writeFixture(tmpDir, ".gitignore", "node_modules\n");

		await runCommand(initCommand, ["init", "--project"]);

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
		// Mock cwd so UpwardWalk doesn't find real credentials
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

		await runCommand(credentialsCommand, [
			"credentials",
			"create",
			"--profile",
			"test",
			"--github-token",
			"ghp_testtoken123",
		]);

		// With HOME=tmpDir, AppDirs resolves to tmpDir/.reposets
		const credsPath = join(tmpDir, ".reposets", "reposets.credentials.toml");
		expect(existsSync(credsPath)).toBe(true);
		const content = readFileSync(credsPath, "utf-8");
		expect(content).toContain("ghp_testtoken123");
		expect(content).toContain("test");
	});

	it("lists credential profiles", async () => {
		// Write credentials to where UpwardWalk from cwd will find them
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
		writeFixture(tmpDir, "reposets.credentials.toml", VALID_CREDENTIALS);

		const result = runCommand(credentialsCommand, ["credentials", "list"]);
		await result;

		const output = result.messages.join("\n");
		expect(output).toContain("[personal]");
		expect(output).toContain("ghp_");
	});

	it("deletes a credential profile", async () => {
		// Write credentials to XDG dir (HOME/.reposets) since delete uses ensureConfig + loadOrDefault
		const xdgDir = join(tmpDir, ".reposets");
		mkdirSync(xdgDir, { recursive: true });
		writeFixture(xdgDir, "reposets.credentials.toml", VALID_CREDENTIALS);
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

		await runCommand(credentialsCommand, ["credentials", "delete", "--profile", "personal"]);

		const content = readFileSync(join(xdgDir, "reposets.credentials.toml"), "utf-8");
		expect(content).not.toContain("personal");
	});

	it("reports error when creating duplicate profile", async () => {
		// Write credentials to XDG dir
		const xdgDir = join(tmpDir, ".reposets");
		mkdirSync(xdgDir, { recursive: true });
		writeFixture(xdgDir, "reposets.credentials.toml", VALID_CREDENTIALS);
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

		const result = runCommand(credentialsCommand, [
			"credentials",
			"create",
			"--profile",
			"personal",
			"--github-token",
			"ghp_new",
		]);
		await result;

		expect(result.errors.join("\n")).toContain("already exists");
	});

	it("reports error when deleting nonexistent profile", async () => {
		const xdgDir = join(tmpDir, ".reposets");
		mkdirSync(xdgDir, { recursive: true });
		writeFixture(xdgDir, "reposets.credentials.toml", VALID_CREDENTIALS);
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

		const result = runCommand(credentialsCommand, ["credentials", "delete", "--profile", "nonexistent"]);
		await result;

		expect(result.errors.join("\n")).toContain("not found");
	});

	it("shows message when no profiles exist", async () => {
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

		const result = runCommand(credentialsCommand, ["credentials", "list"]);
		await result;

		expect(result.messages.join("\n")).toContain("No credential profiles");
	});

	it("rejects create with no tokens provided", async () => {
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

		const result = runCommand(credentialsCommand, ["credentials", "create", "--profile", "empty"]);
		await result;

		expect(result.errors.join("\n")).toContain("--github-token or --op-token");
	});
});

// ---------------------------------------------------------------------------
// list command
// ---------------------------------------------------------------------------

describe("list command", () => {
	it("lists groups and repos from a valid config", async () => {
		const configPath = writeFixture(tmpDir, "config.toml", VALID_FULL_CONFIG);
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

		const result = runCommand(listCommand, ["list", "--config", configPath]);
		await result;

		const output = result.messages.join("\n");
		expect(output).toContain("test-owner");
		expect(output).toContain("[my-projects]");
		expect(output).toContain("repo-one");
		expect(output).toContain("repo-two");
		expect(output).toContain("settings: defaults");
	});

	it("lists minimal config with defaults", async () => {
		const configPath = writeFixture(tmpDir, "config.toml", VALID_MINIMAL_CONFIG);
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

		const result = runCommand(listCommand, ["list", "--config", configPath]);
		await result;

		const output = result.messages.join("\n");
		expect(output).toContain("(not set)");
		expect(output).toContain("[my-projects]");
	});

	it("lists all scope types (secrets, variables, rulesets, credentials, environments)", async () => {
		const configPath = writeFixture(tmpDir, "config.toml", CONFIG_WITH_ALL_SCOPES);
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

		const result = runCommand(listCommand, ["list", "--config", configPath]);
		await result;

		const output = result.messages.join("\n");
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
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

		const result = runCommand(validateCommand, ["validate", "--config", configPath]);
		await result;

		expect(result.messages.join("\n")).toContain("Config schema: valid");
	});

	it("reports cross-reference errors", async () => {
		const configPath = writeFixture(tmpDir, "config.toml", CONFIG_WITH_BAD_REFS);
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

		const result = runCommand(validateCommand, ["validate", "--config", configPath]);
		await result;

		const errors = result.errors.join("\n");
		// Cross-ref errors now surface during discover via validateConfigRefs callback
		expect(errors).toContain("unknown settings group 'nonexistent-settings'");
		expect(errors).toContain("unknown secrets group 'nonexistent-secrets'");
		expect(errors).toContain("unknown variables group 'nonexistent-vars'");
		expect(errors).toContain("unknown ruleset 'nonexistent-ruleset'");
	});

	it("reports config validation failure for invalid schema", async () => {
		const configPath = writeFixture(tmpDir, "config.toml", INVALID_SCHEMA);
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

		const result = runCommand(validateCommand, ["validate", "--config", configPath]);
		await result;

		expect(result.errors.join("\n")).toContain("validation failed");
	});

	it("reports credentials as optional when not found", async () => {
		const configPath = writeFixture(tmpDir, "config.toml", VALID_MINIMAL_CONFIG);
		// Mock cwd to tmpDir so UpwardWalk doesn't find real credentials
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

		const result = runCommand(validateCommand, ["validate", "--config", configPath]);
		await result;

		expect(result.messages.join("\n")).toContain("not found (optional)");
	});

	it("reports missing file references in secrets and variables", async () => {
		const configPath = writeFixture(tmpDir, "config.toml", CONFIG_WITH_FILE_SECRETS);
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

		const result = runCommand(validateCommand, ["validate", "--config", configPath]);
		await result;

		const errors = result.errors.join("\n");
		expect(errors).toContain("secrets.from-files.file.APP_KEY: file not found");
		expect(errors).toContain("variables.from-files.file.CERT: file not found");
	});

	it("reports unknown credentials profile reference", async () => {
		const configPath = writeFixture(tmpDir, "config.toml", CONFIG_WITH_CREDS_REF);
		// Write credentials where UpwardWalk from cwd will find them
		writeFixture(tmpDir, "reposets.credentials.toml", CREDENTIALS_WITH_BAD_PROFILE_REF);
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

		const result = runCommand(validateCommand, ["validate", "--config", configPath]);
		await result;

		expect(result.errors.join("\n")).toContain("unknown credentials profile 'nonexistent-profile'");
	});

	it("reports unknown environment and environment-scoped group references", async () => {
		const configPath = writeFixture(tmpDir, "config.toml", CONFIG_WITH_BAD_ENV_REFS);
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

		const result = runCommand(validateCommand, ["validate", "--config", configPath]);
		await result;

		const errors = result.errors.join("\n");
		// These cross-ref errors now surface during discover via validateConfigRefs
		expect(errors).toContain("unknown environment 'nonexistent-env'");
		expect(errors).toContain("in secrets.environments.'ghost': unknown secrets group 'missing-secrets'");
		expect(errors).toContain("in variables.environments.'ghost': unknown variables group 'missing-vars'");
	});
});

// ---------------------------------------------------------------------------
// doctor command
// ---------------------------------------------------------------------------

describe("doctor command", () => {
	it("passes schema validation on valid config", async () => {
		const configPath = writeFixture(tmpDir, "reposets.config.toml", VALID_MINIMAL_CONFIG);
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

		const result = runCommand(doctorCommand, ["doctor", "--config", configPath]);
		await result;

		const output = result.messages.join("\n");
		expect(output).toContain("Schema validation: passed");
		expect(output).toContain("No unknown keys detected");
	});

	it("detects unknown top-level keys and suggests corrections", async () => {
		const configPath = writeFixture(tmpDir, "reposets.config.toml", CONFIG_WITH_TYPOS);
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

		const result = runCommand(doctorCommand, ["doctor", "--config", configPath]);
		await result;

		const output = result.messages.join("\n");
		expect(output).toContain("unknown top-level key 'ownr'");
		expect(output).toContain("did you mean 'owner'");
		expect(output).toContain("unknown top-level key 'log_levl'");
		expect(output).toContain("did you mean 'log_level'");
		expect(output).toContain("warning(s) found");
	});

	it("detects unknown group keys", async () => {
		const configPath = writeFixture(tmpDir, "reposets.config.toml", CONFIG_WITH_TYPOS);
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

		const result = runCommand(doctorCommand, ["doctor", "--config", configPath]);
		await result;

		const output = result.messages.join("\n");
		expect(output).toContain("unknown key 'rpos' in groups.my-projects");
		expect(output).toContain("did you mean 'repos'");
	});

	it("detects cleanup section typos including secrets and variables sub-keys", async () => {
		const configPath = writeFixture(tmpDir, "reposets.config.toml", CONFIG_WITH_CLEANUP_TYPOS);
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

		const result = runCommand(doctorCommand, ["doctor", "--config", configPath]);
		await result;

		const output = result.messages.join("\n");
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
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

		const result = runCommand(doctorCommand, ["doctor", "--config", configPath]);
		await result;

		const errors = result.errors.join("\n");
		// Doctor should report either the config load error or the TOML parse error
		expect(errors.length).toBeGreaterThan(0);
	});

	it("displays token permission requirements", async () => {
		const configPath = writeFixture(tmpDir, "reposets.config.toml", VALID_MINIMAL_CONFIG);
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

		const result = runCommand(doctorCommand, ["doctor", "--config", configPath]);
		await result;

		const output = result.messages.join("\n");
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
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

		const result = runCommand(syncCommand, ["sync", "--config", configPath]);
		await result;

		expect(result.errors.join("\n")).toContain("No GitHub token found");
	});

	it("reports error when credentials exist but have no token", async () => {
		const configPath = writeFixture(tmpDir, "config.toml", VALID_MINIMAL_CONFIG);
		// Write empty credentials where UpwardWalk from cwd will find them
		writeFixture(tmpDir, "reposets.credentials.toml", "[profiles]\n");
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

		const result = runCommand(syncCommand, ["sync", "--config", configPath]);
		await result;

		expect(result.errors.join("\n")).toContain("No GitHub token found");
	});

	it("applies --log-level flag and prints dry-run banner before engine invocation", async () => {
		const configPath = writeFixture(tmpDir, "config.toml", VALID_MINIMAL_CONFIG);
		// Write credentials with a valid token
		writeFixture(tmpDir, "reposets.credentials.toml", VALID_CREDENTIALS);
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

		// This will fail at the SyncEngine layer (no real API), but we exercise
		// the --log-level and --dry-run branches before that point
		const result = runCommand(syncCommand, ["sync", "--config", configPath, "--dry-run", "--log-level", "verbose"]);
		try {
			await result;
		} catch {
			// Expected: SyncEngine layer construction fails without real API client
		}

		expect(result.messages.join("\n")).toContain("DRY RUN");
	});
});
