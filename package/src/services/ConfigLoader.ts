import { Context, Effect, Layer, Schema } from "effect";
import { parse } from "smol-toml";
import { ConfigError, CredentialsError } from "../errors.js";
import type { Config } from "../schemas/config.js";
import { ConfigSchema } from "../schemas/config.js";
import type { Credentials } from "../schemas/credentials.js";
import { CredentialsSchema } from "../schemas/credentials.js";

export interface ConfigLoaderService {
	readonly parseConfig: (toml: string) => Effect.Effect<Config, ConfigError>;
	readonly parseCredentials: (toml: string) => Effect.Effect<Credentials, CredentialsError>;
}

export class ConfigLoader extends Context.Tag("ConfigLoader")<ConfigLoader, ConfigLoaderService>() {}

export const ConfigLoaderLive = Layer.succeed(ConfigLoader, {
	parseConfig(toml: string) {
		return Effect.try({
			try: () => {
				const parsed = parse(toml);
				return Schema.decodeUnknownSync(ConfigSchema)(parsed);
			},
			catch: (error) =>
				new ConfigError({
					message: error instanceof Error ? error.message : "Failed to parse config",
				}),
		});
	},

	parseCredentials(toml: string) {
		return Effect.try({
			try: () => {
				if (toml.trim() === "") {
					return Schema.decodeUnknownSync(CredentialsSchema)({});
				}
				const parsed = parse(toml);
				return Schema.decodeUnknownSync(CredentialsSchema)(parsed);
			},
			catch: (error) =>
				new CredentialsError({
					message: error instanceof Error ? error.message : "Failed to parse credentials",
				}),
		});
	},
});
