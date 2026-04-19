import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Command, Options } from "@effect/cli";
import { Console, Effect } from "effect";
import { resolveConfigDir } from "../../lib/config-path.js";
import { ConfigLoader } from "../../services/ConfigLoader.js";

const configOption = Options.file("config").pipe(
	Options.withDescription("Path to config directory or gh-sync.config.toml file"),
	Options.optional,
);

export const validateCommand = Command.make("validate", { config: configOption }, ({ config }) =>
	Effect.gen(function* () {
		const configFlag = config._tag === "Some" ? config.value : undefined;
		const configDir = resolveConfigDir({ configFlag });
		let hasErrors = false;

		if (!configDir) {
			yield* Console.error("No config found. Run 'gh-sync init' to create one.");
			return;
		}

		const configPath = join(configDir, "gh-sync.config.toml");
		if (!existsSync(configPath)) {
			yield* Console.error(`Config file not found: ${configPath}`);
			return;
		}

		const loader = yield* ConfigLoader;
		const configToml = readFileSync(configPath, "utf-8");
		const configResult = yield* Effect.either(loader.parseConfig(configToml));

		if (configResult._tag === "Left") {
			yield* Console.error(`Config validation failed: ${configResult.left.message}`);
			hasErrors = true;
		} else {
			yield* Console.log("Config schema: valid");
			const parsedConfig = configResult.right;

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
		}

		const credsPath = join(configDir, "gh-sync.credentials.toml");
		if (existsSync(credsPath)) {
			const credsToml = readFileSync(credsPath, "utf-8");
			const credsResult = yield* Effect.either(loader.parseCredentials(credsToml));
			if (credsResult._tag === "Left") {
				yield* Console.error(`Credentials validation failed: ${credsResult.left.message}`);
				hasErrors = true;
			} else {
				yield* Console.log("Credentials schema: valid");
				if (configResult._tag === "Right") {
					for (const [groupName, group] of Object.entries(configResult.right.groups)) {
						if (group.credentials && !credsResult.right.profiles[group.credentials]) {
							yield* Console.error(
								`Group '${groupName}': references unknown credentials profile '${group.credentials}'`,
							);
							hasErrors = true;
						}
					}
				}
			}
		} else {
			yield* Console.log("Credentials file: not found (optional)");
		}

		if (!hasErrors) {
			yield* Console.log("\nAll checks passed.");
		}
	}),
).pipe(Command.withDescription("Validate config without API calls"));
