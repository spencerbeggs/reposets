import { Context, Effect, Layer } from "effect";
import { SyncError } from "../errors.js";
import type { Cleanup } from "../schemas/common.js";
import type { Config } from "../schemas/config.js";
import type { Credentials } from "../schemas/credentials.js";
import type { SecretScope } from "./GitHubClient.js";
import { GitHubClient } from "./GitHubClient.js";
import { ValueResolver } from "./ValueResolver.js";

interface SyncOptions {
	readonly dryRun: boolean;
	readonly noCleanup: boolean;
	readonly groupFilter?: string | undefined;
	readonly repoFilter?: string | undefined;
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

export const SyncEngineLive = Layer.effect(
	SyncEngine,
	Effect.gen(function* () {
		const github = yield* GitHubClient;
		const resolver = yield* ValueResolver;

		return {
			syncAll(config: Config, credentials: Credentials, options: SyncOptions) {
				return Effect.gen(function* () {
					const { dryRun, noCleanup, groupFilter, repoFilter } = options;

					// Resolve the default credential profile - if only one, use it implicitly
					const profileEntries = Object.entries(credentials.profiles);
					const defaultProfileName = profileEntries.length === 1 ? (profileEntries[0]?.[0] ?? "default") : "default";
					const defaultProfile = credentials.profiles[defaultProfileName];

					const groups = Object.entries(config.repos);

					for (const [groupName, group] of groups) {
						// Apply group filter if set
						if (groupFilter && groupName !== groupFilter) continue;

						const owner = group.owner ?? config.owner ?? "";
						const profileName = group.credentials ?? defaultProfileName;
						const profile = credentials.profiles[profileName] ?? defaultProfile;
						const opToken = profile?.op_service_account_token;

						// Resolve all secret values for all referenced secret groups across all scopes
						const secretScopes: SecretScope[] = ["actions", "dependabot", "codespaces"];
						const resolvedSecrets: Map<string, Map<string, string>> = new Map();

						for (const scope of secretScopes) {
							const groupRefs = group.secrets?.[scope] ?? [];
							for (const groupRef of groupRefs) {
								const secretGroup = config.secrets[groupRef];
								if (!secretGroup) continue;

								const scopeMap = resolvedSecrets.get(scope) ?? new Map<string, string>();
								for (const [name, source] of Object.entries(secretGroup)) {
									const value = yield* resolver.resolve(source, process.cwd(), opToken);
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
							for (const [name, source] of Object.entries(variableGroup)) {
								const value = yield* resolver.resolve(source, process.cwd(), opToken);
								resolvedVariables.set(name, value);
							}
						}

						// Resolve all ruleset payloads
						const resolvedRulesets: Map<string, string> = new Map();
						const rulesetGroupRefs = group.rulesets ?? [];
						for (const groupRef of rulesetGroupRefs) {
							const rulesetGroup = config.rulesets[groupRef];
							if (!rulesetGroup) continue;
							for (const [name, source] of Object.entries(rulesetGroup)) {
								const value = yield* resolver.resolve(source, process.cwd(), opToken);
								resolvedRulesets.set(name, value);
							}
						}

						// Merge cleanup config
						const effectiveCleanup = mergeCleanup(config.cleanup, group.cleanup);

						// Get configured secret names per scope for cleanup
						const configuredSecretNames = (scope: SecretScope): Set<string> => {
							const refs = group.secrets?.[scope] ?? [];
							const names = new Set<string>();
							for (const ref of refs) {
								const grp = config.secrets[ref];
								if (grp) {
									for (const name of Object.keys(grp)) names.add(name);
								}
							}
							return names;
						};

						// Get configured variable names for cleanup
						const configuredVariableNames = (): Set<string> => {
							const refs = group.variables?.actions ?? [];
							const names = new Set<string>();
							for (const ref of refs) {
								const grp = config.variables[ref];
								if (grp) {
									for (const name of Object.keys(grp)) names.add(name);
								}
							}
							return names;
						};

						// Get configured ruleset names for cleanup
						const configuredRulesetNames = (): Set<string> => {
							const refs = group.rulesets ?? [];
							const names = new Set<string>();
							for (const ref of refs) {
								const grp = config.rulesets[ref];
								if (grp) {
									for (const name of Object.keys(grp)) names.add(name);
								}
							}
							return names;
						};

						for (const repoName of group.names) {
							// Apply repo filter if set
							if (repoFilter && repoName !== repoFilter) continue;

							if (!dryRun) {
								// Sync secrets by scope
								for (const scope of secretScopes) {
									const scopeMap = resolvedSecrets.get(scope);
									if (scopeMap) {
										for (const [name, value] of scopeMap) {
											yield* github.syncSecret(owner, repoName, name, value, scope);
										}
									}
								}

								// Sync variables
								for (const [name, value] of resolvedVariables) {
									yield* github.syncVariable(owner, repoName, name, value);
								}

								// Sync settings
								const settingGroupRefs = group.settings ?? [];
								const mergedSettings: Record<string, unknown> = {};
								for (const ref of settingGroupRefs) {
									const settingGroup = config.settings[ref];
									if (settingGroup) {
										Object.assign(mergedSettings, settingGroup);
									}
								}
								if (Object.keys(mergedSettings).length > 0) {
									yield* github.syncSettings(owner, repoName, mergedSettings);
								}

								// Sync rulesets
								for (const [name, payloadStr] of resolvedRulesets) {
									const payload = JSON.parse(payloadStr) as {
										name: string;
										target: "branch" | "tag";
										enforcement: "active" | "disabled" | "evaluate";
										conditions?: unknown;
										rules?: unknown;
										bypass_actors?: unknown;
									};
									yield* github.syncRuleset(owner, repoName, name, payload);
								}
							}

							if (!noCleanup) {
								// Cleanup actions secrets
								if (effectiveCleanup.secrets) {
									const configured = configuredSecretNames("actions");
									const preserved = new Set(effectiveCleanup.preserve?.secrets ?? []);
									const existing = yield* github.listSecrets(owner, repoName, "actions");
									for (const { name } of existing) {
										if (!configured.has(name) && !preserved.has(name)) {
											yield* github.deleteSecret(owner, repoName, name, "actions");
										}
									}
								}

								// Cleanup dependabot secrets
								if (effectiveCleanup.dependabot_secrets) {
									const configured = configuredSecretNames("dependabot");
									const preserved = new Set(effectiveCleanup.preserve?.dependabot_secrets ?? []);
									const existing = yield* github.listSecrets(owner, repoName, "dependabot");
									for (const { name } of existing) {
										if (!configured.has(name) && !preserved.has(name)) {
											yield* github.deleteSecret(owner, repoName, name, "dependabot");
										}
									}
								}

								// Cleanup codespaces secrets
								if (effectiveCleanup.codespaces_secrets) {
									const configured = configuredSecretNames("codespaces");
									const preserved = new Set(effectiveCleanup.preserve?.codespaces_secrets ?? []);
									const existing = yield* github.listSecrets(owner, repoName, "codespaces");
									for (const { name } of existing) {
										if (!configured.has(name) && !preserved.has(name)) {
											yield* github.deleteSecret(owner, repoName, name, "codespaces");
										}
									}
								}

								// Cleanup variables
								if (effectiveCleanup.variables) {
									const configured = configuredVariableNames();
									const preserved = new Set(effectiveCleanup.preserve?.variables ?? []);
									const existing = yield* github.listVariables(owner, repoName);
									for (const { name } of existing) {
										if (!configured.has(name) && !preserved.has(name)) {
											yield* github.deleteVariable(owner, repoName, name);
										}
									}
								}

								// Cleanup rulesets (only Repository source_type)
								if (effectiveCleanup.rulesets) {
									const configured = configuredRulesetNames();
									const preserved = new Set(effectiveCleanup.preserve?.rulesets ?? []);
									const existing = yield* github.listRulesets(owner, repoName);
									for (const { name, id, source_type } of existing) {
										if (source_type !== "Repository") continue;
										if (!configured.has(name) && !preserved.has(name)) {
											yield* github.deleteRuleset(owner, repoName, id);
										}
									}
								}
							}
						}
					}
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
