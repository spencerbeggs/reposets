import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Command, Options } from "@effect/cli";
import { Console, Effect } from "effect";
import { AppDirs } from "xdg-effect";
import type { Credentials } from "../../schemas/credentials.js";
import { RepoSyncCredentialsFile } from "../../services/ConfigFiles.js";

const CREDENTIALS_FILENAME = "repo-sync.credentials.toml";

const profileOption = Options.text("profile").pipe(Options.withDescription("Credential profile name"));

const githubTokenOption = Options.text("github-token").pipe(
	Options.withDescription("GitHub personal access token"),
	Options.optional,
);

const opTokenOption = Options.text("op-token").pipe(
	Options.withDescription("1Password service account token"),
	Options.optional,
);

function loadCredentials(credentialsFile: Effect.Effect.Success<typeof RepoSyncCredentialsFile>) {
	return credentialsFile.load.pipe(Effect.orElseSucceed((): Credentials => ({ profiles: {} })));
}

function redactToken(token: string): string {
	if (token.length <= 8) return "****";
	return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

const createCommand = Command.make(
	"create",
	{ profile: profileOption, githubToken: githubTokenOption, opToken: opTokenOption },
	({ profile, githubToken, opToken }) =>
		Effect.gen(function* () {
			const appDirs = yield* AppDirs;
			const configDir = yield* appDirs.config;
			if (!existsSync(configDir)) {
				mkdirSync(configDir, { recursive: true });
			}

			const credentialsFile = yield* RepoSyncCredentialsFile;
			const creds = yield* loadCredentials(credentialsFile);

			if (creds.profiles[profile]) {
				yield* Console.error(`Profile '${profile}' already exists. Delete it first.`);
				return;
			}

			const newProfile: { github_token?: string; op_service_account_token?: string } = {};
			if (githubToken._tag === "Some") {
				newProfile.github_token = githubToken.value;
			}
			if (opToken._tag === "Some") {
				newProfile.op_service_account_token = opToken.value;
			}

			if (!newProfile.github_token && !newProfile.op_service_account_token) {
				yield* Console.error("Provide at least --github-token or --op-token.");
				return;
			}

			const updatedCreds: Credentials = {
				profiles: {
					...creds.profiles,
					[profile]: { github_token: newProfile.github_token ?? "", ...newProfile },
				},
			};
			yield* credentialsFile.write(updatedCreds, join(configDir, CREDENTIALS_FILENAME));

			yield* Console.log(`Created profile '${profile}'.`);
		}),
).pipe(Command.withDescription("Add a credential profile"));

const listCredsCommand = Command.make("list", {}, () =>
	Effect.gen(function* () {
		const credentialsFile = yield* RepoSyncCredentialsFile;
		const creds = yield* loadCredentials(credentialsFile);

		if (Object.keys(creds.profiles).length === 0) {
			yield* Console.log("No credential profiles configured.");
			return;
		}

		for (const [name, profile] of Object.entries(creds.profiles)) {
			yield* Console.log(`[${name}]`);
			if (profile.github_token) {
				yield* Console.log(`  github_token: ${redactToken(profile.github_token)}`);
			}
			if (profile.op_service_account_token) {
				yield* Console.log(`  op_service_account_token: ${redactToken(profile.op_service_account_token)}`);
			}
			yield* Console.log("");
		}
	}),
).pipe(Command.withDescription("List profiles (tokens redacted)"));

const deleteCommand = Command.make("delete", { profile: profileOption }, ({ profile }) =>
	Effect.gen(function* () {
		const appDirs = yield* AppDirs;
		const credentialsFile = yield* RepoSyncCredentialsFile;
		const creds = yield* loadCredentials(credentialsFile);

		if (!creds.profiles[profile]) {
			yield* Console.error(`Profile '${profile}' not found.`);
			return;
		}

		const { [profile]: _, ...remainingProfiles } = creds.profiles;
		const updatedCreds: Credentials = { profiles: remainingProfiles };
		const configDir = yield* appDirs.config;
		if (!existsSync(configDir)) {
			mkdirSync(configDir, { recursive: true });
		}
		yield* credentialsFile.write(updatedCreds, join(configDir, CREDENTIALS_FILENAME));

		yield* Console.log(`Deleted profile '${profile}'.`);
	}),
).pipe(Command.withDescription("Remove a profile"));

export const credentialsCommand = Command.make("credentials").pipe(
	Command.withDescription("Manage credential profiles"),
	Command.withSubcommands([createCommand, listCredsCommand, deleteCommand]),
);
