/**
 * reposets — sync GitHub repository settings, secrets, variables, rulesets and
 * deployment environments across repos from a TOML config.
 *
 * @remarks
 * This entry point is the library surface. The CLI lives at
 * `reposets/cli`, and its entry module is `src/cli/index.ts`.
 *
 * The library surface is deliberately small: the config schema and the config
 * file services, which are what an embedding program needs to read or validate
 * a `reposets.config.toml` without shelling out to the CLI. Everything else —
 * the sync engine, the phases, the stores — is reachable only through the CLI,
 * because none of it is useful without the command that sequences it.
 *
 * @packageDocumentation
 */

export type { Config } from "./schemas/config.js";
export { ConfigSchema } from "./schemas/config.js";
export {
	CONFIG_FILENAME,
	ConfigFlagNotFound,
	ReposetsConfigFile,
	makeConfigFilesLive,
} from "./services/ConfigFiles.js";
