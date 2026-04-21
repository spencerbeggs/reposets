import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command, Options } from "@effect/cli";
import { Console, Effect } from "effect";
import { parse, stringify } from "smol-toml";
import { AppDirs } from "xdg-effect";

const profileOption = Options.text("profile").pipe(Options.withDescription("Credential profile name"));

const githubTokenOption = Options.text("github-token").pipe(
	Options.withDescription("GitHub personal access token"),
	Options.optional,
);

const opTokenOption = Options.text("op-token").pipe(
	Options.withDescription("1Password service account token"),
	Options.optional,
);

function getCredentialsPath(configDir: string): string {
	return join(configDir, "repo-sync.credentials.toml");
}

function loadCredentialsFile(configDir: string): Record<string, unknown> {
	const path = getCredentialsPath(configDir);
	if (!existsSync(path)) return {};
	const content = readFileSync(path, "utf-8");
	if (content.trim() === "") return {};
	return parse(content);
}

function saveCredentialsFile(configDir: string, data: Record<string, unknown>): void {
	writeFileSync(getCredentialsPath(configDir), stringify(data));
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
			const data = loadCredentialsFile(configDir);
			const profiles = (data.profiles ?? {}) as Record<string, unknown>;

			if (profiles[profile]) {
				yield* Console.error(`Profile '${profile}' already exists. Delete it first.`);
				return;
			}

			const newProfile: Record<string, string> = {};
			if (githubToken._tag === "Some") {
				newProfile.github_token = githubToken.value;
			}
			if (opToken._tag === "Some") {
				newProfile.op_service_account_token = opToken.value;
			}

			if (Object.keys(newProfile).length === 0) {
				yield* Console.error("Provide at least --github-token or --op-token.");
				return;
			}

			profiles[profile] = newProfile;
			data.profiles = profiles;
			saveCredentialsFile(configDir, data);

			yield* Console.log(`Created profile '${profile}'.`);
		}),
).pipe(Command.withDescription("Add a credential profile"));

const listCredsCommand = Command.make("list", {}, () =>
	Effect.gen(function* () {
		const appDirs = yield* AppDirs;
		const configDir = yield* appDirs.config;
		const data = loadCredentialsFile(configDir);
		const profiles = (data.profiles ?? {}) as Record<string, Record<string, string>>;

		if (Object.keys(profiles).length === 0) {
			yield* Console.log("No credential profiles configured.");
			return;
		}

		for (const [name, profile] of Object.entries(profiles)) {
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
		const configDir = yield* appDirs.config;
		const data = loadCredentialsFile(configDir);
		const profiles = (data.profiles ?? {}) as Record<string, unknown>;

		if (!profiles[profile]) {
			yield* Console.error(`Profile '${profile}' not found.`);
			return;
		}

		delete profiles[profile];
		data.profiles = profiles;
		saveCredentialsFile(configDir, data);

		yield* Console.log(`Deleted profile '${profile}'.`);
	}),
).pipe(Command.withDescription("Remove a profile"));

export const credentialsCommand = Command.make("credentials").pipe(
	Command.withDescription("Manage credential profiles"),
	Command.withSubcommands([createCommand, listCredsCommand, deleteCommand]),
);
