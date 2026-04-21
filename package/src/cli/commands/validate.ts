import { existsSync } from "node:fs";
import { join } from "node:path";
import { Command, Options } from "@effect/cli";
import { Console, Effect } from "effect";
import { ReposetsConfigFile, ReposetsCredentialsFile, loadConfigWithDir } from "../../services/ConfigFiles.js";

const configOption = Options.file("config").pipe(
	Options.withDescription("Path to config directory or reposets.config.toml file"),
	Options.optional,
);

export const validateCommand = Command.make("validate", { config: configOption }, ({ config }) =>
	Effect.gen(function* () {
		const configFile = yield* ReposetsConfigFile;
		let hasErrors = false;

		const configResult = yield* Effect.either(loadConfigWithDir(configFile, config));

		if (configResult._tag === "Left") {
			yield* Console.error(`Config validation failed: ${configResult.left.message}`);
			return;
		}

		yield* Console.log("Config schema: valid");
		const { config: parsedConfig, configDir } = configResult.right;

		for (const [groupName, group] of Object.entries(parsedConfig.groups)) {
			for (const ref of group.settings ?? []) {
				if (!parsedConfig.settings?.[ref]) {
					yield* Console.error(`Group '${groupName}': references unknown settings group '${ref}'`);
					hasErrors = true;
				}
			}

			const allSecretRefs = [
				...(group.secrets?.actions ?? []),
				...(group.secrets?.dependabot ?? []),
				...(group.secrets?.codespaces ?? []),
			];
			for (const ref of allSecretRefs) {
				if (!parsedConfig.secrets?.[ref]) {
					yield* Console.error(`Group '${groupName}': references unknown secrets group '${ref}'`);
					hasErrors = true;
				}
			}

			for (const ref of group.variables?.actions ?? []) {
				if (!parsedConfig.variables?.[ref]) {
					yield* Console.error(`Group '${groupName}': references unknown variables group '${ref}'`);
					hasErrors = true;
				}
			}

			for (const ref of group.rulesets ?? []) {
				if (!parsedConfig.rulesets?.[ref]) {
					yield* Console.error(`Group '${groupName}': references unknown ruleset '${ref}'`);
					hasErrors = true;
				}
			}

			for (const ref of group.environments ?? []) {
				if (!parsedConfig.environments?.[ref]) {
					yield* Console.error(`Group '${groupName}': references unknown environment '${ref}'`);
					hasErrors = true;
				}
			}

			// Validate environment-scoped secret group refs
			if (group.secrets?.environments) {
				for (const [envName, groupRefs] of Object.entries(group.secrets.environments)) {
					for (const ref of groupRefs) {
						if (!parsedConfig.secrets?.[ref]) {
							yield* Console.error(
								`Group '${groupName}': secrets.environments.${envName} references unknown secrets group '${ref}'`,
							);
							hasErrors = true;
						}
					}
				}
			}

			// Validate environment-scoped variable group refs
			if (group.variables?.environments) {
				for (const [envName, groupRefs] of Object.entries(group.variables.environments)) {
					for (const ref of groupRefs) {
						if (!parsedConfig.variables?.[ref]) {
							yield* Console.error(
								`Group '${groupName}': variables.environments.${envName} references unknown variables group '${ref}'`,
							);
							hasErrors = true;
						}
					}
				}
			}
		}

		// Check file references in file-kind secret groups
		for (const [groupName, group] of Object.entries(parsedConfig.secrets)) {
			if ("file" in group) {
				for (const [entryName, filePath] of Object.entries(group.file)) {
					const fullPath = join(configDir, filePath);
					if (!existsSync(fullPath)) {
						yield* Console.error(`secrets.${groupName}.file.${entryName}: file not found: ${fullPath}`);
						hasErrors = true;
					}
				}
			}
		}
		for (const [groupName, group] of Object.entries(parsedConfig.variables)) {
			if ("file" in group) {
				for (const [entryName, filePath] of Object.entries(group.file)) {
					const fullPath = join(configDir, filePath);
					if (!existsSync(fullPath)) {
						yield* Console.error(`variables.${groupName}.file.${entryName}: file not found: ${fullPath}`);
						hasErrors = true;
					}
				}
			}
		}

		const credentialsFile = yield* ReposetsCredentialsFile;
		const credsResult = yield* Effect.either(credentialsFile.load);

		if (credsResult._tag === "Left") {
			yield* Console.log("Credentials file: not found (optional)");
		} else {
			yield* Console.log("Credentials schema: valid");
			for (const [groupName, group] of Object.entries(parsedConfig.groups)) {
				if (group.credentials && !credsResult.right.profiles[group.credentials]) {
					yield* Console.error(`Group '${groupName}': references unknown credentials profile '${group.credentials}'`);
					hasErrors = true;
				}
			}
		}

		if (!hasErrors) {
			yield* Console.log("\nAll checks passed.");
		}
	}),
).pipe(Command.withDescription("Validate config without API calls"));
