import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { RulesetSchema, buildRulesetPayload } from "../../src/schemas/ruleset.js";

const decode = Schema.decodeUnknownSync(RulesetSchema);

describe("RulesetSchema", () => {
	it("accepts a minimal branch ruleset", () => {
		const result = decode({
			name: "test",
			type: "branch",
			enforcement: "active",
		});
		expect(result.name).toBe("test");
		expect(result.enforcement).toBe("active");
		expect(result.type).toBe("branch");
	});

	it("accepts a minimal tag ruleset", () => {
		const result = decode({
			name: "tags",
			type: "tag",
			enforcement: "active",
		});
		expect(result.type).toBe("tag");
	});

	it("rejects invalid enforcement", () => {
		expect(() => decode({ name: "test", type: "branch", enforcement: "invalid" })).toThrow();
	});

	it("rejects missing type field", () => {
		expect(() => decode({ name: "test", enforcement: "active" })).toThrow();
	});

	it("accepts conditions with ref_name", () => {
		const result = decode({
			name: "test",
			type: "branch",
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
			type: "branch",
			enforcement: "active",
			bypass_actors: [
				{ actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" },
				{ actor_type: "DeployKey" },
			],
		});
		expect(result.bypass_actors).toHaveLength(2);
		expect(result.bypass_actors?.[1].actor_type).toBe("DeployKey");
	});

	it("accepts resolved reference for actor_id", () => {
		const result = decode({
			name: "test",
			type: "branch",
			enforcement: "active",
			bypass_actors: [{ actor_id: { resolved: "SILK_APP_ID" }, actor_type: "Integration" }],
		});
		expect(result.bypass_actors?.[0].actor_id).toEqual({ resolved: "SILK_APP_ID" });
	});

	it("still accepts static integer for actor_id", () => {
		const result = decode({
			name: "test",
			type: "branch",
			enforcement: "active",
			bypass_actors: [{ actor_id: 5, actor_type: "RepositoryRole" }],
		});
		expect(result.bypass_actors?.[0].actor_id).toBe(5);
	});

	// --- Boolean shorthands ---

	it("accepts boolean shorthand fields", () => {
		const result = decode({
			name: "test",
			type: "branch",
			enforcement: "active",
			creation: true,
			update: true,
			deletion: true,
			required_linear_history: true,
			required_signatures: true,
			non_fast_forward: true,
		});
		expect(result.creation).toBe(true);
		expect(result.update).toBe(true);
		expect(result.deletion).toBe(true);
		expect(result.required_linear_history).toBe(true);
		expect(result.required_signatures).toBe(true);
		expect(result.non_fast_forward).toBe(true);
	});

	it("accepts deployments shorthand", () => {
		const result = decode({
			name: "test",
			type: "branch",
			enforcement: "active",
			deployments: ["staging", "production"],
		});
		expect(result.deployments).toEqual(["staging", "production"]);
	});

	// --- Targets shorthand ---

	it("accepts targets 'default' preset", () => {
		const result = decode({
			name: "test",
			type: "branch",
			enforcement: "active",
			targets: "default",
		});
		expect(result.targets).toBe("default");
	});

	it("accepts targets 'all' preset", () => {
		const result = decode({
			name: "test",
			type: "tag",
			enforcement: "active",
			targets: "all",
		});
		expect(result.targets).toBe("all");
	});

	it("accepts targets as array of include/exclude patterns", () => {
		const result = decode({
			name: "test",
			type: "branch",
			enforcement: "active",
			targets: [{ include: "main" }, { include: "release/*" }, { exclude: "experimental/*" }],
		});
		expect(Array.isArray(result.targets)).toBe(true);
		if (Array.isArray(result.targets)) {
			expect(result.targets).toHaveLength(3);
		}
	});

	// --- Pull requests shorthand ---

	it("accepts pull_requests shorthand on branch ruleset", () => {
		const result = decode({
			name: "test",
			type: "branch",
			enforcement: "active",
			pull_requests: {
				approvals: 2,
				dismiss_stale_reviews: true,
				code_owner_review: true,
				last_push_approval: true,
				resolve_threads: true,
				merge_methods: ["squash", "rebase"],
			},
		});
		if (result.type === "branch") {
			expect(result.pull_requests?.approvals).toBe(2);
			expect(result.pull_requests?.dismiss_stale_reviews).toBe(true);
			expect(result.pull_requests?.code_owner_review).toBe(true);
			expect(result.pull_requests?.merge_methods).toEqual(["squash", "rebase"]);
		}
	});

	it("pull_requests defaults are applied", () => {
		const result = decode({
			name: "test",
			type: "branch",
			enforcement: "active",
			pull_requests: {},
		});
		if (result.type === "branch") {
			expect(result.pull_requests?.approvals).toBe(0);
			expect(result.pull_requests?.dismiss_stale_reviews).toBe(false);
			expect(result.pull_requests?.code_owner_review).toBe(false);
			expect(result.pull_requests?.last_push_approval).toBe(false);
			expect(result.pull_requests?.resolve_threads).toBe(false);
		}
	});

	// --- Status checks shorthand ---

	it("accepts status_checks shorthand", () => {
		const result = decode({
			name: "test",
			type: "branch",
			enforcement: "active",
			status_checks: {
				update_branch: true,
				on_creation: false,
				default_integration_id: 123,
				required: [{ context: "CI" }, { context: "Lint" }],
			},
		});
		expect(result.status_checks?.update_branch).toBe(true);
		expect(result.status_checks?.on_creation).toBe(false);
		expect(result.status_checks?.required).toHaveLength(2);
	});

	// --- New shorthands ---

	it("accepts merge_queue on branch ruleset", () => {
		const result = decode({
			name: "test",
			type: "branch",
			enforcement: "active",
			merge_queue: {
				check_timeout: 30,
				grouping: "ALLGREEN",
				max_build: 5,
				max_merge: 5,
				merge_method: "SQUASH",
				min_merge: 1,
				min_wait: 5,
			},
		});
		if (result.type === "branch") {
			expect(result.merge_queue?.check_timeout).toBe(30);
			expect(result.merge_queue?.grouping).toBe("ALLGREEN");
			expect(result.merge_queue?.merge_method).toBe("SQUASH");
		}
	});

	it("accepts copilot_review on branch ruleset", () => {
		const result = decode({
			name: "test",
			type: "branch",
			enforcement: "active",
			copilot_review: {
				draft_prs: true,
				on_push: false,
			},
		});
		if (result.type === "branch") {
			expect(result.copilot_review?.draft_prs).toBe(true);
			expect(result.copilot_review?.on_push).toBe(false);
		}
	});

	it("accepts code_scanning on branch ruleset", () => {
		const result = decode({
			name: "test",
			type: "branch",
			enforcement: "active",
			code_scanning: [
				{ tool: "CodeQL", alerts: "errors", security_alerts: "high_or_higher" },
				{ tool: "Semgrep", alerts: "all", security_alerts: "all" },
			],
		});
		if (result.type === "branch") {
			expect(result.code_scanning).toHaveLength(2);
			expect(result.code_scanning?.[0].tool).toBe("CodeQL");
		}
	});

	it("accepts workflows on branch ruleset", () => {
		const result = decode({
			name: "test",
			type: "branch",
			enforcement: "active",
			workflows: {
				on_creation: false,
				required: [{ path: ".github/workflows/ci.yml", repository_id: 123 }],
			},
		});
		if (result.type === "branch") {
			expect(result.workflows?.on_creation).toBe(false);
			expect(result.workflows?.required).toHaveLength(1);
		}
	});

	it("accepts commit_message patterns", () => {
		const result = decode({
			name: "test",
			type: "branch",
			enforcement: "active",
			commit_message: [{ operator: "regex", pattern: "^feat:" }],
		});
		expect(result.commit_message).toHaveLength(1);
		expect(result.commit_message?.[0].operator).toBe("regex");
	});

	it("accepts commit_author_email patterns", () => {
		const result = decode({
			name: "test",
			type: "branch",
			enforcement: "active",
			commit_author_email: [{ operator: "ends_with", pattern: "@company.com" }],
		});
		expect(result.commit_author_email).toHaveLength(1);
	});

	it("accepts committer_email patterns", () => {
		const result = decode({
			name: "test",
			type: "branch",
			enforcement: "active",
			committer_email: [{ operator: "contains", pattern: "bot" }],
		});
		expect(result.committer_email).toHaveLength(1);
	});

	it("accepts branch_name patterns on branch ruleset", () => {
		const result = decode({
			name: "test",
			type: "branch",
			enforcement: "active",
			branch_name: [{ operator: "starts_with", pattern: "feat/" }],
		});
		if (result.type === "branch") {
			expect(result.branch_name).toHaveLength(1);
			expect(result.branch_name?.[0].pattern).toBe("feat/");
		}
	});

	it("accepts tag_name patterns on tag ruleset", () => {
		const result = decode({
			name: "test",
			type: "tag",
			enforcement: "active",
			tag_name: [{ operator: "starts_with", pattern: "v" }],
		});
		if (result.type === "tag") {
			expect(result.tag_name).toHaveLength(1);
			expect(result.tag_name?.[0].pattern).toBe("v");
		}
	});

	// --- Discriminated union ---

	it("strips pull_requests from tag ruleset (field not in TagRulesetSchema)", () => {
		const result = decode({
			name: "test",
			type: "tag",
			enforcement: "active",
			pull_requests: { approvals: 1 },
		});
		expect(result.type).toBe("tag");
		expect("pull_requests" in result).toBe(false);
	});

	it("strips merge_queue from tag rulesets", () => {
		const result = decode({
			name: "test",
			type: "tag",
			enforcement: "active",
			merge_queue: {
				check_timeout: 30,
				grouping: "ALLGREEN",
				max_build: 5,
				max_merge: 5,
				merge_method: "SQUASH",
				min_merge: 1,
				min_wait: 5,
			},
		});
		expect(result.type).toBe("tag");
		expect("merge_queue" in result).toBe(false);
	});

	it("accepts resolved reference for repository_id in workflows", () => {
		const result = decode({
			name: "test",
			type: "branch",
			enforcement: "active",
			workflows: {
				required: [{ path: ".github/workflows/ci.yml", repository_id: { resolved: "REPO_ID" } }],
			},
		});
		if (result.type === "branch") {
			expect(result.workflows?.required[0].repository_id).toEqual({ resolved: "REPO_ID" });
		}
	});

	it("accepts resolved reference for integration_id in status checks", () => {
		const result = decode({
			name: "test",
			type: "branch",
			enforcement: "active",
			status_checks: {
				required: [{ context: "CI", integration_id: { resolved: "SILK_APP_ID" } }],
			},
		});
		expect(result.status_checks?.required[0].integration_id).toEqual({ resolved: "SILK_APP_ID" });
	});
});

describe("buildRulesetPayload", () => {
	it("converts boolean shorthands to rules", () => {
		const input = decode({
			name: "test",
			type: "branch",
			enforcement: "active",
			creation: true,
			deletion: true,
			non_fast_forward: true,
		});
		const result = buildRulesetPayload(input);
		const ruleTypes = (result.rules ?? []).map((r) => r.type);
		expect(ruleTypes).toContain("creation");
		expect(ruleTypes).toContain("deletion");
		expect(ruleTypes).toContain("non_fast_forward");
	});

	it("converts update=true to update rule with parameters", () => {
		const input = decode({
			name: "test",
			type: "branch",
			enforcement: "active",
			update: true,
		});
		const result = buildRulesetPayload(input);
		const updateRule = (result.rules ?? []).find((r) => r.type === "update") as
			| { type: "update"; parameters: { update_allows_fetch_and_merge: boolean } }
			| undefined;
		expect(updateRule).toBeDefined();
		expect(updateRule?.parameters.update_allows_fetch_and_merge).toBe(true);
	});

	it("converts deployments to required_deployments rule", () => {
		const input = decode({
			name: "test",
			type: "branch",
			enforcement: "active",
			deployments: ["staging", "production"],
		});
		const result = buildRulesetPayload(input);
		const deployRule = (result.rules ?? []).find((r) => r.type === "required_deployments") as
			| { type: "required_deployments"; parameters: { required_deployment_environments: string[] } }
			| undefined;
		expect(deployRule).toBeDefined();
		expect(deployRule?.parameters.required_deployment_environments).toEqual(["staging", "production"]);
	});

	it("converts pull_requests shorthand to pull_request rule", () => {
		const input = decode({
			name: "test",
			type: "branch",
			enforcement: "active",
			pull_requests: {
				approvals: 2,
				dismiss_stale_reviews: true,
				code_owner_review: true,
				last_push_approval: false,
				resolve_threads: true,
				merge_methods: ["squash"],
			},
		});
		const result = buildRulesetPayload(input);
		const prRule = (result.rules ?? []).find((r) => r.type === "pull_request") as
			| {
					type: "pull_request";
					parameters: {
						required_approving_review_count: number;
						dismiss_stale_reviews_on_push: boolean;
						require_code_owner_review: boolean;
						require_last_push_approval: boolean;
						required_review_thread_resolution: boolean;
						allowed_merge_methods?: string[];
					};
			  }
			| undefined;
		expect(prRule).toBeDefined();
		expect(prRule?.parameters.required_approving_review_count).toBe(2);
		expect(prRule?.parameters.dismiss_stale_reviews_on_push).toBe(true);
		expect(prRule?.parameters.require_code_owner_review).toBe(true);
		expect(prRule?.parameters.require_last_push_approval).toBe(false);
		expect(prRule?.parameters.required_review_thread_resolution).toBe(true);
		expect(prRule?.parameters.allowed_merge_methods).toEqual(["squash"]);
	});

	it("converts status_checks with default_integration_id", () => {
		const input = decode({
			name: "test",
			type: "branch",
			enforcement: "active",
			status_checks: {
				update_branch: true,
				on_creation: false,
				default_integration_id: 42,
				required: [{ context: "CI" }, { context: "Lint", integration_id: 99 }],
			},
		});
		const result = buildRulesetPayload(input);
		const scRule = (result.rules ?? []).find((r) => r.type === "required_status_checks") as
			| {
					type: "required_status_checks";
					parameters: {
						strict_required_status_checks_policy: boolean;
						do_not_enforce_on_create?: boolean;
						required_status_checks: Array<{ context: string; integration_id?: unknown }>;
					};
			  }
			| undefined;
		expect(scRule).toBeDefined();
		expect(scRule?.parameters.strict_required_status_checks_policy).toBe(true);
		expect(scRule?.parameters.do_not_enforce_on_create).toBe(true);
		const checks = scRule?.parameters.required_status_checks;
		expect(checks?.[0].integration_id).toBe(42);
		expect(checks?.[1].integration_id).toBe(99);
	});

	it("converts merge_queue to merge_queue rule", () => {
		const input = decode({
			name: "test",
			type: "branch",
			enforcement: "active",
			merge_queue: {
				check_timeout: 30,
				grouping: "ALLGREEN",
				max_build: 5,
				max_merge: 10,
				merge_method: "SQUASH",
				min_merge: 2,
				min_wait: 15,
			},
		});
		const result = buildRulesetPayload(input);
		const mqRule = (result.rules ?? []).find((r) => r.type === "merge_queue") as
			| {
					type: "merge_queue";
					parameters: {
						check_response_timeout_minutes: number;
						grouping_strategy: string;
						max_entries_to_build: number;
						max_entries_to_merge: number;
						merge_method: string;
						min_entries_to_merge: number;
						min_entries_to_merge_wait_minutes: number;
					};
			  }
			| undefined;
		expect(mqRule).toBeDefined();
		expect(mqRule?.parameters.check_response_timeout_minutes).toBe(30);
		expect(mqRule?.parameters.grouping_strategy).toBe("ALLGREEN");
		expect(mqRule?.parameters.max_entries_to_build).toBe(5);
		expect(mqRule?.parameters.max_entries_to_merge).toBe(10);
		expect(mqRule?.parameters.merge_method).toBe("SQUASH");
		expect(mqRule?.parameters.min_entries_to_merge).toBe(2);
		expect(mqRule?.parameters.min_entries_to_merge_wait_minutes).toBe(15);
	});

	it("converts copilot_review to copilot_code_review rule", () => {
		const input = decode({
			name: "test",
			type: "branch",
			enforcement: "active",
			copilot_review: {
				draft_prs: true,
				on_push: false,
			},
		});
		const result = buildRulesetPayload(input);
		const crRule = (result.rules ?? []).find((r) => r.type === "copilot_code_review") as
			| {
					type: "copilot_code_review";
					parameters: { review_draft_pull_requests?: boolean; review_on_push?: boolean };
			  }
			| undefined;
		expect(crRule).toBeDefined();
		expect(crRule?.parameters.review_draft_pull_requests).toBe(true);
		expect(crRule?.parameters.review_on_push).toBe(false);
	});

	it("converts code_scanning to code_scanning rule", () => {
		const input = decode({
			name: "test",
			type: "branch",
			enforcement: "active",
			code_scanning: [{ tool: "CodeQL", alerts: "errors", security_alerts: "high_or_higher" }],
		});
		const result = buildRulesetPayload(input);
		const csRule = (result.rules ?? []).find((r) => r.type === "code_scanning") as
			| {
					type: "code_scanning";
					parameters: {
						code_scanning_tools: Array<{
							tool: string;
							alerts_threshold: string;
							security_alerts_threshold: string;
						}>;
					};
			  }
			| undefined;
		expect(csRule).toBeDefined();
		expect(csRule?.parameters.code_scanning_tools).toHaveLength(1);
		expect(csRule?.parameters.code_scanning_tools[0].tool).toBe("CodeQL");
		expect(csRule?.parameters.code_scanning_tools[0].alerts_threshold).toBe("errors");
		expect(csRule?.parameters.code_scanning_tools[0].security_alerts_threshold).toBe("high_or_higher");
	});

	it("converts workflows to workflows rule", () => {
		const input = decode({
			name: "test",
			type: "branch",
			enforcement: "active",
			workflows: {
				on_creation: false,
				required: [{ path: ".github/workflows/ci.yml", repository_id: 456 }],
			},
		});
		const result = buildRulesetPayload(input);
		const wfRule = (result.rules ?? []).find((r) => r.type === "workflows") as
			| {
					type: "workflows";
					parameters: {
						do_not_enforce_on_create?: boolean;
						workflows: Array<{ path: string; repository_id: number }>;
					};
			  }
			| undefined;
		expect(wfRule).toBeDefined();
		expect(wfRule?.parameters.do_not_enforce_on_create).toBe(true);
		expect(wfRule?.parameters.workflows).toHaveLength(1);
		expect(wfRule?.parameters.workflows[0].path).toBe(".github/workflows/ci.yml");
	});

	it("converts pattern shorthands to pattern rules", () => {
		const input = decode({
			name: "test",
			type: "branch",
			enforcement: "active",
			commit_message: [
				{ operator: "regex", pattern: "^feat:" },
				{ operator: "starts_with", pattern: "fix:", negate: true },
			],
			commit_author_email: [{ operator: "ends_with", pattern: "@company.com" }],
			committer_email: [{ operator: "contains", pattern: "bot" }],
			branch_name: [{ operator: "starts_with", pattern: "feat/", name: "Feature branches" }],
		});
		const result = buildRulesetPayload(input);
		const ruleTypes = (result.rules ?? []).map((r) => r.type);
		expect(ruleTypes.filter((t) => t === "commit_message_pattern")).toHaveLength(2);
		expect(ruleTypes.filter((t) => t === "commit_author_email_pattern")).toHaveLength(1);
		expect(ruleTypes.filter((t) => t === "committer_email_pattern")).toHaveLength(1);
		expect(ruleTypes.filter((t) => t === "branch_name_pattern")).toHaveLength(1);
	});

	it("converts tag_name patterns on tag ruleset", () => {
		const input = decode({
			name: "test",
			type: "tag",
			enforcement: "active",
			tag_name: [{ operator: "starts_with", pattern: "v" }],
		});
		const result = buildRulesetPayload(input);
		const ruleTypes = (result.rules ?? []).map((r) => r.type);
		expect(ruleTypes).toContain("tag_name_pattern");
	});

	it("converts targets 'default' to conditions", () => {
		const input = decode({
			name: "test",
			type: "branch",
			enforcement: "active",
			targets: "default",
		});
		const result = buildRulesetPayload(input);
		expect(result.conditions).toEqual({ ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } });
	});

	it("converts targets 'all' to conditions", () => {
		const input = decode({
			name: "test",
			type: "tag",
			enforcement: "active",
			targets: "all",
		});
		const result = buildRulesetPayload(input);
		expect(result.conditions).toEqual({ ref_name: { include: ["~ALL"], exclude: [] } });
	});

	it("converts targets array to conditions", () => {
		const input = decode({
			name: "test",
			type: "branch",
			enforcement: "active",
			targets: [{ include: "main" }, { include: "release/*" }, { exclude: "experimental/*" }],
		});
		const result = buildRulesetPayload(input);
		expect(result.conditions).toEqual({
			ref_name: { include: ["main", "release/*"], exclude: ["experimental/*"] },
		});
	});

	it("maps type to target in output", () => {
		const branchInput = decode({
			name: "test",
			type: "branch",
			enforcement: "active",
		});
		const tagInput = decode({
			name: "test",
			type: "tag",
			enforcement: "evaluate",
		});
		expect(buildRulesetPayload(branchInput).target).toBe("branch");
		expect(buildRulesetPayload(tagInput).target).toBe("tag");
	});

	it("produces no rules property when nothing is set", () => {
		const input = decode({
			name: "test",
			type: "branch",
			enforcement: "active",
		});
		const result = buildRulesetPayload(input);
		expect(result.rules).toBeUndefined();
	});

	it("targets overrides conditions when both are set", () => {
		const input = decode({
			name: "test",
			type: "branch",
			enforcement: "active",
			targets: "default",
			conditions: { ref_name: { include: ["main"], exclude: ["release/*"] } },
		});
		const result = buildRulesetPayload(input);
		expect(result.conditions).toEqual({ ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } });
	});
});
