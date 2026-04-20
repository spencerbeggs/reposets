import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { Context, Effect, Layer } from "effect";
import { ResolveError, SyncError } from "../errors.js";
import type { CleanupScope, SecretGroup } from "../schemas/common.js";
import type { Config } from "../schemas/config.js";
import type { Credentials } from "../schemas/credentials.js";
import type { Ruleset, RulesetPayload } from "../schemas/ruleset.js";
import { buildRulesetPayload } from "../schemas/ruleset.js";
import { CredentialResolver } from "./CredentialResolver.js";
import type { OwnerType, SecretScope } from "./GitHubClient.js";
import { GitHubClient, ORG_ONLY_SETTINGS } from "./GitHubClient.js";
import { SyncLogger } from "./SyncLogger.js";

interface SyncOptions {
	readonly dryRun: boolean;
	readonly noCleanup: boolean;
	readonly groupFilter?: string | undefined;
	readonly repoFilter?: string | undefined;
	readonly configDir: string;
}

export interface SyncEngineService {
	readonly syncAll: (config: Config, credentials: Credentials, options: SyncOptions) => Effect.Effect<void, SyncError>;
}

export class SyncEngine extends Context.Tag("SyncEngine")<SyncEngine, SyncEngineService>() {}

function isCleanupActive(scope: CleanupScope): boolean {
	return scope !== false;
}

function getPreserveList(scope: CleanupScope): Set<string> {
	if (typeof scope === "object" && "preserve" in scope) {
		return new Set(scope.preserve);
	}
	return new Set();
}

function resolveResourceGroup(
	group: SecretGroup,
	credentialMap: Map<string, string>,
	basePath: string,
): Effect.Effect<Map<string, string>, ResolveError> {
	return Effect.gen(function* () {
		const result = new Map<string, string>();
		if ("file" in group) {
			for (const [name, filePath] of Object.entries(group.file)) {
				const fullPath = isAbsolute(filePath) ? filePath : resolve(basePath, filePath);
				const content = yield* Effect.try({
					try: () => readFileSync(fullPath, "utf-8").trim(),
					catch: (error) =>
						new ResolveError({
							message: `Failed to read file for '${name}': ${error instanceof Error ? error.message : String(error)}`,
						}),
				});
				result.set(name, content);
			}
		} else if ("value" in group) {
			for (const [name, val] of Object.entries(group.value)) {
				result.set(name, typeof val === "string" ? val : JSON.stringify(val));
			}
		} else if ("resolved" in group) {
			for (const [name, label] of Object.entries(group.resolved)) {
				const value = credentialMap.get(label);
				if (value === undefined) {
					yield* Effect.fail(new ResolveError({ message: `Credential label '${label}' not found for '${name}'` }));
				} else {
					result.set(name, value);
				}
			}
		}
		return result;
	});
}

function resolveRulesetRefs(ruleset: Ruleset, credentialMap: Map<string, string>): Ruleset {
	const json = JSON.parse(JSON.stringify(ruleset)) as Record<string, unknown>;
	substituteResolved(json, credentialMap);
	return json as unknown as Ruleset;
}

function substituteResolved(obj: Record<string, unknown>, credentialMap: Map<string, string>): void {
	for (const [key, value] of Object.entries(obj)) {
		if (value && typeof value === "object" && !Array.isArray(value)) {
			const rec = value as Record<string, unknown>;
			if ("resolved" in rec && typeof rec.resolved === "string") {
				const resolved = credentialMap.get(rec.resolved);
				if (resolved === undefined) {
					throw new Error(`Credential label '${rec.resolved}' not found for ruleset field '${key}'`);
				}
				const num = Number(resolved);
				obj[key] = Number.isNaN(num) ? resolved : num;
			} else {
				substituteResolved(rec, credentialMap);
			}
		} else if (Array.isArray(value)) {
			for (const item of value) {
				if (item && typeof item === "object") {
					substituteResolved(item as Record<string, unknown>, credentialMap);
				}
			}
		}
	}
}

function groupEntryNames(group: SecretGroup): string[] {
	if ("file" in group) return Object.keys(group.file);
	if ("value" in group) return Object.keys(group.value);
	if ("resolved" in group) return Object.keys(group.resolved);
	return [];
}

export const SyncEngineLive = Layer.effect(
	SyncEngine,
	Effect.gen(function* () {
		const github = yield* GitHubClient;
		const credResolver = yield* CredentialResolver;
		const logger = yield* SyncLogger;

		return {
			syncAll(config: Config, credentials: Credentials, options: SyncOptions) {
				return Effect.gen(function* () {
					const { dryRun, noCleanup, groupFilter, repoFilter } = options;

					const profileEntries = Object.entries(credentials.profiles);
					const defaultProfileName = profileEntries.length === 1 ? (profileEntries[0]?.[0] ?? "default") : "default";
					const defaultProfile = credentials.profiles[defaultProfileName];

					const groups = Object.entries(config.groups);

					for (const [groupName, group] of groups) {
						if (groupFilter && groupName !== groupFilter) continue;

						const owner = group.owner ?? config.owner ?? "";
						const profileName = group.credentials ?? defaultProfileName;
						const profile = credentials.profiles[profileName] ?? defaultProfile;

						yield* logger.groupStart(groupName, group.repos.length);

						// Resolve credentials upfront
						const credentialMap = profile
							? yield* credResolver.resolveAll(profile, options.configDir)
							: new Map<string, string>();

						// Detect owner type (cached per owner in GitHubClient)
						const ownerType: OwnerType = yield* github
							.getOwnerType(owner)
							.pipe(Effect.catchTag("GitHubApiError", () => Effect.succeed("User" as OwnerType)));

						// Resolve all secret values per scope
						const secretScopes: SecretScope[] = ["actions", "dependabot", "codespaces"];
						const resolvedSecrets: Map<string, Map<string, string>> = new Map();

						for (const scope of secretScopes) {
							const groupRefs = group.secrets?.[scope] ?? [];
							for (const groupRef of groupRefs) {
								const secretGroup = config.secrets[groupRef];
								if (!secretGroup) continue;

								const entries = yield* resolveResourceGroup(secretGroup, credentialMap, options.configDir);
								const scopeMap = resolvedSecrets.get(scope) ?? new Map<string, string>();
								for (const [name, value] of entries) {
									scopeMap.set(name, value);
								}
								resolvedSecrets.set(scope, scopeMap);
							}
						}

						// Resolve all variable values
						const resolvedVariables: Map<string, string> = new Map();
						const variableGroupRefs = group.variables?.actions ?? [];
						for (const groupRef of variableGroupRefs) {
							const variableGroup = config.variables[groupRef];
							if (!variableGroup) continue;

							const entries = yield* resolveResourceGroup(variableGroup, credentialMap, options.configDir);
							for (const [name, value] of entries) {
								resolvedVariables.set(name, value);
							}
						}

						// Collect rulesets from config and resolve { resolved } references
						const groupRulesetRefs = group.rulesets ?? [];
						const rulesetMap: Map<string, RulesetPayload> = new Map();
						for (const ref of groupRulesetRefs) {
							const ruleset = config.rulesets[ref];
							if (ruleset) {
								const resolved = resolveRulesetRefs(ruleset, credentialMap);
								const payload = buildRulesetPayload(resolved);
								rulesetMap.set(ref, payload);
							}
						}

						// Environment references
						const envRefs = group.environments ?? [];

						// Environment secret and variable mappings
						const envSecretMapping = group.secrets?.environments ?? {};
						const envVariableMapping = group.variables?.environments ?? {};

						// Resolve environment secrets upfront
						const resolvedEnvSecrets: Map<string, Map<string, string>> = new Map();
						for (const [envName, groupRefs] of Object.entries(envSecretMapping)) {
							const envMap = new Map<string, string>();
							for (const groupRef of groupRefs) {
								const secretGroup = config.secrets[groupRef];
								if (!secretGroup) continue;
								const entries = yield* resolveResourceGroup(secretGroup, credentialMap, options.configDir);
								for (const [name, value] of entries) {
									envMap.set(name, value);
								}
							}
							resolvedEnvSecrets.set(envName, envMap);
						}

						// Resolve environment variables upfront
						const resolvedEnvVariables: Map<string, Map<string, string>> = new Map();
						for (const [envName, groupRefs] of Object.entries(envVariableMapping)) {
							const envMap = new Map<string, string>();
							for (const groupRef of groupRefs) {
								const variableGroup = config.variables[groupRef];
								if (!variableGroup) continue;
								const entries = yield* resolveResourceGroup(variableGroup, credentialMap, options.configDir);
								for (const [name, value] of entries) {
									envMap.set(name, value);
								}
							}
							resolvedEnvVariables.set(envName, envMap);
						}

						// Cleanup config from group (no global merge)
						const effectiveCleanup = group.cleanup ?? {
							secrets: {
								actions: false as CleanupScope,
								dependabot: false as CleanupScope,
								codespaces: false as CleanupScope,
								environments: false as CleanupScope,
							},
							variables: { actions: false as CleanupScope, environments: false as CleanupScope },
							rulesets: false as CleanupScope,
							environments: false as CleanupScope,
						};

						// Configured names for cleanup
						const configuredSecretNames = (scope: SecretScope): Set<string> => {
							const refs = group.secrets?.[scope] ?? [];
							const names = new Set<string>();
							for (const ref of refs) {
								const grp = config.secrets[ref];
								if (grp) {
									for (const name of groupEntryNames(grp)) names.add(name);
								}
							}
							return names;
						};

						const configuredVariableNames = (): Set<string> => {
							const refs = group.variables?.actions ?? [];
							const names = new Set<string>();
							for (const ref of refs) {
								const grp = config.variables[ref];
								if (grp) {
									for (const name of groupEntryNames(grp)) names.add(name);
								}
							}
							return names;
						};

						const configuredRulesetNames = (): Set<string> => {
							const refs = group.rulesets ?? [];
							const names = new Set<string>();
							for (const ref of refs) {
								const ruleset = config.rulesets[ref];
								if (ruleset) names.add(ruleset.name);
							}
							return names;
						};

						// Merge settings (group-scoped, not per-repo)
						const settingGroupRefs = group.settings ?? [];
						const mergedSettings: Record<string, unknown> = {};
						const skippedSettings: string[] = [];
						for (const ref of settingGroupRefs) {
							const settingGroup = config.settings[ref];
							if (settingGroup) Object.assign(mergedSettings, settingGroup);
						}
						// Strip org-only settings for personal accounts
						if (ownerType === "User") {
							for (const key of ORG_ONLY_SETTINGS) {
								if (key in mergedSettings) {
									delete mergedSettings[key];
									skippedSettings.push(key);
								}
							}
						}
						const hasSecrets = secretScopes.some((s) => (resolvedSecrets.get(s)?.size ?? 0) > 0);
						const hasVariables = resolvedVariables.size > 0;
						const hasRulesets = rulesetMap.size > 0;
						const hasSettings = Object.keys(mergedSettings).length > 0;
						const hasEnvironments = envRefs.length > 0;
						const hasEnvSecrets = resolvedEnvSecrets.size > 0;
						const hasEnvVariables = resolvedEnvVariables.size > 0;
						const hasCleanup =
							!noCleanup &&
							(isCleanupActive(effectiveCleanup.secrets.actions) ||
								isCleanupActive(effectiveCleanup.secrets.dependabot) ||
								isCleanupActive(effectiveCleanup.secrets.codespaces) ||
								isCleanupActive(effectiveCleanup.secrets.environments) ||
								isCleanupActive(effectiveCleanup.variables.actions) ||
								isCleanupActive(effectiveCleanup.variables.environments) ||
								isCleanupActive(effectiveCleanup.rulesets) ||
								isCleanupActive(effectiveCleanup.environments));

						for (const repoName of group.repos) {
							if (repoFilter && repoName !== repoFilter) continue;

							if (
								!hasSecrets &&
								!hasVariables &&
								!hasRulesets &&
								!hasSettings &&
								!hasEnvironments &&
								!hasEnvSecrets &&
								!hasEnvVariables &&
								!hasCleanup
							) {
								yield* logger.repoSkip(owner, repoName, "no changes configured");
								continue;
							}

							yield* logger.repoStart(owner, repoName);

							// --- Sync Phase ---
							if (!dryRun) {
								// Sync settings
								if (hasSettings) {
									yield* logger.syncOperation("apply", "settings", "");
									yield* github
										.syncSettings(owner, repoName, mergedSettings)
										.pipe(Effect.catchTag("GitHubApiError", (err) => logger.syncError("settings", err.message)));
								}
								// Warn about skipped org-only settings
								for (const key of skippedSettings) {
									yield* logger.syncOperation("skip", "setting", key, "(org-only, owner is a personal account)");
								}

								// Sync environments (before secrets/variables)
								for (const envName of envRefs) {
									const envConfig = config.environments[envName];
									if (!envConfig) continue;
									yield* logger.syncOperation("sync", "environment", envName);
									yield* github
										.syncEnvironment(owner, repoName, envName, envConfig as unknown as Record<string, unknown>)
										.pipe(
											Effect.catchTag("GitHubApiError", (err) =>
												logger.syncError(`environment ${envName}`, err.message),
											),
										);
								}

								// Sync secrets by scope
								for (const scope of secretScopes) {
									const scopeMap = resolvedSecrets.get(scope);
									if (scopeMap) {
										for (const [name, value] of scopeMap) {
											yield* logger.syncOperation("sync", "secret", name, `(${scope})`);
											yield* github
												.syncSecret(owner, repoName, name, value, scope)
												.pipe(
													Effect.catchTag("GitHubApiError", (err) =>
														logger.syncError(`secret ${name} (${scope})`, err.message),
													),
												);
										}
									}
								}

								// Sync environment secrets
								for (const [envName, envMap] of resolvedEnvSecrets) {
									for (const [name, value] of envMap) {
										yield* logger.syncOperation("sync", "secret", name, `(env: ${envName})`);
										yield* github
											.syncEnvironmentSecret(owner, repoName, envName, name, value)
											.pipe(
												Effect.catchTag("GitHubApiError", (err) =>
													logger.syncError(`secret ${name} (env: ${envName})`, err.message),
												),
											);
									}
								}

								// Sync variables
								for (const [name, value] of resolvedVariables) {
									yield* logger.syncOperation("sync", "variable", name);
									yield* github
										.syncVariable(owner, repoName, name, value)
										.pipe(
											Effect.catchTag("GitHubApiError", (err) => logger.syncError(`variable ${name}`, err.message)),
										);
								}

								// Sync environment variables
								for (const [envName, envMap] of resolvedEnvVariables) {
									for (const [name, value] of envMap) {
										yield* logger.syncOperation("sync", "variable", name, `(env: ${envName})`);
										yield* github
											.syncEnvironmentVariable(owner, repoName, envName, name, value)
											.pipe(
												Effect.catchTag("GitHubApiError", (err) =>
													logger.syncError(`variable ${name} (env: ${envName})`, err.message),
												),
											);
									}
								}

								// Sync rulesets
								for (const [_key, ruleset] of rulesetMap) {
									yield* logger.syncOperation("sync", "ruleset", ruleset.name);
									yield* github
										.syncRuleset(owner, repoName, ruleset.name, ruleset)
										.pipe(
											Effect.catchTag("GitHubApiError", (err) =>
												logger.syncError(`ruleset ${ruleset.name}`, err.message),
											),
										);
								}
							}

							// Info-tier summaries
							if (hasEnvironments) {
								yield* logger.syncSummary("environment", envRefs.length, "");
							}
							if (hasSecrets) {
								const scopeCounts: string[] = [];
								let totalSecrets = 0;
								for (const scope of secretScopes) {
									const count = resolvedSecrets.get(scope)?.size ?? 0;
									if (count > 0) {
										scopeCounts.push(`${scope}: ${count}`);
										totalSecrets += count;
									}
								}
								yield* logger.syncSummary("secret", totalSecrets, scopeCounts.join(", "));
							}
							if (hasVariables) {
								yield* logger.syncSummary("variable", resolvedVariables.size, "");
							}
							if (hasSettings) {
								yield* logger.settingsApplied();
							}
							if (rulesetMap.size > 0) {
								yield* logger.syncSummary("ruleset", rulesetMap.size, "");
							}

							// --- Cleanup Phase ---
							if (!noCleanup) {
								// Cleanup actions secrets
								if (isCleanupActive(effectiveCleanup.secrets.actions)) {
									const configured = configuredSecretNames("actions");
									const preserved = getPreserveList(effectiveCleanup.secrets.actions);
									const existing = yield* github.listSecrets(owner, repoName, "actions").pipe(
										Effect.catchTag("GitHubApiError", (err) =>
											Effect.gen(function* () {
												yield* logger.syncError("list secrets (actions)", err.message);
												return [] as { name: string }[];
											}),
										),
									);
									const toDelete: string[] = [];
									for (const { name } of existing) {
										if (!configured.has(name) && !preserved.has(name)) {
											toDelete.push(name);
											yield* logger.syncOperation("delete", "secret", name, "(actions)");
											if (!dryRun) {
												yield* github
													.deleteSecret(owner, repoName, name, "actions")
													.pipe(
														Effect.catchTag("GitHubApiError", (err) =>
															logger.syncError(`delete secret ${name} (actions)`, err.message),
														),
													);
											}
										}
									}
									if (toDelete.length > 0) {
										yield* logger.cleanupSummary("secret", toDelete.length, toDelete);
									}
								}

								// Cleanup dependabot secrets
								if (isCleanupActive(effectiveCleanup.secrets.dependabot)) {
									const configured = configuredSecretNames("dependabot");
									const preserved = getPreserveList(effectiveCleanup.secrets.dependabot);
									const existing = yield* github.listSecrets(owner, repoName, "dependabot").pipe(
										Effect.catchTag("GitHubApiError", (err) =>
											Effect.gen(function* () {
												yield* logger.syncError("list secrets (dependabot)", err.message);
												return [] as { name: string }[];
											}),
										),
									);
									const toDelete: string[] = [];
									for (const { name } of existing) {
										if (!configured.has(name) && !preserved.has(name)) {
											toDelete.push(name);
											yield* logger.syncOperation("delete", "secret", name, "(dependabot)");
											if (!dryRun) {
												yield* github
													.deleteSecret(owner, repoName, name, "dependabot")
													.pipe(
														Effect.catchTag("GitHubApiError", (err) =>
															logger.syncError(`delete secret ${name} (dependabot)`, err.message),
														),
													);
											}
										}
									}
									if (toDelete.length > 0) {
										yield* logger.cleanupSummary("secret", toDelete.length, toDelete);
									}
								}

								// Cleanup codespaces secrets
								if (isCleanupActive(effectiveCleanup.secrets.codespaces)) {
									const configured = configuredSecretNames("codespaces");
									const preserved = getPreserveList(effectiveCleanup.secrets.codespaces);
									const existing = yield* github.listSecrets(owner, repoName, "codespaces").pipe(
										Effect.catchTag("GitHubApiError", (err) =>
											Effect.gen(function* () {
												yield* logger.syncError("list secrets (codespaces)", err.message);
												return [] as { name: string }[];
											}),
										),
									);
									const toDelete: string[] = [];
									for (const { name } of existing) {
										if (!configured.has(name) && !preserved.has(name)) {
											toDelete.push(name);
											yield* logger.syncOperation("delete", "secret", name, "(codespaces)");
											if (!dryRun) {
												yield* github
													.deleteSecret(owner, repoName, name, "codespaces")
													.pipe(
														Effect.catchTag("GitHubApiError", (err) =>
															logger.syncError(`delete secret ${name} (codespaces)`, err.message),
														),
													);
											}
										}
									}
									if (toDelete.length > 0) {
										yield* logger.cleanupSummary("secret", toDelete.length, toDelete);
									}
								}

								// Cleanup environment secrets (union of group.environments and secrets.environments keys)
								if (isCleanupActive(effectiveCleanup.secrets.environments)) {
									const preserved = getPreserveList(effectiveCleanup.secrets.environments);
									const allEnvNames = new Set([...envRefs, ...Object.keys(envSecretMapping)]);
									for (const envName of allEnvNames) {
										const configuredNames = new Set<string>();
										for (const ref of envSecretMapping[envName] ?? []) {
											const grp = config.secrets[ref];
											if (grp) {
												for (const name of groupEntryNames(grp)) configuredNames.add(name);
											}
										}
										const existing = yield* github.listEnvironmentSecrets(owner, repoName, envName).pipe(
											Effect.catchTag("GitHubApiError", (err) =>
												Effect.gen(function* () {
													yield* logger.syncError(`list secrets (env: ${envName})`, err.message);
													return [] as { name: string }[];
												}),
											),
										);
										const toDelete: string[] = [];
										for (const { name } of existing) {
											if (!configuredNames.has(name) && !preserved.has(name)) {
												toDelete.push(name);
												yield* logger.syncOperation("delete", "secret", name, `(env: ${envName})`);
												if (!dryRun) {
													yield* github
														.deleteEnvironmentSecret(owner, repoName, envName, name)
														.pipe(
															Effect.catchTag("GitHubApiError", (err) =>
																logger.syncError(`delete secret ${name} (env: ${envName})`, err.message),
															),
														);
												}
											}
										}
										if (toDelete.length > 0) {
											yield* logger.cleanupSummary("secret", toDelete.length, toDelete);
										}
									}
								}

								// Cleanup variables
								if (isCleanupActive(effectiveCleanup.variables.actions)) {
									const configured = configuredVariableNames();
									const preserved = getPreserveList(effectiveCleanup.variables.actions);
									const existing = yield* github.listVariables(owner, repoName).pipe(
										Effect.catchTag("GitHubApiError", (err) =>
											Effect.gen(function* () {
												yield* logger.syncError("list variables", err.message);
												return [] as { name: string }[];
											}),
										),
									);
									const toDelete: string[] = [];
									for (const { name } of existing) {
										if (!configured.has(name) && !preserved.has(name)) {
											toDelete.push(name);
											yield* logger.syncOperation("delete", "variable", name);
											if (!dryRun) {
												yield* github
													.deleteVariable(owner, repoName, name)
													.pipe(
														Effect.catchTag("GitHubApiError", (err) =>
															logger.syncError(`delete variable ${name}`, err.message),
														),
													);
											}
										}
									}
									if (toDelete.length > 0) {
										yield* logger.cleanupSummary("variable", toDelete.length, toDelete);
									}
								}

								// Cleanup environment variables (union of group.environments and variables.environments keys)
								if (isCleanupActive(effectiveCleanup.variables.environments)) {
									const preserved = getPreserveList(effectiveCleanup.variables.environments);
									const allEnvVarNames = new Set([...envRefs, ...Object.keys(envVariableMapping)]);
									for (const envName of allEnvVarNames) {
										const configuredNames = new Set<string>();
										for (const ref of envVariableMapping[envName] ?? []) {
											const grp = config.variables[ref];
											if (grp) {
												for (const name of groupEntryNames(grp)) configuredNames.add(name);
											}
										}
										const existing = yield* github.listEnvironmentVariables(owner, repoName, envName).pipe(
											Effect.catchTag("GitHubApiError", (err) =>
												Effect.gen(function* () {
													yield* logger.syncError(`list variables (env: ${envName})`, err.message);
													return [] as { name: string }[];
												}),
											),
										);
										const toDelete: string[] = [];
										for (const { name } of existing) {
											if (!configuredNames.has(name) && !preserved.has(name)) {
												toDelete.push(name);
												yield* logger.syncOperation("delete", "variable", name, `(env: ${envName})`);
												if (!dryRun) {
													yield* github
														.deleteEnvironmentVariable(owner, repoName, envName, name)
														.pipe(
															Effect.catchTag("GitHubApiError", (err) =>
																logger.syncError(`delete variable ${name} (env: ${envName})`, err.message),
															),
														);
												}
											}
										}
										if (toDelete.length > 0) {
											yield* logger.cleanupSummary("variable", toDelete.length, toDelete);
										}
									}
								}

								// Cleanup rulesets
								if (isCleanupActive(effectiveCleanup.rulesets)) {
									const configured = configuredRulesetNames();
									const preserved = getPreserveList(effectiveCleanup.rulesets);
									const existing = yield* github.listRulesets(owner, repoName).pipe(
										Effect.catchTag("GitHubApiError", (err) =>
											Effect.gen(function* () {
												yield* logger.syncError("list rulesets", err.message);
												return [] as { name: string; id: number; source_type?: string }[];
											}),
										),
									);
									const toDelete: string[] = [];
									for (const { name, id, source_type } of existing) {
										if (source_type !== "Repository") continue;
										if (!configured.has(name) && !preserved.has(name)) {
											toDelete.push(name);
											yield* logger.syncOperation("delete", "ruleset", name);
											if (!dryRun) {
												yield* github
													.deleteRuleset(owner, repoName, id)
													.pipe(
														Effect.catchTag("GitHubApiError", (err) =>
															logger.syncError(`delete ruleset ${name}`, err.message),
														),
													);
											}
										}
									}
									if (toDelete.length > 0) {
										yield* logger.cleanupSummary("ruleset", toDelete.length, toDelete);
									}
								}

								// Cleanup environments
								if (isCleanupActive(effectiveCleanup.environments)) {
									const configuredEnvNames = new Set(envRefs);
									const preserved = getPreserveList(effectiveCleanup.environments);
									const existing = yield* github.listEnvironments(owner, repoName).pipe(
										Effect.catchTag("GitHubApiError", (err) =>
											Effect.gen(function* () {
												yield* logger.syncError("list environments", err.message);
												return [] as { name: string }[];
											}),
										),
									);
									const toDelete: string[] = [];
									for (const { name } of existing) {
										if (!configuredEnvNames.has(name) && !preserved.has(name)) {
											toDelete.push(name);
											yield* logger.syncOperation("delete", "environment", name);
											if (!dryRun) {
												yield* github
													.deleteEnvironment(owner, repoName, name)
													.pipe(
														Effect.catchTag("GitHubApiError", (err) =>
															logger.syncError(`delete environment ${name}`, err.message),
														),
													);
											}
										}
									}
									if (toDelete.length > 0) {
										yield* logger.cleanupSummary("environment", toDelete.length, toDelete);
									}
								}
							}
						}
					}

					yield* logger.finish();
				}).pipe(
					Effect.catchAll((error) =>
						Effect.fail(
							error instanceof SyncError
								? error
								: new SyncError({ message: error instanceof Error ? error.message : String(error) }),
						),
					),
				);
			},
		};
	}),
);
