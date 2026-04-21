import { Command, Options } from "@effect/cli";
import { Console, Effect } from "effect";
import { ReposetsConfigFile, loadConfigWithDir } from "../../services/ConfigFiles.js";

const configOption = Options.file("config").pipe(
	Options.withDescription("Path to config directory or reposets.config.toml file"),
	Options.optional,
);

export const listCommand = Command.make("list", { config: configOption }, ({ config }) =>
	Effect.gen(function* () {
		const configFile = yield* ReposetsConfigFile;
		const { config: parsedConfig } = yield* loadConfigWithDir(configFile, config);

		const defaultOwner = parsedConfig.owner ?? "(not set)";
		yield* Console.log(`Default owner: ${defaultOwner}\n`);

		for (const [groupName, group] of Object.entries(parsedConfig.groups)) {
			const owner = group.owner ?? parsedConfig.owner ?? "(not set)";
			yield* Console.log(`[${groupName}] (owner: ${owner})`);

			for (const repo of group.repos) {
				yield* Console.log(`  - ${owner}/${repo}`);
			}

			if (group.settings?.length) {
				yield* Console.log(`  settings: ${group.settings.join(", ")}`);
			}

			if (group.environments?.length) {
				yield* Console.log(`  environments: ${group.environments.join(", ")}`);
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
				if (parts.length) yield* Console.log(`  secrets: ${parts.join(", ")}`);
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
				if (parts.length) yield* Console.log(`  variables: ${parts.join(", ")}`);
			}

			if (group.rulesets?.length) {
				yield* Console.log(`  rulesets: ${group.rulesets.join(", ")}`);
			}
			if (group.credentials) {
				yield* Console.log(`  credentials: ${group.credentials}`);
			}
			yield* Console.log("");
		}
	}),
).pipe(Command.withDescription("Show config summary"));
