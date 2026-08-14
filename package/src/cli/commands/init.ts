import { cwd } from "node:process";
import { AppDirs } from "@effected/xdg";
import { Effect, FileSystem, Path } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { CONFIG_FILENAME, CREDENTIALS_FILENAME } from "../../services/ConfigFiles.js";

const projectFlag = Flag.boolean("project").pipe(
	Flag.withDescription("Scaffold into the current directory instead of the XDG config directory"),
);

const CONFIG_TEMPLATE = `# reposets configuration
# See: https://github.com/spencerbeggs/reposets

# The owner is NOT set here. It belongs to the credential profile a group
# names, because a token authenticates as an identity — see
# reposets.credentials.toml.

# --- Settings groups ---
# [settings.defaults]
# has_wiki = false
# has_issues = true
# delete_branch_on_merge = true

# --- Secret groups ---
# A secret group is exactly one kind: file, value, or resolved.
#
# [secrets.from-files.file]
# APP_KEY = "./private/app-key"
#
# [secrets.inline.value]
# NON_SECRET = "safe-to-commit"
#
# [secrets.from-creds.resolved]
# NPM_TOKEN = "MY_NPM_TOKEN"   # a label from the credentials file's [resolve]

# --- Variable groups ---
# [variables.turbo.value]
# DO_NOT_TRACK = "1"

# --- Rulesets ---
# [rulesets.default-branch]
# name = "default-branch"
# type = "branch"
# enforcement = "active"
# targets = "default"
# deletion = true
# required_signatures = true

# --- Deployment environments ---
# [environments.production]
# wait_timer = 5
# prevent_self_review = true

# --- Groups ---
# [groups.my-projects]
# repos = ["repo-one", "repo-two"]
# credentials = "personal"   # REQUIRED: the profile this group authenticates as
# settings = ["defaults"]
# secrets = { actions = ["from-creds"] }
`;

const CREDENTIALS_TEMPLATE = `# reposets credentials
#
# This file holds REFERENCES, never secret values. Each entry names where a
# credential lives — a 1Password item or an environment variable — so the file
# itself discloses nothing if it leaks.
#
# 1Password references are resolved with OP_SERVICE_ACCOUNT_TOKEN from the
# environment. That token is deliberately not stored here: it unlocks
# everything else, so it does not belong in the same file as the things it
# unlocks.
#
# Every group in reposets.config.toml names one of these profiles in its
# 'credentials' field — that is the identity the group is synced as, and the
# owner its repositories belong to. One owner per profile: a token that reaches
# both your account and an org is declared as two profiles sharing a reference.

# Every profile declares who it acts as: exactly one of username or org.
# That is not bookkeeping — it decides which settings are even valid, and it
# lets 'reposets validate' reject an organization-only setting with no network.
#
# [profiles.personal]
# username = "your-github-username"
# github_token = { op = "op://Private/github/token" }
#
# [profiles.work]
# org = "your-org"
# github_token = { op = "op://Private/github/work-token" }

# For CI, where a platform secret store injects the value:
# [profiles.ci]
# org = "your-org"
# github_token = { env = "REPOSETS_GITHUB_TOKEN" }

# Named values for 'resolved' secret and variable groups:
# [profiles.personal.resolve.op]
# MY_NPM_TOKEN = "op://Private/npm/token"
#
# [profiles.personal.resolve.env]
# MY_BOT_NAME = "BOT_NAME"
#
# [profiles.personal.resolve.file]
# MY_CERT = "./certs/bot.pem"
`;

/**
 * `reposets init` — scaffold the config and credentials files.
 *
 * @remarks
 * Writes into the XDG config directory by default, or the current directory
 * with `--project`. Existing files are reported and never overwritten — this
 * command must be safe to re-run against a configured machine.
 *
 * The credentials file is added to `.gitignore` in both modes. It contains only
 * references and so is not catastrophic to commit, but it still names a
 * person's vault layout, and the habit is worth keeping.
 *
 * @public
 */
export const initHandler = (project: boolean) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const appDirs = yield* AppDirs;

		const targetDir = project ? cwd() : yield* appDirs.ensureConfig;
		yield* fs.makeDirectory(targetDir, { recursive: true });

		/** Write a file unless it is already there; report either way. */
		const scaffold = (name: string, contents: string): Effect.Effect<void, never, never> =>
			Effect.gen(function* () {
				const target = path.join(targetDir, name);
				const exists = yield* fs.exists(target).pipe(Effect.orElseSucceed(() => false));
				if (exists) {
					yield* Effect.log(`Already exists: ${target}`);
					return;
				}
				const written = yield* fs.writeFileString(target, contents).pipe(Effect.option);
				yield* written._tag === "Some"
					? Effect.log(`Created: ${target}`)
					: Effect.logError(`Could not write: ${target}`);
			});

		yield* scaffold(CONFIG_FILENAME, CONFIG_TEMPLATE);
		yield* scaffold(CREDENTIALS_FILENAME, CREDENTIALS_TEMPLATE);

		// Keep the credentials file out of version control.
		const gitignorePath = path.join(targetDir, ".gitignore");
		const existing = yield* fs.readFileString(gitignorePath).pipe(Effect.orElseSucceed(() => undefined));

		if (existing === undefined) {
			const written = yield* fs.writeFileString(gitignorePath, `${CREDENTIALS_FILENAME}\n`).pipe(Effect.option);
			if (written._tag === "Some") {
				yield* Effect.log(`Created .gitignore with ${CREDENTIALS_FILENAME}`);
			}
		} else if (!existing.includes(CREDENTIALS_FILENAME)) {
			const separator = existing.endsWith("\n") ? "" : "\n";
			const written = yield* fs
				.writeFileString(gitignorePath, `${existing}${separator}${CREDENTIALS_FILENAME}\n`)
				.pipe(Effect.option);
			if (written._tag === "Some") {
				yield* Effect.log(`Added ${CREDENTIALS_FILENAME} to .gitignore`);
			}
		}

		yield* Effect.log("");
		yield* Effect.log("Done. Edit the config, then add a credential reference with:");
		yield* Effect.log('  reposets credentials create --profile personal --username YOU --op "op://Vault/item/field"');
	});

/**
 * `reposets init`.
 *
 * @public
 */
export const initCommand = Command.make("init", { project: projectFlag }, ({ project }) => initHandler(project)).pipe(
	Command.withDescription("Scaffold reposets.config.toml and reposets.credentials.toml"),
);
