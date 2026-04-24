import { Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";
import { AppDirs } from "xdg-effect";
import type { Credentials } from "../../schemas/credentials.js";
import { ReposetsCredentialsFile, makeConfigFilesLive } from "../../services/ConfigFiles.js";

const EMPTY_CREDENTIALS: Credentials = { profiles: {} };

const profileOption = Options.text("profile").pipe(Options.withDescription("Credential profile name"));

const githubTokenOption = Options.text("github-token").pipe(
	Options.withDescription("GitHub personal access token"),
	Options.optional,
);

const opTokenOption = Options.text("op-token").pipe(
	Options.withDescription("1Password service account token"),
	Options.optional,
);

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
			yield* appDirs.ensureConfig;

			const credentialsFile = yield* ReposetsCredentialsFile;
			const creds = yield* credentialsFile.loadOrDefault(EMPTY_CREDENTIALS);

			if (creds.profiles[profile]) {
				yield* Effect.logError(`Profile '${profile}' already exists. Delete it first.`);
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
				yield* Effect.logError("Provide at least --github-token or --op-token.");
				return;
			}

			yield* credentialsFile.update(
				(current) => ({
					profiles: {
						...current.profiles,
						[profile]: { github_token: newProfile.github_token ?? "", ...newProfile },
					},
				}),
				EMPTY_CREDENTIALS,
			);

			yield* Effect.log(`Created profile '${profile}'.`);
		}).pipe(Effect.provide(makeConfigFilesLive(Option.none()))),
).pipe(Command.withDescription("Add a credential profile"));

const listCredsCommand = Command.make("list", {}, () =>
	Effect.gen(function* () {
		const credentialsFile = yield* ReposetsCredentialsFile;
		const creds = yield* credentialsFile.loadOrDefault(EMPTY_CREDENTIALS);

		if (Object.keys(creds.profiles).length === 0) {
			yield* Effect.log("No credential profiles configured.");
			return;
		}

		for (const [name, profile] of Object.entries(creds.profiles)) {
			yield* Effect.log(`[${name}]`);
			if (profile.github_token) {
				yield* Effect.log(`  github_token: ${redactToken(profile.github_token)}`);
			}
			if (profile.op_service_account_token) {
				yield* Effect.log(`  op_service_account_token: ${redactToken(profile.op_service_account_token)}`);
			}
			yield* Effect.log("");
		}
	}).pipe(Effect.provide(makeConfigFilesLive(Option.none()))),
).pipe(Command.withDescription("List profiles (tokens redacted)"));

const deleteCommand = Command.make("delete", { profile: profileOption }, ({ profile }) =>
	Effect.gen(function* () {
		const appDirs = yield* AppDirs;
		yield* appDirs.ensureConfig;

		const credentialsFile = yield* ReposetsCredentialsFile;
		const creds = yield* credentialsFile.loadOrDefault(EMPTY_CREDENTIALS);

		if (!creds.profiles[profile]) {
			yield* Effect.logError(`Profile '${profile}' not found.`);
			return;
		}

		const { [profile]: _, ...remainingProfiles } = creds.profiles;
		yield* credentialsFile.save({ profiles: remainingProfiles });

		yield* Effect.log(`Deleted profile '${profile}'.`);
	}).pipe(Effect.provide(makeConfigFilesLive(Option.none()))),
).pipe(Command.withDescription("Remove a profile"));

export const credentialsCommand = Command.make("credentials").pipe(
	Command.withDescription("Manage credential profiles"),
	Command.withSubcommands([createCommand, listCredsCommand, deleteCommand]),
);
