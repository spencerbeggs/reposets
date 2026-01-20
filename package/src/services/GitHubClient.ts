import { Octokit } from "@octokit/rest";
import { Context, Effect, Layer } from "effect";
import { GitHubApiError } from "../errors.js";
import { encryptSecret } from "../lib/crypto.js";

export type SecretScope = "actions" | "dependabot" | "codespaces";

export interface RulesetPayload {
	name: string;
	target: "branch" | "tag";
	enforcement: "active" | "disabled" | "evaluate";
	conditions?: unknown;
	rules?: unknown;
	bypass_actors?: unknown;
}

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

export interface GitHubClientService {
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
}

export class GitHubClient extends Context.Tag("GitHubClient")<GitHubClient, GitHubClientService>() {}

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

			return {
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
							await octokit.repos.update({ owner, repo, ...settings });
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
			};
		})(),
	);
}

interface RecordedCall {
	method: string;
	args: Record<string, unknown>;
}

export function GitHubClientTest(): { layer: Layer.Layer<GitHubClient>; calls: () => RecordedCall[] } {
	const recorded: RecordedCall[] = [];

	const layer = Layer.succeed(GitHubClient, {
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
	});

	return { layer, calls: () => [...recorded] };
}
