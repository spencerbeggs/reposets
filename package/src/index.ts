/**
 * gh-sync
 *
 * CLI tool to sync GitHub repo settings, secrets, and rulesets
 * across personal repositories.
 *
 * @packageDocumentation
 */

// Errors
export { ConfigError, CredentialsError, GitHubApiError, OnePasswordError, ResolveError, SyncError } from "./errors.js";
export type { ResolveOptions } from "./lib/config-path.js";
export { resolveConfigDir } from "./lib/config-path.js";
// Utilities
export { encryptSecret } from "./lib/crypto.js";
export { configDir, configPath, credentialsPath } from "./lib/xdg.js";
// Schemas
export type { Cleanup, CleanupPreserve, SecretGroup, VariableGroup } from "./schemas/common.js";
export { CleanupPreserveSchema, CleanupSchema, SecretGroupSchema, VariableGroupSchema } from "./schemas/common.js";
export type { Config, Group, LogLevel } from "./schemas/config.js";
export { ConfigSchema, GroupSchema, LogLevelSchema } from "./schemas/config.js";
export type { CredentialProfile, Credentials, ResolveSection } from "./schemas/credentials.js";
export { CredentialProfileSchema, CredentialsSchema, ResolveSectionSchema } from "./schemas/credentials.js";
export type { BypassActor, ResolvedRef, Rule, Ruleset } from "./schemas/ruleset.js";
export { BypassActorSchema, ResolvedRefSchema, RuleSchema, RulesetSchema } from "./schemas/ruleset.js";
// Services
export { ConfigLoader, ConfigLoaderLive } from "./services/ConfigLoader.js";
export { CredentialResolver, CredentialResolverLive } from "./services/CredentialResolver.js";
export type { RecordedCall } from "./services/GitHubClient.js";
export { GitHubClient, GitHubClientLive, GitHubClientTest } from "./services/GitHubClient.js";
export { OnePasswordClient, OnePasswordClientLive, OnePasswordClientTest } from "./services/OnePasswordClient.js";
export { SyncEngine, SyncEngineLive } from "./services/SyncEngine.js";
export type { SyncLoggerConfig } from "./services/SyncLogger.js";
export { SyncLogger, SyncLoggerLive } from "./services/SyncLogger.js";
