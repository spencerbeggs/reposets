import { Octokit } from "@octokit/rest";
import { Context, Effect, Layer } from "effect";
import { GitHubApiError } from "../errors.js";
import { encryptSecret } from "../lib/crypto.js";
import type { CodeScanningGroup } from "../schemas/config.js";
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

	readonly getVulnerabilityAlerts: (owner: string, repo: string) => Effect.Effect<boolean, GitHubApiError>;

	readonly setVulnerabilityAlerts: (
		owner: string,
		repo: string,
		enabled: boolean,
	) => Effect.Effect<void, GitHubApiError>;

	readonly getAutomatedSecurityFixes: (owner: string, repo: string) => Effect.Effect<boolean, GitHubApiError>;

	readonly setAutomatedSecurityFixes: (
		owner: string,
		repo: string,
		enabled: boolean,
	) => Effect.Effect<void, GitHubApiError>;

	readonly getPrivateVulnerabilityReporting: (owner: string, repo: string) => Effect.Effect<boolean, GitHubApiError>;

	readonly setPrivateVulnerabilityReporting: (
		owner: string,
		repo: string,
		enabled: boolean,
	) => Effect.Effect<void, GitHubApiError>;

	readonly updateCodeScanningDefaultSetup: (
		owner: string,
		repo: string,
		config: CodeScanningGroup,
	) => Effect.Effect<void, GitHubApiError>;

	readonly listRepoLanguages: (owner: string, repo: string) => Effect.Effect<ReadonlyArray<string>, GitHubApiError>;

	readonly resolveTeamId: (org: string, slug: string) => Effect.Effect<number, GitHubApiError>;

	readonly resolveRoleId: (org: string, name: string) => Effect.Effect<number, GitHubApiError>;
}

export class GitHubClient extends Context.Tag("GitHubClient")<GitHubClient, GitHubClientService>() {}

/** Settings fields that are only valid for organization-owned repositories. */
export const ORG_ONLY_SETTINGS = new Set(["allow_forking"]);

/**
 * Fields in the user-facing security_and_analysis block that GitHub's API
 * accepts as `{ status: "enabled" | "disabled" }`. The value as stored in
 * config is the literal string; we wrap it before sending.
 */
const SAA_STATUS_FIELDS = new Set([
	"advanced_security",
	"code_security",
	"secret_scanning",
	"secret_scanning_push_protection",
	"secret_scanning_ai_detection",
	"secret_scanning_non_provider_patterns",
	"secret_scanning_delegated_alert_dismissal",
	"secret_scanning_delegated_bypass",
	"dependabot_security_updates",
]);

/**
 * Translate the user-facing security_and_analysis config block into the
 * shape GitHub expects on `PATCH /repos/{o}/{r}`. Reviewer entries are
 * expected to already have a numeric `reviewer_id` and `reviewer_type`
 * (resolution from team slugs happens in the SyncEngine).
 */
export function transformSecurityAndAnalysis(value: unknown): Record<string, unknown> | undefined {
	if (value === null || typeof value !== "object") return undefined;
	const input = value as Record<string, unknown>;
	const out: Record<string, unknown> = {};

	for (const [key, raw] of Object.entries(input)) {
		if (raw === undefined) continue;
		if (SAA_STATUS_FIELDS.has(key) && (raw === "enabled" || raw === "disabled")) {
			out[key] = { status: raw };
		} else if (key === "delegated_bypass_reviewers" && Array.isArray(raw) && raw.length > 0) {
			// Empty arrays are treated as "no change" — sending { reviewers: [] }
			// would be rejected by GitHub when delegated bypass is enabled.
			out.secret_scanning_delegated_bypass_options = { reviewers: raw };
		}
	}

	return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Settings fields only available via the GraphQL `updateRepository` mutation.
 * Maps snake_case config keys to camelCase GraphQL input field names.
 */
export const GRAPHQL_SETTINGS: Record<string, string> = {
	has_sponsorships: "hasSponsorshipsEnabled",
	has_pull_requests: "hasPullRequestsEnabled",
};

/* v8 ignore start -- live Octokit API calls, tested via GitHubClientTest recorder */
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
			const teamIdCache = new Map<string, number>();
			const roleIdCache = new Map<string, number>();

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
								if (key === "security_and_analysis") {
									const saa = transformSecurityAndAnalysis(value);
									if (saa !== undefined) restSettings.security_and_analysis = saa;
									continue;
								}
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

				getVulnerabilityAlerts(owner, repo) {
					return Effect.tryPromise({
						try: async () => {
							try {
								await octokit.request("GET /repos/{owner}/{repo}/vulnerability-alerts", { owner, repo });
								return true;
							} catch (error) {
								const status = (error as { status?: number }).status;
								if (status === 404) return false;
								throw error;
							}
						},
						catch: wrapError,
					});
				},

				setVulnerabilityAlerts(owner, repo, enabled) {
					return Effect.tryPromise({
						try: async () => {
							if (enabled) {
								await octokit.request("PUT /repos/{owner}/{repo}/vulnerability-alerts", { owner, repo });
							} else {
								await octokit.request("DELETE /repos/{owner}/{repo}/vulnerability-alerts", { owner, repo });
							}
						},
						catch: wrapError,
					});
				},

				getAutomatedSecurityFixes(owner, repo) {
					return Effect.tryPromise({
						try: async () => {
							const { data } = await octokit.request("GET /repos/{owner}/{repo}/automated-security-fixes", {
								owner,
								repo,
							});
							return Boolean((data as { enabled?: boolean }).enabled);
						},
						catch: wrapError,
					});
				},

				setAutomatedSecurityFixes(owner, repo, enabled) {
					return Effect.tryPromise({
						try: async () => {
							if (enabled) {
								await octokit.request("PUT /repos/{owner}/{repo}/automated-security-fixes", { owner, repo });
							} else {
								await octokit.request("DELETE /repos/{owner}/{repo}/automated-security-fixes", { owner, repo });
							}
						},
						catch: wrapError,
					});
				},

				getPrivateVulnerabilityReporting(owner, repo) {
					return Effect.tryPromise({
						try: async () => {
							const { data } = await octokit.request("GET /repos/{owner}/{repo}/private-vulnerability-reporting", {
								owner,
								repo,
							});
							return Boolean((data as { enabled?: boolean }).enabled);
						},
						catch: wrapError,
					});
				},

				setPrivateVulnerabilityReporting(owner, repo, enabled) {
					return Effect.tryPromise({
						try: async () => {
							if (enabled) {
								await octokit.request("PUT /repos/{owner}/{repo}/private-vulnerability-reporting", { owner, repo });
							} else {
								await octokit.request("DELETE /repos/{owner}/{repo}/private-vulnerability-reporting", {
									owner,
									repo,
								});
							}
						},
						catch: wrapError,
					});
				},

				updateCodeScanningDefaultSetup(owner, repo, config) {
					return Effect.tryPromise({
						try: async () => {
							const body: Record<string, unknown> = {};
							if (config.state !== undefined) body.state = config.state;
							if (config.languages !== undefined) body.languages = [...config.languages];
							if (config.query_suite !== undefined) body.query_suite = config.query_suite;
							if (config.threat_model !== undefined) body.threat_model = config.threat_model;
							if (config.runner_type !== undefined) body.runner_type = config.runner_type;
							if (config.runner_label !== undefined) body.runner_label = config.runner_label;
							await octokit.request("PATCH /repos/{owner}/{repo}/code-scanning/default-setup", {
								owner,
								repo,
								...body,
							});
						},
						catch: wrapError,
					});
				},

				listRepoLanguages(owner, repo) {
					return Effect.tryPromise({
						try: async () => {
							const { data } = await octokit.repos.listLanguages({ owner, repo });
							return Object.keys(data);
						},
						catch: wrapError,
					});
				},

				resolveTeamId(org, slug) {
					return Effect.tryPromise({
						try: async () => {
							const cacheKey = `${org}:${slug}`;
							const cached = teamIdCache.get(cacheKey);
							if (cached !== undefined) return cached;
							const { data } = await octokit.teams.getByName({ org, team_slug: slug });
							teamIdCache.set(cacheKey, data.id);
							return data.id;
						},
						catch: wrapError,
					});
				},

				resolveRoleId(org, name) {
					return Effect.tryPromise({
						try: async () => {
							const cacheKey = `${org}:${name}`;
							const cached = roleIdCache.get(cacheKey);
							if (cached !== undefined) return cached;
							const { data } = await octokit.request("GET /orgs/{org}/organization-roles", { org });
							const roles = (data as { roles?: ReadonlyArray<{ id: number; name: string }> }).roles ?? [];
							const role = roles.find((r) => r.name === name);
							if (!role) {
								throw new Error(
									`organization role '${name}' not found in '${org}' (available: ${roles.map((r) => r.name).join(", ") || "none"})`,
								);
							}
							roleIdCache.set(cacheKey, role.id);
							return role.id;
						},
						catch: wrapError,
					});
				},
			};
		})(),
	);
}
/* v8 ignore stop */

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

		getVulnerabilityAlerts(_owner, _repo) {
			return Effect.succeed(false);
		},

		setVulnerabilityAlerts(owner, repo, enabled) {
			recorded.push({ method: "setVulnerabilityAlerts", args: { owner, repo, enabled } });
			return Effect.void;
		},

		getAutomatedSecurityFixes(_owner, _repo) {
			return Effect.succeed(false);
		},

		setAutomatedSecurityFixes(owner, repo, enabled) {
			recorded.push({ method: "setAutomatedSecurityFixes", args: { owner, repo, enabled } });
			return Effect.void;
		},

		getPrivateVulnerabilityReporting(_owner, _repo) {
			return Effect.succeed(false);
		},

		setPrivateVulnerabilityReporting(owner, repo, enabled) {
			recorded.push({ method: "setPrivateVulnerabilityReporting", args: { owner, repo, enabled } });
			return Effect.void;
		},

		updateCodeScanningDefaultSetup(owner, repo, config) {
			recorded.push({ method: "updateCodeScanningDefaultSetup", args: { owner, repo, config } });
			return Effect.void;
		},

		listRepoLanguages(_owner, _repo) {
			return Effect.succeed([]);
		},

		resolveTeamId(org, slug) {
			recorded.push({ method: "resolveTeamId", args: { org, slug } });
			return Effect.succeed(0);
		},

		resolveRoleId(org, name) {
			recorded.push({ method: "resolveRoleId", args: { org, name } });
			return Effect.succeed(0);
		},
	});

	return { layer, calls: () => [...recorded] };
}
