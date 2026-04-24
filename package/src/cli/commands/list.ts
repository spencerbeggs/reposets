import { Command, Options } from "@effect/cli";
import { Effect } from "effect";
import { ReposetsConfigFile, makeConfigFilesLive } from "../../services/ConfigFiles.js";

const configOption = Options.file("config").pipe(
	Options.withDescription("Path to config directory or reposets.config.toml file"),
	Options.optional,
);

export const listCommand = Command.make("list", { config: configOption }, ({ config }) =>
	Effect.gen(function* () {
		const configFile = yield* ReposetsConfigFile;
		const sources = yield* configFile.discover;
		if (sources.length === 0) {
			yield* Effect.logError("No config file found.");
			return;
		}
		const parsedConfig = sources[0].value;

		const defaultOwner = parsedConfig.owner ?? "(not set)";
		yield* Effect.log(`Default owner: ${defaultOwner}\n`);

		for (const [groupName, group] of Object.entries(parsedConfig.groups)) {
			const owner = group.owner ?? parsedConfig.owner ?? "(not set)";
			yield* Effect.log(`[${groupName}] (owner: ${owner})`);

			for (const repo of group.repos) {
				yield* Effect.log(`  - ${owner}/${repo}`);
			}

			if (group.settings?.length) {
				yield* Effect.log(`  settings: ${group.settings.join(", ")}`);
			}

			if (group.environments?.length) {
				yield* Effect.log(`  environments: ${group.environments.join(", ")}`);
			}

			if (group.secrets) {
				const parts: string[] = [];
				if (group.secrets.actions?.length) {
					parts.push(`actions:[${group.secrets.actions.join(",")}]`);
				}
				if (group.secrets.dependabot?.length) {
					parts.push(`dependabot:[${group.secrets.dependabot.join(",")}]`);
				}
				if (group.secrets.codespaces?.length) {
					parts.push(`codespaces:[${group.secrets.codespaces.join(",")}]`);
				}
				if (group.secrets.environments) {
					for (const [envName, envGroups] of Object.entries(group.secrets.environments)) {
						if (envGroups.length) {
							parts.push(`environments.${envName}:[${envGroups.join(",")}]`);
						}
					}
				}
				if (parts.length) yield* Effect.log(`  secrets: ${parts.join(", ")}`);
			}

			if (group.variables) {
				const parts: string[] = [];
				if (group.variables.actions?.length) {
					parts.push(`actions:[${group.variables.actions.join(",")}]`);
				}
				if (group.variables.environments) {
					for (const [envName, envGroups] of Object.entries(group.variables.environments)) {
						if (envGroups.length) {
							parts.push(`environments.${envName}:[${envGroups.join(",")}]`);
						}
					}
				}
				if (parts.length) yield* Effect.log(`  variables: ${parts.join(", ")}`);
			}

			if (group.rulesets?.length) {
				yield* Effect.log(`  rulesets: ${group.rulesets.join(", ")}`);
			}
			if (group.credentials) {
				yield* Effect.log(`  credentials: ${group.credentials}`);
			}
			yield* Effect.log("");
		}
	}).pipe(Effect.provide(makeConfigFilesLive(config))),
).pipe(Command.withDescription("Show config summary"));
