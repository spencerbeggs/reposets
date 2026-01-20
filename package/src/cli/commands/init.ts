import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command, Options } from "@effect/cli";
import { Console, Effect } from "effect";
import { configDir } from "../../lib/xdg.js";

const projectOption = Options.boolean("project").pipe(
	Options.withDescription("Create config in current directory instead of XDG/home location"),
	Options.withDefault(false),
);

const CONFIG_TEMPLATE = `# gh-sync configuration
# See: https://github.com/spencerbeggs/gh-sync

# Default owner for all repo groups (can be overridden per group)
# owner = "your-github-username"

# --- Settings groups ---
# [settings.defaults]
# has_wiki = false
# has_issues = true
# delete_branch_on_merge = true

# --- Secret groups ---
# [secrets.deploy]
# NPM_TOKEN = { op = "op://vault/item/field" }
# API_KEY = { file = "./private/api-key" }
# INLINE_SECRET = { value = "my-secret" }

# --- Variable groups ---
# [variables.common]
# NODE_ENV = { value = "production" }

# --- Ruleset groups ---
# [rulesets.standard]
# workflow = { file = "./rulesets/workflow.json" }

# --- Cleanup defaults ---
# [cleanup]
# secrets = false
# variables = false
# rulesets = false

# --- Repo groups ---
# [repos.my-projects]
# names = ["repo-one", "repo-two"]
# settings = ["defaults"]
# secrets = { actions = ["deploy"] }
# variables = { actions = ["common"] }
# rulesets = ["standard"]
`;

const CREDENTIALS_TEMPLATE = `# gh-sync credentials (keep this file private)
# See: https://github.com/spencerbeggs/gh-sync

# [profiles.personal]
# github_token = "ghp_your_token_here"
# op_service_account_token = "ops_your_token_here"
`;

const CREDENTIALS_FILE = "gh-sync.credentials.toml";
const CONFIG_FILE = "gh-sync.config.toml";

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
