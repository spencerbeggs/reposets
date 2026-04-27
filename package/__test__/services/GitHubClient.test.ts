import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
	GRAPHQL_SETTINGS,
	GitHubClient,
	GitHubClientTest,
	ORG_ONLY_SETTINGS,
	transformSecurityAndAnalysis,
} from "../../src/services/GitHubClient.js";

describe("GitHubClient", () => {
	describe("GRAPHQL_SETTINGS mapping", () => {
		it("maps has_sponsorships to hasSponsorshipsEnabled", () => {
			expect(GRAPHQL_SETTINGS.has_sponsorships).toBe("hasSponsorshipsEnabled");
		});

		it("maps has_pull_requests to hasPullRequestsEnabled", () => {
			expect(GRAPHQL_SETTINGS.has_pull_requests).toBe("hasPullRequestsEnabled");
		});
	});

	describe("Test implementation", () => {
		it("records syncSecret calls", async () => {
			const recorder = GitHubClientTest();

			const program = Effect.gen(function* () {
				const client = yield* GitHubClient;
				yield* client.syncSecret("owner", "repo", "SECRET_NAME", "secret-value", "actions");
			}).pipe(Effect.provide(recorder.layer));

			await Effect.runPromise(program);
			expect(recorder.calls()).toContainEqual({
				method: "syncSecret",
				args: { owner: "owner", repo: "repo", name: "SECRET_NAME", scope: "actions" },
			});
		});

		it("records syncVariable calls", async () => {
			const recorder = GitHubClientTest();

			const program = Effect.gen(function* () {
				const client = yield* GitHubClient;
				yield* client.syncVariable("owner", "repo", "VAR_NAME", "var-value");
			}).pipe(Effect.provide(recorder.layer));

			await Effect.runPromise(program);
			expect(recorder.calls()).toContainEqual({
				method: "syncVariable",
				args: { owner: "owner", repo: "repo", name: "VAR_NAME" },
			});
		});

		it("records syncSettings calls", async () => {
			const recorder = GitHubClientTest();

			const program = Effect.gen(function* () {
				const client = yield* GitHubClient;
				yield* client.syncSettings("owner", "repo", { has_wiki: false });
			}).pipe(Effect.provide(recorder.layer));

			await Effect.runPromise(program);
			expect(recorder.calls()).toContainEqual({
				method: "syncSettings",
				args: { owner: "owner", repo: "repo", settings: { has_wiki: false } },
			});
		});

		it("records syncSettings with mixed REST and GraphQL-only fields", async () => {
			const recorder = GitHubClientTest();

			const program = Effect.gen(function* () {
				const client = yield* GitHubClient;
				yield* client.syncSettings("owner", "repo", {
					has_wiki: false,
					has_sponsorships: true,
					has_pull_requests: true,
				});
			}).pipe(Effect.provide(recorder.layer));

			await Effect.runPromise(program);
			expect(recorder.calls()).toContainEqual({
				method: "syncSettings",
				args: {
					owner: "owner",
					repo: "repo",
					settings: { has_wiki: false, has_sponsorships: true, has_pull_requests: true },
				},
			});
		});

		it("records syncRuleset calls", async () => {
			const recorder = GitHubClientTest();

			const program = Effect.gen(function* () {
				const client = yield* GitHubClient;
				yield* client.syncRuleset("owner", "repo", "workflow", {
					name: "workflow",
					target: "branch",
					enforcement: "active",
					rules: [{ type: "deletion" }],
					conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
				});
			}).pipe(Effect.provide(recorder.layer));

			await Effect.runPromise(program);
			expect(recorder.calls()).toContainEqual({
				method: "syncRuleset",
				args: { owner: "owner", repo: "repo", name: "workflow" },
			});
		});

		it("returns empty arrays for list methods", async () => {
			const recorder = GitHubClientTest();

			const program = Effect.gen(function* () {
				const client = yield* GitHubClient;
				const secrets = yield* client.listSecrets("owner", "repo", "actions");
				const variables = yield* client.listVariables("owner", "repo");
				const rulesets = yield* client.listRulesets("owner", "repo");
				return { secrets, variables, rulesets };
			}).pipe(Effect.provide(recorder.layer));

			const result = await Effect.runPromise(program);
			expect(result.secrets).toEqual([]);
			expect(result.variables).toEqual([]);
			expect(result.rulesets).toEqual([]);
		});

		it("records delete calls", async () => {
			const recorder = GitHubClientTest();

			const program = Effect.gen(function* () {
				const client = yield* GitHubClient;
				yield* client.deleteSecret("owner", "repo", "OLD_SECRET", "actions");
				yield* client.deleteVariable("owner", "repo", "OLD_VAR");
				yield* client.deleteRuleset("owner", "repo", 42);
			}).pipe(Effect.provide(recorder.layer));

			await Effect.runPromise(program);
			const calls = recorder.calls();
			expect(calls).toContainEqual({
				method: "deleteSecret",
				args: { owner: "owner", repo: "repo", name: "OLD_SECRET", scope: "actions" },
			});
			expect(calls).toContainEqual({
				method: "deleteVariable",
				args: { owner: "owner", repo: "repo", name: "OLD_VAR" },
			});
			expect(calls).toContainEqual({
				method: "deleteRuleset",
				args: { owner: "owner", repo: "repo", rulesetId: 42 },
			});
		});

		it("records syncEnvironment calls", async () => {
			const recorder = GitHubClientTest();

			const program = Effect.gen(function* () {
				const client = yield* GitHubClient;
				yield* client.syncEnvironment("owner", "repo", "production", { wait_timer: 30 });
			}).pipe(Effect.provide(recorder.layer));

			await Effect.runPromise(program);
			expect(recorder.calls()).toContainEqual({
				method: "syncEnvironment",
				args: { owner: "owner", repo: "repo", name: "production" },
			});
		});

		it("records syncEnvironmentSecret calls", async () => {
			const recorder = GitHubClientTest();

			const program = Effect.gen(function* () {
				const client = yield* GitHubClient;
				yield* client.syncEnvironmentSecret("owner", "repo", "production", "API_KEY", "secret-value");
			}).pipe(Effect.provide(recorder.layer));

			await Effect.runPromise(program);
			expect(recorder.calls()).toContainEqual({
				method: "syncEnvironmentSecret",
				args: { owner: "owner", repo: "repo", envName: "production", name: "API_KEY" },
			});
		});

		it("records syncEnvironmentVariable calls", async () => {
			const recorder = GitHubClientTest();

			const program = Effect.gen(function* () {
				const client = yield* GitHubClient;
				yield* client.syncEnvironmentVariable("owner", "repo", "production", "APP_URL", "https://example.com");
			}).pipe(Effect.provide(recorder.layer));

			await Effect.runPromise(program);
			expect(recorder.calls()).toContainEqual({
				method: "syncEnvironmentVariable",
				args: { owner: "owner", repo: "repo", envName: "production", name: "APP_URL" },
			});
		});

		it("returns empty arrays for environment list methods", async () => {
			const recorder = GitHubClientTest();

			const program = Effect.gen(function* () {
				const client = yield* GitHubClient;
				const environments = yield* client.listEnvironments("owner", "repo");
				const envSecrets = yield* client.listEnvironmentSecrets("owner", "repo", "production");
				const envVariables = yield* client.listEnvironmentVariables("owner", "repo", "production");
				return { environments, envSecrets, envVariables };
			}).pipe(Effect.provide(recorder.layer));

			const result = await Effect.runPromise(program);
			expect(result.environments).toEqual([]);
			expect(result.envSecrets).toEqual([]);
			expect(result.envVariables).toEqual([]);
		});

		it("records environment delete calls", async () => {
			const recorder = GitHubClientTest();

			const program = Effect.gen(function* () {
				const client = yield* GitHubClient;
				yield* client.deleteEnvironment("owner", "repo", "staging");
				yield* client.deleteEnvironmentSecret("owner", "repo", "production", "OLD_SECRET");
				yield* client.deleteEnvironmentVariable("owner", "repo", "production", "OLD_VAR");
			}).pipe(Effect.provide(recorder.layer));

			await Effect.runPromise(program);
			const calls = recorder.calls();
			expect(calls).toContainEqual({
				method: "deleteEnvironment",
				args: { owner: "owner", repo: "repo", name: "staging" },
			});
			expect(calls).toContainEqual({
				method: "deleteEnvironmentSecret",
				args: { owner: "owner", repo: "repo", envName: "production", name: "OLD_SECRET" },
			});
			expect(calls).toContainEqual({
				method: "deleteEnvironmentVariable",
				args: { owner: "owner", repo: "repo", envName: "production", name: "OLD_VAR" },
			});
		});
	});

	describe("getOwnerType", () => {
		it("returns User by default in test implementation", async () => {
			const recorder = GitHubClientTest();

			const program = Effect.gen(function* () {
				const client = yield* GitHubClient;
				return yield* client.getOwnerType("spencerbeggs");
			}).pipe(Effect.provide(recorder.layer));

			const result = await Effect.runPromise(program);
			expect(result).toBe("User");
		});
	});

	describe("ORG_ONLY_SETTINGS", () => {
		it("contains allow_forking", () => {
			expect(ORG_ONLY_SETTINGS.has("allow_forking")).toBe(true);
		});
	});

	describe("transformSecurityAndAnalysis", () => {
		it("wraps status fields in { status } objects", () => {
			const result = transformSecurityAndAnalysis({
				secret_scanning: "enabled",
				secret_scanning_push_protection: "disabled",
				dependabot_security_updates: "enabled",
			});
			expect(result).toEqual({
				secret_scanning: { status: "enabled" },
				secret_scanning_push_protection: { status: "disabled" },
				dependabot_security_updates: { status: "enabled" },
			});
		});

		it("renames delegated_bypass_reviewers to secret_scanning_delegated_bypass_options.reviewers", () => {
			const result = transformSecurityAndAnalysis({
				secret_scanning_delegated_bypass: "enabled",
				delegated_bypass_reviewers: [{ reviewer_id: 12345, reviewer_type: "TEAM", mode: "ALWAYS" }],
			});
			expect(result).toEqual({
				secret_scanning_delegated_bypass: { status: "enabled" },
				secret_scanning_delegated_bypass_options: {
					reviewers: [{ reviewer_id: 12345, reviewer_type: "TEAM", mode: "ALWAYS" }],
				},
			});
		});

		it("ignores unknown fields", () => {
			const result = transformSecurityAndAnalysis({ secret_scanning: "enabled", random_field: "x" });
			expect(result).toEqual({ secret_scanning: { status: "enabled" } });
		});

		it("returns undefined for non-object input", () => {
			expect(transformSecurityAndAnalysis(null)).toBeUndefined();
			expect(transformSecurityAndAnalysis("string")).toBeUndefined();
			expect(transformSecurityAndAnalysis(undefined)).toBeUndefined();
		});

		it("returns undefined when no recognised fields are present", () => {
			expect(transformSecurityAndAnalysis({})).toBeUndefined();
			expect(transformSecurityAndAnalysis({ random_field: "x" })).toBeUndefined();
		});

		it("ignores invalid status values", () => {
			expect(transformSecurityAndAnalysis({ secret_scanning: "on" })).toBeUndefined();
		});

		it("treats empty delegated_bypass_reviewers array as no-op (not as a clear-all)", () => {
			expect(
				transformSecurityAndAnalysis({
					secret_scanning_delegated_bypass: "enabled",
					delegated_bypass_reviewers: [],
				}),
			).toEqual({
				secret_scanning_delegated_bypass: { status: "enabled" },
			});
		});
	});

	describe("Test implementation - security methods", () => {
		it("records setVulnerabilityAlerts calls", async () => {
			const recorder = GitHubClientTest();

			const program = Effect.gen(function* () {
				const client = yield* GitHubClient;
				yield* client.setVulnerabilityAlerts("owner", "repo", true);
				yield* client.setVulnerabilityAlerts("owner", "repo2", false);
			}).pipe(Effect.provide(recorder.layer));

			await Effect.runPromise(program);
			expect(recorder.calls()).toContainEqual({
				method: "setVulnerabilityAlerts",
				args: { owner: "owner", repo: "repo", enabled: true },
			});
			expect(recorder.calls()).toContainEqual({
				method: "setVulnerabilityAlerts",
				args: { owner: "owner", repo: "repo2", enabled: false },
			});
		});

		it("records setAutomatedSecurityFixes and setPrivateVulnerabilityReporting calls", async () => {
			const recorder = GitHubClientTest();

			const program = Effect.gen(function* () {
				const client = yield* GitHubClient;
				yield* client.setAutomatedSecurityFixes("owner", "repo", true);
				yield* client.setPrivateVulnerabilityReporting("owner", "repo", true);
			}).pipe(Effect.provide(recorder.layer));

			await Effect.runPromise(program);
			const calls = recorder.calls();
			expect(calls).toContainEqual({
				method: "setAutomatedSecurityFixes",
				args: { owner: "owner", repo: "repo", enabled: true },
			});
			expect(calls).toContainEqual({
				method: "setPrivateVulnerabilityReporting",
				args: { owner: "owner", repo: "repo", enabled: true },
			});
		});

		it("getters return false in test implementation", async () => {
			const recorder = GitHubClientTest();

			const program = Effect.gen(function* () {
				const client = yield* GitHubClient;
				const va = yield* client.getVulnerabilityAlerts("o", "r");
				const asf = yield* client.getAutomatedSecurityFixes("o", "r");
				const pvr = yield* client.getPrivateVulnerabilityReporting("o", "r");
				return { va, asf, pvr };
			}).pipe(Effect.provide(recorder.layer));

			const result = await Effect.runPromise(program);
			expect(result).toEqual({ va: false, asf: false, pvr: false });
		});

		it("records updateCodeScanningDefaultSetup calls", async () => {
			const recorder = GitHubClientTest();

			const program = Effect.gen(function* () {
				const client = yield* GitHubClient;
				yield* client.updateCodeScanningDefaultSetup("owner", "repo", {
					state: "configured",
					languages: ["javascript-typescript"],
					query_suite: "extended",
				});
			}).pipe(Effect.provide(recorder.layer));

			await Effect.runPromise(program);
			expect(recorder.calls()).toContainEqual({
				method: "updateCodeScanningDefaultSetup",
				args: {
					owner: "owner",
					repo: "repo",
					config: {
						state: "configured",
						languages: ["javascript-typescript"],
						query_suite: "extended",
					},
				},
			});
		});

		it("getCodeScanningDefaultSetup returns empty object", async () => {
			const recorder = GitHubClientTest();

			const program = Effect.gen(function* () {
				const client = yield* GitHubClient;
				return yield* client.getCodeScanningDefaultSetup("o", "r");
			}).pipe(Effect.provide(recorder.layer));

			const result = await Effect.runPromise(program);
			expect(result).toEqual({});
		});

		it("listRepoLanguages returns empty array", async () => {
			const recorder = GitHubClientTest();

			const program = Effect.gen(function* () {
				const client = yield* GitHubClient;
				return yield* client.listRepoLanguages("o", "r");
			}).pipe(Effect.provide(recorder.layer));

			const result = await Effect.runPromise(program);
			expect(result).toEqual([]);
		});

		it("records resolveTeamId calls and returns 0", async () => {
			const recorder = GitHubClientTest();

			const program = Effect.gen(function* () {
				const client = yield* GitHubClient;
				return yield* client.resolveTeamId("my-org", "security-team");
			}).pipe(Effect.provide(recorder.layer));

			const result = await Effect.runPromise(program);
			expect(result).toBe(0);
			expect(recorder.calls()).toContainEqual({
				method: "resolveTeamId",
				args: { org: "my-org", slug: "security-team" },
			});
		});
	});
});
