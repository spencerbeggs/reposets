/**
 * reposets
 *
 * CLI tool to sync GitHub repo settings, secrets, and rulesets
 * across personal repositories.
 *
 * @packageDocumentation
 */

/* v8 ignore start -- barrel re-exports */
// Services
export { AppDirs, ConfigError as XdgConfigError, ConfigFile } from "xdg-effect";
// Errors
export { GitHubApiError, OnePasswordError, ResolveError, SyncError } from "./errors.js";
// Utilities
export { encryptSecret } from "./lib/crypto.js";
// Schemas
export type { Cleanup, CleanupScope, SecretGroup, VariableGroup } from "./schemas/common.js";
export { CleanupSchema, CleanupScopeSchema, SecretGroupSchema, VariableGroupSchema } from "./schemas/common.js";
export type { Config, Group, LogLevel } from "./schemas/config.js";
export { ConfigSchema, GroupSchema, LogLevelSchema } from "./schemas/config.js";
export type { CredentialProfile, Credentials, ResolveSection } from "./schemas/credentials.js";
export { CredentialProfileSchema, CredentialsSchema, ResolveSectionSchema } from "./schemas/credentials.js";
export type { BypassActor, ResolvedRef, Ruleset, RulesetPayload } from "./schemas/ruleset.js";
export { BypassActorSchema, ResolvedRefSchema, RulesetSchema, buildRulesetPayload } from "./schemas/ruleset.js";
export {
	ConfigFilesLive,
	ReposetsConfigFile,
	ReposetsCredentialsFile,
	loadConfigWithDir,
	resolveConfigFlag,
} from "./services/ConfigFiles.js";
export { CredentialResolver, CredentialResolverLive } from "./services/CredentialResolver.js";
export type { RecordedCall } from "./services/GitHubClient.js";
export { GitHubClient, GitHubClientLive, GitHubClientTest } from "./services/GitHubClient.js";
export { OnePasswordClient, OnePasswordClientLive, OnePasswordClientTest } from "./services/OnePasswordClient.js";
export { SyncEngine, SyncEngineLive } from "./services/SyncEngine.js";
export type { SyncLoggerConfig } from "./services/SyncLogger.js";
export { SyncLogger, SyncLoggerLive } from "./services/SyncLogger.js";
/* v8 ignore stop */
