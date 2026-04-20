import { Octokit } from "@octokit/rest";
import { Context, Effect, Layer } from "effect";
import { GitHubApiError } from "../errors.js";
import { encryptSecret } from "../lib/crypto.js";
import type { RulesetPayload } from "../schemas/ruleset.js";

export type SecretScope = "actions" | "dependabot" | "codespaces";

export interface SecretInfo {
	name: string;
}

export interface VariableInfo {
	name: string;
}

export interface RulesetInfo {
	name: string;
	id: number;
	source_type?: string | undefined;
}

export interface EnvironmentInfo {
	name: string;
}

export type OwnerType = "User" | "Organization";

export interface GitHubClientService {
	readonly getOwnerType: (owner: string) => Effect.Effect<OwnerType, GitHubApiError>;

	readonly syncSecret: (
		owner: string,
		repo: string,
		name: string,
		value: string,
		scope: SecretScope,
	) => Effect.Effect<void, GitHubApiError>;

	readonly syncVariable: (
		owner: string,
		repo: string,
		name: string,
		value: string,
	) => Effect.Effect<void, GitHubApiError>;

	readonly syncSettings: (
		owner: string,
		repo: string,
		settings: Record<string, unknown>,
	) => Effect.Effect<void, GitHubApiError>;

	readonly syncRuleset: (
		owner: string,
		repo: string,
		name: string,
		payload: RulesetPayload,
	) => Effect.Effect<void, GitHubApiError>;

	readonly listSecrets: (
		owner: string,
		repo: string,
		scope: SecretScope,
	) => Effect.Effect<SecretInfo[], GitHubApiError>;

	readonly listVariables: (owner: string, repo: string) => Effect.Effect<VariableInfo[], GitHubApiError>;

	readonly listRulesets: (owner: string, repo: string) => Effect.Effect<RulesetInfo[], GitHubApiError>;

	readonly deleteSecret: (
		owner: string,
		repo: string,
		name: string,
		scope: SecretScope,
	) => Effect.Effect<void, GitHubApiError>;

	readonly deleteVariable: (owner: string, repo: string, name: string) => Effect.Effect<void, GitHubApiError>;

	readonly deleteRuleset: (owner: string, repo: string, rulesetId: number) => Effect.Effect<void, GitHubApiError>;

	readonly syncEnvironment: (
		owner: string,
		repo: string,
		name: string,
		config: Record<string, unknown>,
	) => Effect.Effect<void, GitHubApiError>;

	readonly syncEnvironmentSecret: (
		owner: string,
		repo: string,
		envName: string,
		name: string,
		value: string,
	) => Effect.Effect<void, GitHubApiError>;

	readonly syncEnvironmentVariable: (
		owner: string,
		repo: string,
		envName: string,
		name: string,
		value: string,
	) => Effect.Effect<void, GitHubApiError>;

	readonly listEnvironments: (owner: string, repo: string) => Effect.Effect<EnvironmentInfo[], GitHubApiError>;

	readonly listEnvironmentSecrets: (
		owner: string,
		repo: string,
		envName: string,
	) => Effect.Effect<SecretInfo[], GitHubApiError>;

	readonly listEnvironmentVariables: (
		owner: string,
		repo: string,
		envName: string,
	) => Effect.Effect<VariableInfo[], GitHubApiError>;

	readonly deleteEnvironment: (owner: string, repo: string, name: string) => Effect.Effect<void, GitHubApiError>;

	readonly deleteEnvironmentSecret: (
		owner: string,
		repo: string,
		envName: string,
		name: string,
	) => Effect.Effect<void, GitHubApiError>;

	readonly deleteEnvironmentVariable: (
		owner: string,
		repo: string,
		envName: string,
		name: string,
	) => Effect.Effect<void, GitHubApiError>;
}

export class GitHubClient extends Context.Tag("GitHubClient")<GitHubClient, GitHubClientService>() {}

/** Settings fields that are only valid for organization-owned repositories. */
export const ORG_ONLY_SETTINGS = new Set(["allow_forking"]);

/**
 * Settings fields only available via the GraphQL `updateRepository` mutation.
 * Maps snake_case config keys to camelCase GraphQL input field names.
 */
export const GRAPHQL_SETTINGS: Record<string, string> = {
	has_sponsorships: "hasSponsorshipsEnabled",
	has_pull_requests: "hasPullRequestsEnabled",
};

export function GitHubClientLive(token: string): Layer.Layer<GitHubClient> {
	return Layer.succeed(
		GitHubClient,
		((): GitHubClientService => {
			const octokit = new Octokit({ auth: token });

			function wrapError(error: unknown): GitHubApiError {
				if (error instanceof Error) {
					const asAny = error as unknown as Record<string, unknown>;
					const status = typeof asAny.status === "number" ? asAny.status : undefined;
					if (status !== undefined) {
						return new GitHubApiError({ message: error.message, status });
					}
					return new GitHubApiError({ message: error.message });
				}
				return new GitHubApiError({ message: String(error) });
			}

			const ownerTypeCache = new Map<string, OwnerType>();

			return {
				getOwnerType(owner) {
					return Effect.tryPromise({
						try: async () => {
							const cached = ownerTypeCache.get(owner);
							if (cached) return cached;
							const { data } = await octokit.users.getByUsername({ username: owner });
							const ownerType = data.type === "Organization" ? "Organization" : "User";
							ownerTypeCache.set(owner, ownerType);
							return ownerType;
						},
						catch: wrapError,
					});
				},

				syncSecret(owner, repo, name, value, scope) {
					return Effect.tryPromise({
						try: async () => {
							if (scope === "actions") {
								const { data: publicKey } = await octokit.actions.getRepoPublicKey({ owner, repo });
								const encryptedValue = encryptSecret(publicKey.key, value);
								await octokit.actions.createOrUpdateRepoSecret({
									owner,
									repo,
									secret_name: name,
									encrypted_value: encryptedValue,
									key_id: publicKey.key_id,
								});
							} else if (scope === "dependabot") {
								const { data: publicKey } = await octokit.dependabot.getRepoPublicKey({ owner, repo });
								const encryptedValue = encryptSecret(publicKey.key, value);
								await octokit.dependabot.createOrUpdateRepoSecret({
									owner,
									repo,
									secret_name: name,
									encrypted_value: encryptedValue,
									key_id: publicKey.key_id,
								});
							} else {
								const { data: publicKey } = await octokit.codespaces.getRepoPublicKey({ owner, repo });
								const encryptedValue = encryptSecret(publicKey.key, value);
								await octokit.codespaces.createOrUpdateRepoSecret({
									owner,
									repo,
									secret_name: name,
									encrypted_value: encryptedValue,
									key_id: publicKey.key_id,
								});
							}
						},
						catch: wrapError,
					});
				},

				syncVariable(owner, repo, name, value) {
					return Effect.tryPromise({
						try: async () => {
							const { data } = await octokit.actions.listRepoVariables({ owner, repo });
							const exists = data.variables.some((v) => v.name === name);
							if (exists) {
								await octokit.actions.updateRepoVariable({ owner, repo, name, value });
							} else {
								await octokit.actions.createRepoVariable({ owner, repo, name, value });
							}
						},
						catch: wrapError,
					});
				},

				syncSettings(owner, repo, settings) {
					return Effect.tryPromise({
						try: async () => {
							const restSettings: Record<string, unknown> = {};
							const graphqlInput: Record<string, unknown> = {};

							for (const [key, value] of Object.entries(settings)) {
								const graphqlField = GRAPHQL_SETTINGS[key];
								if (graphqlField !== undefined) {
									graphqlInput[graphqlField] = value;
								} else {
									restSettings[key] = value;
								}
							}

							// Strip merge commit config when the strategy is disabled
							if (restSettings.allow_merge_commit === false) {
								delete restSettings.merge_commit_title;
								delete restSettings.merge_commit_message;
							}
							if (restSettings.allow_squash_merge === false) {
								delete restSettings.squash_merge_commit_title;
								delete restSettings.squash_merge_commit_message;
							}

							if (Object.keys(restSettings).length > 0) {
								await octokit.repos.update({ owner, repo, ...restSettings });
							}

							if (Object.keys(graphqlInput).length > 0) {
								const { data: repoData } = await octokit.repos.get({ owner, repo });
								await octokit.graphql(
									`mutation UpdateRepository($input: UpdateRepositoryInput!) {
										updateRepository(input: $input) {
											repository { id }
										}
									}`,
									{ input: { repositoryId: repoData.node_id, ...graphqlInput } },
								);
							}
						},
						catch: wrapError,
					});
				},

				syncRuleset(owner, repo, name, payload) {
					return Effect.tryPromise({
						try: async () => {
							const { data: existing } = await octokit.repos.getRepoRulesets({ owner, repo });
							const match = existing.find((r) => r.name === name);
							const body = {
								name: payload.name,
								target: payload.target,
								enforcement: payload.enforcement,
								...(payload.conditions !== undefined ? { conditions: payload.conditions as never } : {}),
								...(payload.rules !== undefined ? { rules: payload.rules as never } : {}),
								...(payload.bypass_actors !== undefined ? { bypass_actors: payload.bypass_actors as never } : {}),
							};
							if (match) {
								await octokit.repos.updateRepoRuleset({ owner, repo, ruleset_id: match.id, ...body });
							} else {
								await octokit.repos.createRepoRuleset({ owner, repo, ...body });
							}
						},
						catch: wrapError,
					});
				},

				listSecrets(owner, repo, scope) {
					return Effect.tryPromise({
						try: async () => {
							if (scope === "actions") {
								const { data } = await octokit.actions.listRepoSecrets({ owner, repo });
								return data.secrets.map((s): SecretInfo => ({ name: s.name }));
							} else if (scope === "dependabot") {
								const { data } = await octokit.dependabot.listRepoSecrets({ owner, repo });
								return data.secrets.map((s): SecretInfo => ({ name: s.name }));
							} else {
								const { data } = await octokit.codespaces.listRepoSecrets({ owner, repo });
								return data.secrets.map((s): SecretInfo => ({ name: s.name }));
							}
						},
						catch: wrapError,
					});
				},

				listVariables(owner, repo) {
					return Effect.tryPromise({
						try: async () => {
							const { data } = await octokit.actions.listRepoVariables({ owner, repo });
							return data.variables.map((v): VariableInfo => ({ name: v.name }));
						},
						catch: wrapError,
					});
				},

				listRulesets(owner, repo) {
					return Effect.tryPromise({
						try: async () => {
							const { data } = await octokit.repos.getRepoRulesets({ owner, repo });
							return data.map(
								(r): RulesetInfo => ({
									name: r.name,
									id: r.id,
									source_type: r.source_type,
								}),
							);
						},
						catch: wrapError,
					});
				},

				deleteSecret(owner, repo, name, scope) {
					return Effect.tryPromise({
						try: async () => {
							if (scope === "actions") {
								await octokit.actions.deleteRepoSecret({ owner, repo, secret_name: name });
							} else if (scope === "dependabot") {
								await octokit.dependabot.deleteRepoSecret({ owner, repo, secret_name: name });
							} else {
								await octokit.codespaces.deleteRepoSecret({ owner, repo, secret_name: name });
							}
						},
						catch: wrapError,
					});
				},

				deleteVariable(owner, repo, name) {
					return Effect.tryPromise({
						try: async () => {
							await octokit.actions.deleteRepoVariable({ owner, repo, name });
						},
						catch: wrapError,
					});
				},

				deleteRuleset(owner, repo, rulesetId) {
					return Effect.tryPromise({
						try: async () => {
							await octokit.repos.deleteRepoRuleset({ owner, repo, ruleset_id: rulesetId });
						},
						catch: wrapError,
					});
				},

				syncEnvironment(owner, repo, name, config) {
					return Effect.tryPromise({
						try: async () => {
							await octokit.repos.createOrUpdateEnvironment({
								owner,
								repo,
								environment_name: name,
								...config,
							});
						},
						catch: wrapError,
					});
				},

				syncEnvironmentSecret(owner, repo, envName, name, value) {
					return Effect.tryPromise({
						try: async () => {
							const { data: publicKey } = await octokit.actions.getEnvironmentPublicKey({
								owner,
								repo,
								environment_name: envName,
							});
							const encrypted_value = encryptSecret(publicKey.key, value);
							await octokit.actions.createOrUpdateEnvironmentSecret({
								owner,
								repo,
								environment_name: envName,
								secret_name: name,
								encrypted_value,
								key_id: publicKey.key_id,
							});
						},
						catch: wrapError,
					});
				},

				syncEnvironmentVariable(owner, repo, envName, name, value) {
					return Effect.tryPromise({
						try: async () => {
							const { data } = await octokit.actions.listEnvironmentVariables({
								owner,
								repo,
								environment_name: envName,
							});
							const exists = data.variables.some((v) => v.name === name);
							if (exists) {
								await octokit.actions.updateEnvironmentVariable({
									owner,
									repo,
									environment_name: envName,
									name,
									value,
								});
							} else {
								await octokit.actions.createEnvironmentVariable({
									owner,
									repo,
									environment_name: envName,
									name,
									value,
								});
							}
						},
						catch: wrapError,
					});
				},

				listEnvironments(owner, repo) {
					return Effect.tryPromise({
						try: async () => {
							const { data } = await octokit.repos.getAllEnvironments({ owner, repo });
							return (data.environments ?? []).map((e): EnvironmentInfo => ({ name: e.name }));
						},
						catch: wrapError,
					});
				},

				listEnvironmentSecrets(owner, repo, envName) {
					return Effect.tryPromise({
						try: async () => {
							const { data } = await octokit.actions.listEnvironmentSecrets({
								owner,
								repo,
								environment_name: envName,
							});
							return data.secrets.map((s): SecretInfo => ({ name: s.name }));
						},
						catch: wrapError,
					});
				},

				listEnvironmentVariables(owner, repo, envName) {
					return Effect.tryPromise({
						try: async () => {
							const { data } = await octokit.actions.listEnvironmentVariables({
								owner,
								repo,
								environment_name: envName,
							});
							return data.variables.map((v): VariableInfo => ({ name: v.name }));
						},
						catch: wrapError,
					});
				},

				deleteEnvironment(owner, repo, name) {
					return Effect.tryPromise({
						try: async () => {
							await octokit.repos.deleteAnEnvironment({ owner, repo, environment_name: name });
						},
						catch: wrapError,
					});
				},

				deleteEnvironmentSecret(owner, repo, envName, name) {
					return Effect.tryPromise({
						try: async () => {
							await octokit.actions.deleteEnvironmentSecret({
								owner,
								repo,
								environment_name: envName,
								secret_name: name,
							});
						},
						catch: wrapError,
					});
				},

				deleteEnvironmentVariable(owner, repo, envName, name) {
					return Effect.tryPromise({
						try: async () => {
							await octokit.actions.deleteEnvironmentVariable({
								owner,
								repo,
								environment_name: envName,
								name,
							});
						},
						catch: wrapError,
					});
				},
			};
		})(),
	);
}

export interface RecordedCall {
	method: string;
	args: Record<string, unknown>;
}

export function GitHubClientTest(): { layer: Layer.Layer<GitHubClient>; calls: () => RecordedCall[] } {
	const recorded: RecordedCall[] = [];

	const layer = Layer.succeed(GitHubClient, {
		getOwnerType(_owner) {
			return Effect.succeed("User" as OwnerType);
		},

		syncSecret(owner, repo, name, _value, scope) {
			recorded.push({ method: "syncSecret", args: { owner, repo, name, scope } });
			return Effect.void;
		},

		syncVariable(owner, repo, name, _value) {
			recorded.push({ method: "syncVariable", args: { owner, repo, name } });
			return Effect.void;
		},

		syncSettings(owner, repo, settings) {
			recorded.push({ method: "syncSettings", args: { owner, repo, settings } });
			return Effect.void;
		},

		syncRuleset(owner, repo, name, _payload) {
			recorded.push({ method: "syncRuleset", args: { owner, repo, name } });
			return Effect.void;
		},

		listSecrets(_owner, _repo, _scope) {
			return Effect.succeed([]);
		},

		listVariables(_owner, _repo) {
			return Effect.succeed([]);
		},

		listRulesets(_owner, _repo) {
			return Effect.succeed([]);
		},

		deleteSecret(owner, repo, name, scope) {
			recorded.push({ method: "deleteSecret", args: { owner, repo, name, scope } });
			return Effect.void;
		},

		deleteVariable(owner, repo, name) {
			recorded.push({ method: "deleteVariable", args: { owner, repo, name } });
			return Effect.void;
		},

		deleteRuleset(owner, repo, rulesetId) {
			recorded.push({ method: "deleteRuleset", args: { owner, repo, rulesetId } });
			return Effect.void;
		},

		syncEnvironment(owner, repo, name, _config) {
			recorded.push({ method: "syncEnvironment", args: { owner, repo, name } });
			return Effect.void;
		},

		syncEnvironmentSecret(owner, repo, envName, name, _value) {
			recorded.push({ method: "syncEnvironmentSecret", args: { owner, repo, envName, name } });
			return Effect.void;
		},

		syncEnvironmentVariable(owner, repo, envName, name, _value) {
			recorded.push({ method: "syncEnvironmentVariable", args: { owner, repo, envName, name } });
			return Effect.void;
		},

		listEnvironments(_owner, _repo) {
			return Effect.succeed([]);
		},

		listEnvironmentSecrets(_owner, _repo, _envName) {
			return Effect.succeed([]);
		},

		listEnvironmentVariables(_owner, _repo, _envName) {
			return Effect.succeed([]);
		},

		deleteEnvironment(owner, repo, name) {
			recorded.push({ method: "deleteEnvironment", args: { owner, repo, name } });
			return Effect.void;
		},

		deleteEnvironmentSecret(owner, repo, envName, name) {
			recorded.push({ method: "deleteEnvironmentSecret", args: { owner, repo, envName, name } });
			return Effect.void;
		},

		deleteEnvironmentVariable(owner, repo, envName, name) {
			recorded.push({ method: "deleteEnvironmentVariable", args: { owner, repo, envName, name } });
			return Effect.void;
		},
	});

	return { layer, calls: () => [...recorded] };
}
