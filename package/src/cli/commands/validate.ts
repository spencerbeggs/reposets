import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { Command, Options } from "@effect/cli";
import { Effect } from "effect";
import { ReposetsConfigFile, ReposetsCredentialsFile, makeConfigFilesLive } from "../../services/ConfigFiles.js";

const configOption = Options.file("config").pipe(
	Options.withDescription("Path to config directory or reposets.config.toml file"),
	Options.optional,
);

export const validateCommand = Command.make("validate", { config: configOption }, ({ config }) =>
	Effect.gen(function* () {
		const configFile = yield* ReposetsConfigFile;
		let hasErrors = false;

		const configResult = yield* Effect.either(configFile.discover);

		if (configResult._tag === "Left") {
			yield* Effect.logError(`Config validation failed: ${configResult.left.message}`);
			return;
		}

		const sources = configResult.right;
		if (sources.length === 0) {
			yield* Effect.logError("No config file found.");
			return;
		}

		yield* Effect.log("Config schema: valid");
		const parsedConfig = sources[0].value;
		const configDir = dirname(sources[0].path);

		// Check file references in file-kind secret groups
		for (const [groupName, group] of Object.entries(parsedConfig.secrets)) {
			if ("file" in group) {
				for (const [entryName, filePath] of Object.entries(group.file)) {
					const fullPath = join(configDir, filePath);
					if (!existsSync(fullPath)) {
						yield* Effect.logError(`secrets.${groupName}.file.${entryName}: file not found: ${fullPath}`);
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
						yield* Effect.logError(`variables.${groupName}.file.${entryName}: file not found: ${fullPath}`);
						hasErrors = true;
					}
				}
			}
		}

		const credentialsFile = yield* ReposetsCredentialsFile;
		const credsResult = yield* Effect.either(credentialsFile.load);

		if (credsResult._tag === "Left") {
			yield* Effect.log("Credentials file: not found (optional)");
		} else {
			yield* Effect.log("Credentials schema: valid");
			for (const [groupName, group] of Object.entries(parsedConfig.groups)) {
				if (group.credentials && !credsResult.right.profiles[group.credentials]) {
					yield* Effect.logError(`Group '${groupName}': references unknown credentials profile '${group.credentials}'`);
					hasErrors = true;
				}
			}
		}

		if (!hasErrors) {
			yield* Effect.log("\nAll checks passed.");
		}
	}).pipe(Effect.provide(makeConfigFilesLive(config))),
).pipe(Command.withDescription("Validate config without API calls"));
