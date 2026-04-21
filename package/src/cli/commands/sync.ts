import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Command, Options } from "@effect/cli";
import { Console, Effect, Layer } from "effect";
import { resolveConfigDir } from "../../lib/config-path.js";
import type { LogLevel } from "../../schemas/config.js";
import { ConfigLoader } from "../../services/ConfigLoader.js";
import { CredentialResolverLive } from "../../services/CredentialResolver.js";
import { GitHubClientLive } from "../../services/GitHubClient.js";
import { OnePasswordClientLive } from "../../services/OnePasswordClient.js";
import { SyncEngine, SyncEngineLive } from "../../services/SyncEngine.js";
import { SyncLoggerLive } from "../../services/SyncLogger.js";

const configOption = Options.file("config").pipe(
	Options.withDescription("Path to config directory or repo-sync.config.toml file"),
	Options.optional,
);

const groupOption = Options.text("group").pipe(
	Options.withDescription("Sync only a specific repo group"),
	Options.optional,
);

const repoOption = Options.text("repo").pipe(Options.withDescription("Sync only a specific repo"), Options.optional);

const dryRunOption = Options.boolean("dry-run").pipe(
	Options.withDescription("Preview changes without making them"),
	Options.withDefault(false),
);

const noCleanupOption = Options.boolean("no-cleanup").pipe(
	Options.withDescription("Skip cleanup of undeclared resources"),
	Options.withDefault(false),
);

const logLevelOption = Options.choice("log-level", ["silent", "info", "verbose", "debug"]).pipe(
	Options.withDescription("Set output verbosity (overrides log_level in config)"),
	Options.optional,
);

export const syncCommand = Command.make(
	"sync",
	{
		config: configOption,
		group: groupOption,
		repo: repoOption,
		dryRun: dryRunOption,
		noCleanup: noCleanupOption,
		logLevel: logLevelOption,
	},
	({ config, group, repo, dryRun, noCleanup, logLevel: logLevelFlag }) =>
		Effect.gen(function* () {
			const configFlag = config._tag === "Some" ? config.value : undefined;
			const configDir = resolveConfigDir({ configFlag });

			if (!configDir) {
				yield* Console.error("No config found. Run 'repo-sync init' to create one.");
				return;
			}

			const configToml = readFileSync(join(configDir, "repo-sync.config.toml"), "utf-8");

			let credsToml = "";
			try {
				credsToml = readFileSync(join(configDir, "repo-sync.credentials.toml"), "utf-8");
			} catch {
				// credentials file is optional
			}

			const loader = yield* ConfigLoader;
			const parsedConfig = yield* loader.parseConfig(configToml);
			const credentials = yield* loader.parseCredentials(credsToml);

			const profileNames = Object.keys(credentials.profiles);
			const defaultProfile = profileNames.length === 1 ? profileNames[0] : undefined;
			const token = defaultProfile ? credentials.profiles[defaultProfile]?.github_token : undefined;

			if (!token) {
				yield* Console.error("No GitHub token found. Run 'repo-sync credentials create' first.");
				return;
			}

			// CLI flag overrides config file value
			const logLevel: LogLevel = logLevelFlag._tag === "Some" ? logLevelFlag.value : parsedConfig.log_level;

			const githubLayer = GitHubClientLive(token);
			const opLayer = OnePasswordClientLive;
			const resolverLayer = Layer.provide(CredentialResolverLive, opLayer);
			const loggerLayer = SyncLoggerLive({ dryRun, logLevel });
			const engineLayer = Layer.provideMerge(
				SyncEngineLive,
				Layer.merge(Layer.merge(githubLayer, resolverLayer), loggerLayer),
			);

			const groupFilter = group._tag === "Some" ? group.value : undefined;
			const repoFilter = repo._tag === "Some" ? repo.value : undefined;

			if (dryRun && logLevel !== "silent") {
				yield* Console.log("DRY RUN \u2014 no changes will be made\n");
			}

			yield* Effect.provide(
				Effect.gen(function* () {
					const engine = yield* SyncEngine;
					yield* engine.syncAll(parsedConfig, credentials, {
						dryRun,
						noCleanup,
						groupFilter,
						repoFilter,
						configDir,
					});
				}),
				engineLayer,
			);
		}),
).pipe(Command.withDescription("Sync repos with GitHub"));
