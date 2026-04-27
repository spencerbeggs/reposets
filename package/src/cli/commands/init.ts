import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";
import { AppDirs } from "xdg-effect";
import { makeConfigFilesLive } from "../../services/ConfigFiles.js";

const projectOption = Options.boolean("project").pipe(
	Options.withDescription("Create config in current directory instead of XDG/home location"),
	Options.withDefault(false),
);

const CONFIG_TEMPLATE = `# reposets configuration
# See: https://github.com/spencerbeggs/reposets

# Default owner for all groups (can be overridden per group)
# owner = "your-github-username"

# --- Settings groups ---
# [settings.defaults]
# has_wiki = false
# has_issues = true
# delete_branch_on_merge = true

# --- Secret groups ---
# Secrets can be file, value, or resolved kind:
#
# [secrets.from-files.file]
# APP_KEY = "./private/app-key"
#
# [secrets.inline.value]
# STATIC_SECRET = "my-secret"
#
# [secrets.from-creds.resolved]
# NPM_TOKEN = "MY_NPM_TOKEN"

# --- Variable groups ---
# [variables.turbo.value]
# DO_NOT_TRACK = "1"
# TURBO_TELEMETRY_DISABLED = "1"
#
# [variables.bot.resolved]
# APP_BOT_NAME = "MY_BOT_NAME"

# --- Rulesets ---
# [rulesets.default-branch]
# name = "default-branch"
# enforcement = "active"
# target = "branch"
#
# [rulesets.default-branch.conditions.ref_name]
# include = ["~DEFAULT_BRANCH"]
# exclude = []
#
# [[rulesets.default-branch.rules]]
# type = "deletion"

# --- Advanced security ---
# Nested inside a settings group (folded into the same PATCH /repos call).
# Some fields are GHAS-licensed and only work on public repos or
# private repos with a GHAS subscription. Org-only fields are silently
# skipped on personal accounts.
#
# [settings.defaults.security_and_analysis]
# secret_scanning = "enabled"
# secret_scanning_push_protection = "enabled"
# dependabot_security_updates = "enabled"

# --- Security feature toggles ---
# Dedicated PUT/DELETE endpoints; omit a key to leave it untouched.
#
# [security.oss-defaults]
# vulnerability_alerts = true
# automated_security_fixes = true
# private_vulnerability_reporting = true

# --- CodeQL default setup ---
# Applies via PATCH /repos/{o}/{r}/code-scanning/default-setup.
# Languages not detected in the repo are skipped with a warning.
#
# [code_scanning.oss-defaults]
# state = "configured"
# languages = ["javascript-typescript", "python"]
# query_suite = "extended"
# threat_model = "remote"

# --- Cleanup defaults ---
# [cleanup]
# secrets = false
# variables = false
# rulesets = false

# --- Groups ---
# [groups.my-projects]
# repos = ["repo-one", "repo-two"]
# settings = ["defaults"]
# secrets = { actions = ["from-files", "from-creds"] }
# variables = { actions = ["turbo", "bot"] }
# rulesets = ["default-branch"]
# security = ["oss-defaults"]
# code_scanning = ["oss-defaults"]
`;

const CREDENTIALS_TEMPLATE = `# reposets credentials (keep this file private)
# See: https://github.com/spencerbeggs/reposets

# [profiles.personal]
# github_token = "ghp_your_token_here"
# op_service_account_token = "ops_your_token_here"
`;

const CREDENTIALS_FILE = "reposets.credentials.toml";
const CONFIG_FILE = "reposets.config.toml";

export const initCommand = Command.make("init", { project: projectOption }, ({ project }) =>
	Effect.gen(function* () {
		const appDirs = yield* AppDirs;
		const xdgConfigDir = yield* appDirs.config;
		const targetDir = project ? process.cwd() : xdgConfigDir;

		if (!existsSync(targetDir)) {
			mkdirSync(targetDir, { recursive: true });
		}

		const configPath = join(targetDir, CONFIG_FILE);
		const credsPath = join(targetDir, CREDENTIALS_FILE);

		if (existsSync(configPath)) {
			yield* Effect.log(`Config already exists: ${configPath}`);
		} else {
			writeFileSync(configPath, CONFIG_TEMPLATE);
			yield* Effect.log(`Created: ${configPath}`);
		}

		if (existsSync(credsPath)) {
			yield* Effect.log(`Credentials already exists: ${credsPath}`);
		} else {
			writeFileSync(credsPath, CREDENTIALS_TEMPLATE);
			yield* Effect.log(`Created: ${credsPath}`);
		}

		if (project) {
			const gitignorePath = join(targetDir, ".gitignore");
			if (existsSync(gitignorePath)) {
				const content = readFileSync(gitignorePath, "utf-8");
				if (!content.includes(CREDENTIALS_FILE)) {
					appendFileSync(gitignorePath, `\n${CREDENTIALS_FILE}\n`);
					yield* Effect.log(`Added ${CREDENTIALS_FILE} to .gitignore`);
				}
			} else {
				writeFileSync(gitignorePath, `${CREDENTIALS_FILE}\n`);
				yield* Effect.log(`Created .gitignore with ${CREDENTIALS_FILE}`);
			}
		} else {
			const gitignorePath = join(targetDir, ".gitignore");
			if (!existsSync(gitignorePath)) {
				writeFileSync(gitignorePath, `${CREDENTIALS_FILE}\n`);
				yield* Effect.log(`Created .gitignore in ${targetDir}`);
			}
		}

		yield* Effect.log("\nDone! Edit your config and credentials files to get started.");
	}).pipe(Effect.provide(makeConfigFilesLive(Option.none()))),
).pipe(Command.withDescription("Scaffold config files"));
