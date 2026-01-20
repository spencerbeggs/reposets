import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Command, Options } from "@effect/cli";
import { Console, Effect, Layer } from "effect";
import { resolveConfigDir } from "../../lib/config-path.js";
import { ConfigLoader } from "../../services/ConfigLoader.js";
import { GitHubClientLive } from "../../services/GitHubClient.js";
import { OnePasswordClientLive } from "../../services/OnePasswordClient.js";
import { SyncEngine, SyncEngineLive } from "../../services/SyncEngine.js";
import { ValueResolverLive } from "../../services/ValueResolver.js";

const configOption = Options.file("config").pipe(
	Options.withDescription("Path to config directory or gh-sync.config.toml file"),
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

export const syncCommand = Command.make(
	"sync",
	{ config: configOption, group: groupOption, repo: repoOption, dryRun: dryRunOption, noCleanup: noCleanupOption },
	({ config, group, repo, dryRun, noCleanup }) =>
		Effect.gen(function* () {
			const configFlag = config._tag === "Some" ? config.value : undefined;
			const configDir = resolveConfigDir({ configFlag });

			if (!configDir) {
				yield* Console.error("No config found. Run 'gh-sync init' to create one.");
				return;
			}

			const configToml = readFileSync(join(configDir, "gh-sync.config.toml"), "utf-8");

			let credsToml = "";
			try {
				credsToml = readFileSync(join(configDir, "gh-sync.credentials.toml"), "utf-8");
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
				yield* Console.error("No GitHub token found. Run 'gh-sync credentials create' first.");
				return;
			}

			const githubLayer = GitHubClientLive(token);
			const opLayer = OnePasswordClientLive;
			const resolverLayer = Layer.provide(ValueResolverLive, opLayer);
			const engineLayer = Layer.provideMerge(SyncEngineLive, Layer.merge(githubLayer, resolverLayer));

			const groupFilter = group._tag === "Some" ? group.value : undefined;
			const repoFilter = repo._tag === "Some" ? repo.value : undefined;

			if (dryRun) {
				yield* Console.log("DRY RUN - no changes will be made\n");
			}

			yield* Effect.provide(
				Effect.gen(function* () {
					const engine = yield* SyncEngine;
					yield* engine.syncAll(parsedConfig, credentials, {
						dryRun,
						noCleanup,
						groupFilter,
						repoFilter,
					});
				}),
				engineLayer,
			);

			yield* Console.log("\nSync complete!");
		}),
).pipe(Command.withDescription("Sync repos with GitHub"));
