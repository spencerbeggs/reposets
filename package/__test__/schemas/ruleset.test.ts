import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { RulesetSchema } from "../../src/schemas/ruleset.js";

const decode = Schema.decodeUnknownSync(RulesetSchema);

describe("RulesetSchema", () => {
	it("accepts a minimal ruleset", () => {
		const result = decode({
			name: "test",
			enforcement: "active",
		});
		expect(result.name).toBe("test");
		expect(result.enforcement).toBe("active");
		expect(result.target).toBe("branch");
	});

	it("accepts a ruleset with target", () => {
		const result = decode({
			name: "tags",
			enforcement: "active",
			target: "tag",
		});
		expect(result.target).toBe("tag");
	});

	it("rejects invalid enforcement", () => {
		expect(() => decode({ name: "test", enforcement: "invalid" })).toThrow();
	});

	it("accepts conditions with ref_name", () => {
		const result = decode({
			name: "test",
			enforcement: "active",
			conditions: {
				ref_name: {
					include: ["~DEFAULT_BRANCH"],
					exclude: [],
				},
			},
		});
		expect(result.conditions?.ref_name?.include).toEqual(["~DEFAULT_BRANCH"]);
	});

	it("accepts bypass_actors", () => {
		const result = decode({
			name: "test",
			enforcement: "active",
			bypass_actors: [
				{ actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" },
				{ actor_type: "DeployKey" },
			],
		});
		expect(result.bypass_actors).toHaveLength(2);
		expect(result.bypass_actors?.[1].actor_type).toBe("DeployKey");
	});

	it("accepts parameterless rules", () => {
		const result = decode({
			name: "test",
			enforcement: "active",
			rules: [
				{ type: "creation" },
				{ type: "deletion" },
				{ type: "non_fast_forward" },
				{ type: "required_linear_history" },
				{ type: "required_signatures" },
			],
		});
		expect(result.rules).toHaveLength(5);
	});

	it("accepts pull_request rule", () => {
		const result = decode({
			name: "test",
			enforcement: "active",
			rules: [
				{
					type: "pull_request",
					parameters: {
						required_approving_review_count: 1,
						dismiss_stale_reviews_on_push: false,
						require_code_owner_review: false,
						require_last_push_approval: false,
						required_review_thread_resolution: false,
					},
				},
			],
		});
		expect(result.rules?.[0].type).toBe("pull_request");
	});

	it("accepts required_status_checks rule", () => {
		const result = decode({
			name: "test",
			enforcement: "active",
			rules: [
				{
					type: "required_status_checks",
					parameters: {
						strict_required_status_checks_policy: true,
						required_status_checks: [{ context: "CI", integration_id: 123 }],
					},
				},
			],
		});
		expect(result.rules?.[0].type).toBe("required_status_checks");
	});

	it("accepts pattern rules", () => {
		const result = decode({
			name: "test",
			enforcement: "active",
			rules: [
				{
					type: "commit_message_pattern",
					parameters: { operator: "regex", pattern: "^feat:" },
				},
				{
					type: "branch_name_pattern",
					parameters: { operator: "starts_with", pattern: "feat/" },
				},
			],
		});
		expect(result.rules).toHaveLength(2);
	});

	it("accepts a full workflow ruleset matching the existing JSON", () => {
		const result = decode({
			name: "workflow",
			target: "branch",
			enforcement: "active",
			conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
			rules: [
				{ type: "deletion" },
				{ type: "non_fast_forward" },
				{ type: "required_linear_history" },
				{ type: "required_signatures" },
				{
					type: "pull_request",
					parameters: {
						required_approving_review_count: 0,
						dismiss_stale_reviews_on_push: false,
						require_code_owner_review: false,
						require_last_push_approval: false,
						required_review_thread_resolution: false,
						allowed_merge_methods: ["squash"],
					},
				},
				{
					type: "required_status_checks",
					parameters: {
						strict_required_status_checks_policy: true,
						do_not_enforce_on_create: true,
						required_status_checks: [
							{ context: "Code Quality", integration_id: 2527309 },
							{ context: "Claude Code Review", integration_id: 2527309 },
						],
					},
				},
			],
			bypass_actors: [{ actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" }],
		});
		expect(result.name).toBe("workflow");
		expect(result.rules).toHaveLength(6);
	});

	it("rejects unknown rule types", () => {
		expect(() =>
			decode({
				name: "test",
				enforcement: "active",
				rules: [{ type: "not_a_real_rule" }],
			}),
		).toThrow();
	});

	it("accepts resolved reference for actor_id", () => {
		const result = decode({
			name: "test",
			enforcement: "active",
			bypass_actors: [{ actor_id: { resolved: "SILK_APP_ID" }, actor_type: "Integration" }],
		});
		expect(result.bypass_actors?.[0].actor_id).toEqual({ resolved: "SILK_APP_ID" });
	});

	it("accepts resolved reference for integration_id in status checks", () => {
		const result = decode({
			name: "test",
			enforcement: "active",
			rules: [
				{
					type: "required_status_checks",
					parameters: {
						strict_required_status_checks_policy: true,
						required_status_checks: [{ context: "CI", integration_id: { resolved: "SILK_APP_ID" } }],
					},
				},
			],
		});
		const rule = result.rules?.[0];
		expect(rule?.type).toBe("required_status_checks");
	});

	it("accepts resolved reference for repository_id in workflows", () => {
		const result = decode({
			name: "test",
			enforcement: "active",
			rules: [
				{
					type: "workflows",
					parameters: {
						workflows: [{ path: ".github/workflows/ci.yml", repository_id: { resolved: "REPO_ID" } }],
					},
				},
			],
		});
		expect(result.rules?.[0].type).toBe("workflows");
	});

	it("still accepts static integer for actor_id", () => {
		const result = decode({
			name: "test",
			enforcement: "active",
			bypass_actors: [{ actor_id: 5, actor_type: "RepositoryRole" }],
		});
		expect(result.bypass_actors?.[0].actor_id).toBe(5);
	});
});
