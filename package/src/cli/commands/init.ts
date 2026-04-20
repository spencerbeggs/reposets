import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command, Options } from "@effect/cli";
import { Console, Effect } from "effect";
import { configDir } from "../../lib/xdg.js";

const projectOption = Options.boolean("project").pipe(
	Options.withDescription("Create config in current directory instead of XDG/home location"),
	Options.withDefault(false),
);

const CONFIG_TEMPLATE = `# repo-sync configuration
# See: https://github.com/spencerbeggs/repo-sync

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
`;

const CREDENTIALS_TEMPLATE = `# repo-sync credentials (keep this file private)
# See: https://github.com/spencerbeggs/repo-sync

# [profiles.personal]
# github_token = "ghp_your_token_here"
# op_service_account_token = "ops_your_token_here"
`;

const CREDENTIALS_FILE = "repo-sync.credentials.toml";
const CONFIG_FILE = "repo-sync.config.toml";

export const initCommand = Command.make("init", { project: projectOption }, ({ project }) =>
	Effect.gen(function* () {
		const targetDir = project ? process.cwd() : configDir();

		if (!existsSync(targetDir)) {
			mkdirSync(targetDir, { recursive: true });
		}

		const configPath = join(targetDir, CONFIG_FILE);
		const credsPath = join(targetDir, CREDENTIALS_FILE);

		if (existsSync(configPath)) {
			yield* Console.log(`Config already exists: ${configPath}`);
		} else {
			writeFileSync(configPath, CONFIG_TEMPLATE);
			yield* Console.log(`Created: ${configPath}`);
		}

		if (existsSync(credsPath)) {
			yield* Console.log(`Credentials already exists: ${credsPath}`);
		} else {
			writeFileSync(credsPath, CREDENTIALS_TEMPLATE);
			yield* Console.log(`Created: ${credsPath}`);
		}

		if (project) {
			const gitignorePath = join(targetDir, ".gitignore");
			if (existsSync(gitignorePath)) {
				const content = readFileSync(gitignorePath, "utf-8");
				if (!content.includes(CREDENTIALS_FILE)) {
					appendFileSync(gitignorePath, `\n${CREDENTIALS_FILE}\n`);
					yield* Console.log(`Added ${CREDENTIALS_FILE} to .gitignore`);
				}
			} else {
				writeFileSync(gitignorePath, `${CREDENTIALS_FILE}\n`);
				yield* Console.log(`Created .gitignore with ${CREDENTIALS_FILE}`);
			}
		} else {
			const gitignorePath = join(targetDir, ".gitignore");
			if (!existsSync(gitignorePath)) {
				writeFileSync(gitignorePath, `${CREDENTIALS_FILE}\n`);
				yield* Console.log(`Created .gitignore in ${targetDir}`);
			}
		}

		yield* Console.log("\nDone! Edit your config and credentials files to get started.");
	}),
).pipe(Command.withDescription("Scaffold config files"));
