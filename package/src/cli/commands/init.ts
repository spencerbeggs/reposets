import type { CliTheme } from "@effected/cli-kit";
import { CliExit, CliMessage } from "@effected/cli-kit";
import { CliUi, Select } from "@effected/cli-kit/ui";
import type { Audience } from "@effected/env";
import { AtomicFile } from "@effected/files";
import { AppDirs } from "@effected/xdg";
import { Effect, FileSystem, Option, Path } from "effect";
import { Command, Flag } from "effect/cli";
import { configSchemaHost, credentialsSchemaHost, schemaDirective } from "../../schemas/hosted.js";
import { CONFIG_FILENAME, CREDENTIALS_FILENAME } from "../../services/ConfigFiles.js";
import { Invocation } from "../../services/Invocation.js";

/**
 * `--project` scaffolds into the working directory, `--no-project` (or
 * `--project=false`) into the XDG config directory.
 *
 * @remarks
 * Optional rather than defaulted to `false`, so the handler can tell "not
 * given" from "given as false": only the former asks a person where to put the
 * files. A run that cannot ask takes the XDG directory, as it always has.
 */
const projectFlag = Flag.Boolean("project").pipe(
	Flag.optional,
	Flag.withDescription(
		"Scaffold into the current directory (--no-project: the XDG config directory). Asked when omitted on a terminal",
	),
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
 * Where the files go when `--project` was not given.
 *
 * @remarks
 * An interactive run asks, showing both resolved paths so the choice is about
 * a directory and not a word; the XDG directory is first and so the default.
 * A run that cannot ask (an agent, CI, a pipe) answers XDG without loading the
 * screen, which is exactly what `init` did before it could ask. A cancel is the
 * kit's `Cancelled` and propagates: exit 130, nothing written.
 */
const chooseProject = (configDir: string, cwd: string) =>
	CliUi.prompt(
		Select.screen({
			message: "Where should reposets keep its config?",
			choices: [
				{ label: "XDG config directory", value: false, detail: configDir },
				{ label: "This directory", value: true, detail: cwd },
			],
		}),
		{ otherwise: false },
	);

/**
 * `reposets init` — scaffold the config and credentials files.
 *
 * @remarks
 * Writes into the XDG config directory with `--no-project`, or the current
 * directory with `--project`. Without either, an interactive run asks (see
 * {@link chooseProject}) and a non-interactive one uses the XDG directory.
 * Existing files are reported and never overwritten — this command must be
 * safe to re-run against a configured machine.
 *
 * Each scaffolded file opens with a `#:schema` directive naming the versioned
 * JSON Schema it was written against, taken from the same `HostedSchema` the
 * schema build writes that document's `$id` from (`src/schemas/hosted.ts`).
 * Taplo and Tombi bind the file to that exact version without consulting
 * SchemaStore's catalog, and to the TOML decoder the line is a comment.
 *
 * The credentials file is added to `.gitignore` in both modes. It contains only
 * references and so is not catastrophic to commit, but it still names a
 * person's vault layout, and the habit is worth keeping.
 *
 * What was created or found goes to stdout as status lines; the next-steps
 * guidance to stderr. A file that could not be written is reported on stderr
 * and exits 1.
 *
 * @param project - `true` for the working directory, `false` for XDG,
 * `undefined` when the flag was omitted
 *
 * @public
 */
export const initHandler = (project: boolean | undefined) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const appDirs = yield* AppDirs;
		const { cwd } = yield* Invocation;

		const inProject = project ?? (yield* chooseProject(appDirs.dirs.config, cwd));
		const targetDir = inProject ? cwd : yield* appDirs.ensureConfig;
		yield* fs.makeDirectory(targetDir, { recursive: true });

		/**
		 * A write that fails is a real failure of this command — the user asked
		 * for a file and did not get one — so it is reported on stderr and the
		 * run exits 1 through `CliExit`. The remaining files are still attempted:
		 * one unwritable path should not hide what else did or did not happen.
		 *
		 * Written with `CliMessage.failure` rather than `Effect.logError` so no log
		 * level can hide the one line that explains the exit code.
		 */
		const failed = (target: string): Effect.Effect<void, never, CliExit | CliTheme | Audience> =>
			CliMessage.failure(`Could not write: ${target}`).pipe(Effect.andThen(CliExit.set(1)));

		/** Write a file unless it is already there; report either way. */
		const scaffold = (
			name: string,
			contents: string,
		): Effect.Effect<void, never, CliExit | CliTheme | Audience | FileSystem.FileSystem | Path.Path> =>
			Effect.gen(function* () {
				const target = path.join(targetDir, name);
				const exists = yield* fs.exists(target).pipe(Effect.orElseSucceed(() => false));
				if (exists) {
					yield* CliMessage.info(`Already exists: ${target}`);
					return;
				}
				// Atomic because `exists` above trusts whatever is there: a partial file
				// left by a crash would read as `Already exists` on every later run.
				// `exists` follows links, so the one link that reaches here is a dangling
				// one. `--project` may run in a checkout nobody has reviewed, so the link
				// is replaced rather than followed: a committed `reposets.config.toml ->
				// ~/somewhere` must not create a file outside the checkout.
				const written = yield* AtomicFile.write(target, contents, { links: "replace" }).pipe(Effect.option);
				yield* written._tag === "Some" ? CliMessage.success(`Created: ${target}`) : failed(target);
			});

		yield* scaffold(CONFIG_FILENAME, `${schemaDirective(configSchemaHost)}${CONFIG_TEMPLATE}`);
		yield* scaffold(CREDENTIALS_FILENAME, `${schemaDirective(credentialsSchemaHost)}${CREDENTIALS_TEMPLATE}`);

		// Keep the credentials file out of version control.
		const gitignorePath = path.join(targetDir, ".gitignore");
		// A linked `.gitignore` is left alone, read included: following it would
		// append to a file outside the checkout, and replacing it would copy that
		// file's contents into the checkout. Nothing here can tell a link the user
		// made on purpose from one a cloned repository planted, so the user adds
		// the line themselves.
		const linked = yield* fs.lstat(gitignorePath).pipe(
			Effect.map((info) => info.type === "SymbolicLink"),
			Effect.orElseSucceed(() => false),
		);
		const existing = linked
			? undefined
			: yield* fs.readFileString(gitignorePath).pipe(Effect.orElseSucceed(() => undefined));

		if (linked) {
			yield* CliMessage.warning(
				`${gitignorePath} is a symbolic link, so ${CREDENTIALS_FILENAME} was not added to it; add it yourself`,
			);
		} else if (existing === undefined) {
			const written = yield* AtomicFile.write(gitignorePath, `${CREDENTIALS_FILENAME}\n`, { links: "replace" }).pipe(
				Effect.option,
			);
			yield* written._tag === "Some"
				? CliMessage.success(`Created .gitignore with ${CREDENTIALS_FILENAME}`)
				: failed(gitignorePath);
		} else if (!existing.includes(CREDENTIALS_FILENAME)) {
			const separator = existing.endsWith("\n") ? "" : "\n";
			// The one file here that is rewritten rather than created, and it is the
			// user's: atomic, a crash leaves the old contents or the new, whole.
			const written = yield* AtomicFile.write(gitignorePath, `${existing}${separator}${CREDENTIALS_FILENAME}\n`, {
				links: "replace",
			}).pipe(Effect.option);
			yield* written._tag === "Some"
				? CliMessage.success(`Added ${CREDENTIALS_FILENAME} to .gitignore`)
				: failed(gitignorePath);
		}

		// Guidance about what to do next, not a record of what was done — so it
		// goes to stderr with the other diagnostics.
		yield* Effect.log("");
		yield* Effect.log("Done. Edit the config, then add a credential reference:");
		yield* Effect.log("  reposets credentials create        (on a terminal, asks for each value)");
		yield* Effect.log('  reposets credentials create --profile personal --username YOU --op "op://Vault/item/field"');
	});

/**
 * `reposets init`.
 *
 * @public
 */
export const initCommand = Command.make("init", { project: projectFlag }, ({ project }) =>
	initHandler(Option.getOrUndefined(project)),
).pipe(Command.withDescription("Scaffold reposets.config.toml and reposets.credentials.toml"));
