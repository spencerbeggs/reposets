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
export { resolveConfigDir } from "./lib/config-path.js";
// Utilities
export { encryptSecret } from "./lib/crypto.js";
export { configDir, configPath, credentialsPath } from "./lib/xdg.js";
// Schemas
export type { Cleanup, CleanupPreserve, ValueSource } from "./schemas/common.js";
export { CleanupPreserveSchema, CleanupSchema, ValueSourceSchema } from "./schemas/common.js";
export type { Config, RepoGroup } from "./schemas/config.js";
export { ConfigSchema, RepoGroupSchema } from "./schemas/config.js";
export type { CredentialProfile, Credentials } from "./schemas/credentials.js";
export { CredentialProfileSchema, CredentialsSchema } from "./schemas/credentials.js";
// Services
export { ConfigLoader, ConfigLoaderLive } from "./services/ConfigLoader.js";
export { GitHubClient, GitHubClientLive, GitHubClientTest } from "./services/GitHubClient.js";
export { OnePasswordClient, OnePasswordClientLive, OnePasswordClientTest } from "./services/OnePasswordClient.js";
export { SyncEngine, SyncEngineLive } from "./services/SyncEngine.js";
export { ValueResolver, ValueResolverLive } from "./services/ValueResolver.js";
