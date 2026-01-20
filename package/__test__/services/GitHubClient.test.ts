import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { GitHubClient, GitHubClientTest } from "../../src/services/GitHubClient.js";

describe("GitHubClient", () => {
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

		it("records syncRuleset calls", async () => {
			const recorder = GitHubClientTest();

			const program = Effect.gen(function* () {
				const client = yield* GitHubClient;
				yield* client.syncRuleset("owner", "repo", "workflow", {
					name: "workflow",
					target: "branch",
					enforcement: "active",
					rules: [],
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
	});
});
