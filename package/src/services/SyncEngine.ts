import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { Context, Effect, Layer } from "effect";
import { ResolveError, SyncError } from "../errors.js";
import type { Cleanup, SecretGroup } from "../schemas/common.js";
import type { Config } from "../schemas/config.js";
import type { Credentials } from "../schemas/credentials.js";
import type { Ruleset } from "../schemas/ruleset.js";
import { CredentialResolver } from "./CredentialResolver.js";
import type { SecretScope } from "./GitHubClient.js";
import { GitHubClient } from "./GitHubClient.js";
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

function mergeCleanup(base: Cleanup, override?: Cleanup): Cleanup {
	if (!override) return base;
	return {
		secrets: override.secrets ?? base.secrets,
		variables: override.variables ?? base.variables,
		dependabot_secrets: override.dependabot_secrets ?? base.dependabot_secrets,
		codespaces_secrets: override.codespaces_secrets ?? base.codespaces_secrets,
		rulesets: override.rulesets ?? base.rulesets,
		preserve: {
			secrets: [...(base.preserve?.secrets ?? []), ...(override.preserve?.secrets ?? [])],
			variables: [...(base.preserve?.variables ?? []), ...(override.preserve?.variables ?? [])],
			dependabot_secrets: [
				...(base.preserve?.dependabot_secrets ?? []),
				...(override.preserve?.dependabot_secrets ?? []),
			],
			codespaces_secrets: [
				...(base.preserve?.codespaces_secrets ?? []),
				...(override.preserve?.codespaces_secrets ?? []),
			],
			rulesets: [...(base.preserve?.rulesets ?? []), ...(override.preserve?.rulesets ?? [])],
		},
	};
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
						const rulesetMap: Map<string, Ruleset> = new Map();
						for (const ref of groupRulesetRefs) {
							const ruleset = config.rulesets[ref];
							if (ruleset) {
								const resolved = resolveRulesetRefs(ruleset, credentialMap);
								rulesetMap.set(ref, resolved);
							}
						}

						// Merge cleanup config
						const effectiveCleanup = mergeCleanup(config.cleanup, group.cleanup);

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
						for (const ref of settingGroupRefs) {
							const settingGroup = config.settings[ref];
							if (settingGroup) Object.assign(mergedSettings, settingGroup);
						}
						const hasSecrets = secretScopes.some((s) => (resolvedSecrets.get(s)?.size ?? 0) > 0);
						const hasVariables = resolvedVariables.size > 0;
						const hasRulesets = rulesetMap.size > 0;
						const hasSettings = Object.keys(mergedSettings).length > 0;
						const hasCleanup =
							!noCleanup &&
							(effectiveCleanup.secrets ||
								effectiveCleanup.variables ||
								effectiveCleanup.dependabot_secrets ||
								effectiveCleanup.codespaces_secrets ||
								effectiveCleanup.rulesets);

						for (const repoName of group.repos) {
							if (repoFilter && repoName !== repoFilter) continue;

							if (!hasSecrets && !hasVariables && !hasRulesets && !hasSettings && !hasCleanup) {
								yield* logger.repoSkip(owner, repoName, "no changes configured");
								continue;
							}

							yield* logger.repoStart(owner, repoName);

							// --- Sync Phase ---
							if (!dryRun) {
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

								// Sync variables
								for (const [name, value] of resolvedVariables) {
									yield* logger.syncOperation("sync", "variable", name);
									yield* github
										.syncVariable(owner, repoName, name, value)
										.pipe(
											Effect.catchTag("GitHubApiError", (err) => logger.syncError(`variable ${name}`, err.message)),
										);
								}

								// Sync settings
								if (hasSettings) {
									yield* logger.syncOperation("apply", "settings", "");
									yield* github
										.syncSettings(owner, repoName, mergedSettings)
										.pipe(Effect.catchTag("GitHubApiError", (err) => logger.syncError("settings", err.message)));
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
								if (effectiveCleanup.secrets) {
									const configured = configuredSecretNames("actions");
									const preserved = new Set(effectiveCleanup.preserve?.secrets ?? []);
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
								if (effectiveCleanup.dependabot_secrets) {
									const configured = configuredSecretNames("dependabot");
									const preserved = new Set(effectiveCleanup.preserve?.dependabot_secrets ?? []);
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
								if (effectiveCleanup.codespaces_secrets) {
									const configured = configuredSecretNames("codespaces");
									const preserved = new Set(effectiveCleanup.preserve?.codespaces_secrets ?? []);
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

								// Cleanup variables
								if (effectiveCleanup.variables) {
									const configured = configuredVariableNames();
									const preserved = new Set(effectiveCleanup.preserve?.variables ?? []);
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

								// Cleanup rulesets
								if (effectiveCleanup.rulesets) {
									const configured = configuredRulesetNames();
									const preserved = new Set(effectiveCleanup.preserve?.rulesets ?? []);
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
