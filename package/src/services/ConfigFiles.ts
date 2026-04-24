import { existsSync, statSync } from "node:fs";
import { Effect, Option } from "effect";
import {
	AppDirsConfig,
	ConfigError,
	ConfigFile,
	ExplicitPath,
	FirstMatch,
	StaticDir,
	TomlCodec,
	UpwardWalk,
	XdgConfigLive,
	XdgConfigResolver,
	XdgSavePath,
} from "xdg-effect";
import type { Config } from "../schemas/config.js";
import { ConfigSchema } from "../schemas/config.js";
import type { Credentials } from "../schemas/credentials.js";
import { CredentialsSchema } from "../schemas/credentials.js";

export const CONFIG_FILENAME = "reposets.config.toml";
export const CREDENTIALS_FILENAME = "reposets.credentials.toml";

export const ReposetsConfigFile = ConfigFile.Tag<Config>("reposets/Config");

export const ReposetsCredentialsFile = ConfigFile.Tag<Credentials>("reposets/Credentials");

/**
 * Validates all internal cross-references in a parsed config. Checks that
 * every group's settings, secrets, variables, rulesets, and environments
 * references point to defined top-level sections, and that environment-scoped
 * secret/variable groups reference defined environments. Collects ALL errors
 * into a single ConfigError.
 */
export function validateConfigRefs(config: Config): Effect.Effect<Config, ConfigError> {
	const errors: Array<string> = [];

	const definedSettings = new Set(Object.keys(config.settings));
	const definedSecrets = new Set(Object.keys(config.secrets));
	const definedVariables = new Set(Object.keys(config.variables));
	const definedRulesets = new Set(Object.keys(config.rulesets));
	const definedEnvironments = new Set(Object.keys(config.environments));

	for (const [groupName, group] of Object.entries(config.groups)) {
		// Check settings references
		if (group.settings) {
			for (const ref of group.settings) {
				if (!definedSettings.has(ref)) {
					errors.push(`group '${groupName}': unknown settings group '${ref}'`);
				}
			}
		}

		// Check rulesets references
		if (group.rulesets) {
			for (const ref of group.rulesets) {
				if (!definedRulesets.has(ref)) {
					errors.push(`group '${groupName}': unknown ruleset '${ref}'`);
				}
			}
		}

		// Check environments references
		if (group.environments) {
			for (const ref of group.environments) {
				if (!definedEnvironments.has(ref)) {
					errors.push(`group '${groupName}': unknown environment '${ref}'`);
				}
			}
		}

		// Check secrets references
		if (group.secrets) {
			if (group.secrets.actions) {
				for (const ref of group.secrets.actions) {
					if (!definedSecrets.has(ref)) {
						errors.push(`group '${groupName}': unknown secrets group '${ref}'`);
					}
				}
			}
			if (group.secrets.dependabot) {
				for (const ref of group.secrets.dependabot) {
					if (!definedSecrets.has(ref)) {
						errors.push(`group '${groupName}': unknown secrets group '${ref}'`);
					}
				}
			}
			if (group.secrets.codespaces) {
				for (const ref of group.secrets.codespaces) {
					if (!definedSecrets.has(ref)) {
						errors.push(`group '${groupName}': unknown secrets group '${ref}'`);
					}
				}
			}
			if (group.secrets.environments) {
				for (const [envName, secretGroups] of Object.entries(group.secrets.environments)) {
					if (!definedEnvironments.has(envName)) {
						errors.push(`group '${groupName}': unknown environment '${envName}' in secrets.environments`);
					}
					for (const ref of secretGroups) {
						if (!definedSecrets.has(ref)) {
							errors.push(`group '${groupName}': in secrets.environments.'${envName}': unknown secrets group '${ref}'`);
						}
					}
				}
			}
		}

		// Check variables references
		if (group.variables) {
			if (group.variables.actions) {
				for (const ref of group.variables.actions) {
					if (!definedVariables.has(ref)) {
						errors.push(`group '${groupName}': unknown variables group '${ref}'`);
					}
				}
			}
			if (group.variables.environments) {
				for (const [envName, varGroups] of Object.entries(group.variables.environments)) {
					if (!definedEnvironments.has(envName)) {
						errors.push(`group '${groupName}': unknown environment '${envName}' in variables.environments`);
					}
					for (const ref of varGroups) {
						if (!definedVariables.has(ref)) {
							errors.push(
								`group '${groupName}': in variables.environments.'${envName}': unknown variables group '${ref}'`,
							);
						}
					}
				}
			}
		}
	}

	if (errors.length > 0) {
		return Effect.fail(
			new ConfigError({
				operation: "validate",
				reason: errors.join("\n"),
			}),
		);
	}

	return Effect.succeed(config);
}

/**
 * Creates a live Layer providing both config and credentials file services.
 * When configFlag is Some and points to a directory, prepends StaticDir resolver.
 * When configFlag is Some and points to a file, prepends ExplicitPath resolver.
 * Always includes UpwardWalk + XdgConfigResolver as fallback resolvers.
 * Passes validateConfigRefs as the validate callback on the config spec.
 */
export function makeConfigFilesLive(configFlag: Option.Option<string>) {
	const configResolvers = [];

	if (Option.isSome(configFlag)) {
		const flag = configFlag.value;
		if (existsSync(flag) && statSync(flag).isDirectory()) {
			configResolvers.push(StaticDir({ dir: flag, filename: CONFIG_FILENAME }));
		} else {
			configResolvers.push(ExplicitPath(flag));
		}
	}

	configResolvers.push(UpwardWalk({ filename: CONFIG_FILENAME }), XdgConfigResolver({ filename: CONFIG_FILENAME }));

	return XdgConfigLive.multi({
		app: new AppDirsConfig({ namespace: "reposets" }),
		configs: [
			{
				tag: ReposetsConfigFile,
				schema: ConfigSchema,
				codec: TomlCodec,
				strategy: FirstMatch,
				resolvers: configResolvers,
				validate: validateConfigRefs,
			},
			{
				tag: ReposetsCredentialsFile,
				schema: CredentialsSchema,
				codec: TomlCodec,
				strategy: FirstMatch,
				resolvers: [
					UpwardWalk({ filename: CREDENTIALS_FILENAME }),
					XdgConfigResolver({ filename: CREDENTIALS_FILENAME }),
				],
				defaultPath: XdgSavePath(CREDENTIALS_FILENAME),
			},
		],
	});
}

/**
 * Default ConfigFiles layer with no --config flag override.
 * Used by CLI entrypoint when no flag is provided.
 */
export const ConfigFilesLive = makeConfigFilesLive(Option.none());
