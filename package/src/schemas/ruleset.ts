import { Effect, Schema } from "effect";
import { docs, taplo, tombi } from "./annotations.js";

/**
 * A reference to a named value in the active credential profile.
 *
 * @public
 */
export const ResolvedRefSchema = Schema.Struct({
	resolved: Schema.String.annotate({
		title: "Credential label",
		description: "Reference to a named value in the active credential profile's resolve section",
	}),
}).annotate({
	identifier: "ResolvedRef",
	title: "Resolved reference",
	description: "A reference to a credential-resolved value",
});

/**
 * The decoded shape of {@link ResolvedRefSchema}.
 *
 * @public
 */
export type ResolvedRef = typeof ResolvedRefSchema.Type;

// --- Bypass Actors ---

const ActorTypeSchema = Schema.Literals([
	"Integration",
	"OrganizationAdmin",
	"RepositoryRole",
	"Team",
	"DeployKey",
]).annotate({
	title: "Actor type",
	description: "The type of actor that can bypass a ruleset",
});

const BypassModeSchema = Schema.Literals(["always", "pull_request", "exempt"]).annotate({
	title: "Bypass mode",
	description: "When the specified actor can bypass the ruleset",
});

/**
 * An actor permitted to bypass a ruleset's rules.
 *
 * @public
 */
export const BypassActorSchema = Schema.Struct({
	actor_id: Schema.optional(
		Schema.Union([Schema.Int, ResolvedRefSchema]).annotate({
			title: "Actor ID",
			description: "The ID of the actor, or a { resolved } reference to a credential label.",
		}),
	),
	actor_type: ActorTypeSchema,
	bypass_mode: BypassModeSchema.pipe(Schema.withDecodingDefaultKey(Effect.succeed("always" as const))),
}).annotate({
	identifier: "BypassActor",
	title: "Bypass actor",
	description: "An actor that can bypass rules in a ruleset",
});

/**
 * The decoded shape of {@link BypassActorSchema}.
 *
 * @public
 */
export type BypassActor = typeof BypassActorSchema.Type;

// --- Conditions ---

/**
 * Include and exclude patterns for matching ref names.
 *
 * @public
 */
export const RefNameConditionSchema = Schema.Struct({
	include: Schema.Array(Schema.String)
		.annotate({
			title: "Include patterns",
			description: "Ref name patterns to include. Accepts ~DEFAULT_BRANCH, ~ALL, or glob patterns.",
			examples: [["~DEFAULT_BRANCH"]],
		})
		.pipe(Schema.withDecodingDefaultKey(Effect.succeed<ReadonlyArray<string>>([]))),
	exclude: Schema.Array(Schema.String)
		.annotate({
			title: "Exclude patterns",
			description: "Ref name patterns to exclude",
		})
		.pipe(Schema.withDecodingDefaultKey(Effect.succeed<ReadonlyArray<string>>([]))),
}).annotate({
	identifier: "RefNameCondition",
	title: "Ref name condition",
	description: "Conditions for matching ref names (branches or tags)",
});

/**
 * The conditions under which a ruleset applies.
 *
 * @public
 */
export const RulesetConditionsSchema = Schema.Struct({
	ref_name: Schema.optional(RefNameConditionSchema),
}).annotate({
	identifier: "RulesetConditions",
	title: "Ruleset conditions",
	description: "Conditions that determine when the ruleset applies",
});

// --- Shared Sub-Schemas ---

const RequiredReviewerSchema = Schema.Struct({
	file_patterns: Schema.Array(Schema.String).annotate({
		title: "File patterns",
		description: "File patterns this reviewer must approve (fnmatch syntax)",
	}),
	minimum_approvals: Schema.Int.annotate({
		title: "Minimum approvals",
		description: "Minimum approvals required from this team (0 = optional)",
	}),
	reviewer: Schema.Struct({
		id: Schema.Int.annotate({ title: "Team ID", description: "Team ID" }),
		type: Schema.Literal("Team"),
	}).annotate({ title: "Reviewer team" }),
});

const StatusCheckSchema = Schema.Struct({
	context: Schema.String.annotate({
		title: "Context",
		description: "The status check context name that must be present on the commit",
	}),
	integration_id: Schema.optional(
		Schema.Union([Schema.Int, ResolvedRefSchema]).annotate({
			title: "Integration ID",
			description: "The integration ID, or a { resolved } reference to a credential label",
		}),
	),
});

const WorkflowFileSchema = Schema.Struct({
	path: Schema.String.annotate({ title: "Workflow path", description: "Path to the workflow file" }),
	ref: Schema.optional(Schema.String.annotate({ title: "Ref", description: "Branch or tag of the workflow file" })),
	repository_id: Schema.Union([Schema.Int, ResolvedRefSchema]).annotate({
		title: "Repository ID",
		description: "Repository ID, or a { resolved } reference to a credential label",
	}),
	sha: Schema.optional(Schema.String.annotate({ title: "SHA", description: "Commit SHA of the workflow file" })),
});

// --- Targets Shorthand ---

const TargetPatternSchema = Schema.Union([
	Schema.Struct({
		include: Schema.String.annotate({ title: "Include pattern", description: "Glob pattern to include" }),
	}),
	Schema.Struct({
		exclude: Schema.String.annotate({ title: "Exclude pattern", description: "Glob pattern to exclude" }),
	}),
]).annotate({
	identifier: "TargetPattern",
	title: "Target pattern",
	description: "An include or exclude pattern for ref matching",
});

const TargetsSchema = Schema.Union([
	Schema.Literals(["default", "all"]).annotate({
		title: "Target preset",
		description: "'default' targets the default branch; 'all' targets all branches/tags",
	}),
	Schema.Array(TargetPatternSchema).annotate({
		title: "Custom target patterns",
		description: "Array of include/exclude patterns for fine-grained ref targeting",
	}),
]).annotate({
	identifier: "Targets",
	title: "Targets shorthand",
	description: "Shorthand for specifying ref_name conditions: 'default', 'all', or custom patterns",
});

// --- Pull Requests Shorthand ---

const PullRequestsShorthandSchema = Schema.Struct({
	approvals: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10 }))
		.annotate({
			title: "Required approvals",
			description: "Number of approving reviews required (0-10)",
		})
		.pipe(Schema.withDecodingDefaultKey(Effect.succeed(0))),
	dismiss_stale_reviews: Schema.Boolean.annotate({
		title: "Dismiss stale reviews",
		description: "Dismiss previous approvals when new commits are pushed",
	}).pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
	code_owner_review: Schema.Boolean.annotate({
		title: "Code owner review",
		description: "Require review from code owners for files they own",
	}).pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
	last_push_approval: Schema.Boolean.annotate({
		title: "Last push approval",
		description: "Most recent push must be approved by someone other than the pusher",
	}).pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
	resolve_threads: Schema.Boolean.annotate({
		title: "Resolve threads",
		description: "All review conversations must be resolved before merging",
	}).pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
	merge_methods: Schema.optional(
		Schema.Array(Schema.Literals(["merge", "squash", "rebase"])).annotate({
			title: "Merge methods",
			description: "Allowed merge methods. At least one must be enabled.",
		}),
	),
	reviewers: Schema.optional(
		Schema.Array(RequiredReviewerSchema).annotate({
			title: "Required reviewers",
			description: "Teams that must approve specific file patterns",
		}),
	),
}).annotate({
	identifier: "PullRequestsShorthand",
	title: "Pull requests shorthand",
	description: "Simplified pull request configuration (branch rulesets only)",
});

// --- Status Checks Shorthand ---

const StatusChecksShorthandSchema = Schema.Struct({
	update_branch: Schema.optional(
		Schema.Boolean.annotate({
			title: "Strict status checks",
			description: "PRs must be tested with the latest code",
		}),
	),
	on_creation: Schema.optional(
		Schema.Boolean.annotate({
			title: "Enforce on create",
			description: "When false, allows branch creation even if checks would prohibit it",
		}),
	),
	default_integration_id: Schema.optional(
		Schema.Union([Schema.Int, ResolvedRefSchema]).annotate({
			title: "Default integration ID",
			description: "Default integration ID applied to all checks that do not specify one",
		}),
	),
	required: Schema.Array(StatusCheckSchema).annotate({
		title: "Required checks",
		description: "Status checks that must pass",
	}),
}).annotate({
	identifier: "StatusChecksShorthand",
	title: "Status checks shorthand",
	description: "Simplified status checks configuration",
});

// --- Enforcement ---

const EnforcementSchema = Schema.Literals(["disabled", "active", "evaluate"]).annotate({
	title: "Enforcement level",
	description: "disabled = off, active = enforced, evaluate = test mode (GitHub Enterprise only)",
});

// --- Pattern Shorthand ---

const PatternEntrySchema = Schema.Struct({
	operator: Schema.Literals(["starts_with", "ends_with", "contains", "regex"]).annotate({
		title: "Operator",
		description: "The operator to use for matching",
	}),
	pattern: Schema.String.annotate({
		title: "Pattern",
		description: "The pattern to match",
	}),
	name: Schema.optional(
		Schema.String.annotate({
			title: "Rule name",
			description: "Display name for this pattern rule",
		}),
	),
	negate: Schema.optional(
		Schema.Boolean.annotate({
			title: "Negate",
			description: "If true, the rule fails when the pattern matches",
		}),
	),
}).annotate({
	identifier: "PatternEntry",
	title: "Pattern entry",
	description: "A pattern matching rule with operator, pattern, and optional name/negate",
});

// --- Merge Queue Shorthand ---

const MergeQueueShorthandSchema = Schema.Struct({
	check_timeout: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 360 })).annotate({
		title: "Check timeout (minutes)",
		description: "Max time for status checks to report",
	}),
	grouping: Schema.Literals(["ALLGREEN", "HEADGREEN"]).annotate({
		title: "Grouping strategy",
		description: "Whether all commits or only the head commit must pass checks",
	}),
	max_build: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 })).annotate({
		title: "Max entries to build",
		description: "Max queued PRs requesting checks simultaneously",
	}),
	max_merge: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 })).annotate({
		title: "Max entries to merge",
		description: "Max PRs merged together in a group",
	}),
	merge_method: Schema.Literals(["MERGE", "SQUASH", "REBASE"]).annotate({
		title: "Merge method",
		description: "Merge method for queued PRs",
	}),
	min_merge: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 })).annotate({
		title: "Min entries to merge",
		description: "Min PRs merged together in a group",
	}),
	min_wait: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 360 })).annotate({
		title: "Min wait time (minutes)",
		description: "Wait time for min group size after first PR is added",
	}),
}).annotate({
	identifier: "MergeQueueShorthand",
	title: "Merge queue",
	description: "Merge queue configuration",
});

// --- Copilot Review Shorthand ---

const CopilotReviewShorthandSchema = Schema.Struct({
	draft_prs: Schema.optional(
		Schema.Boolean.annotate({
			title: "Review draft PRs",
			description: "Review draft PRs before they are marked ready",
		}),
	),
	on_push: Schema.optional(
		Schema.Boolean.annotate({
			title: "Review on push",
			description: "Review each new push to the PR",
		}),
	),
}).annotate({
	identifier: "CopilotReviewShorthand",
	title: "Copilot review",
	description: "Copilot code review configuration",
});

// --- Code Scanning Shorthand ---

const CodeScanningEntrySchema = Schema.Struct({
	tool: Schema.String.annotate({
		title: "Tool name",
		description: "Name of the code scanning tool",
	}),
	alerts: Schema.Literals(["none", "errors", "errors_and_warnings", "all"]).annotate({
		title: "Alerts threshold",
		description: "Severity level at which alerts block updates",
	}),
	security_alerts: Schema.Literals(["none", "critical", "high_or_higher", "medium_or_higher", "all"]).annotate({
		title: "Security alerts threshold",
		description: "Severity level at which security alerts block updates",
	}),
}).annotate({
	identifier: "CodeScanningEntry",
	title: "Code scanning tool",
	description: "A code scanning tool with alert thresholds",
});

// --- Workflows Shorthand ---

const WorkflowsShorthandSchema = Schema.Struct({
	on_creation: Schema.optional(
		Schema.Boolean.annotate({
			title: "Enforce on creation",
			description: "Enforce workflows when a branch is created (false = skip on creation)",
		}),
	),
	required: Schema.Array(WorkflowFileSchema).annotate({
		title: "Required workflows",
		description: "Workflows that must pass for this rule",
	}),
}).annotate({
	identifier: "WorkflowsShorthand",
	title: "Workflows",
	description: "Required workflow configuration",
});

// --- Shared Ruleset Fields ---

const sharedRulesetFields = {
	name: Schema.String.annotate({
		title: "Ruleset name",
		description: "The name of the ruleset (used for matching when creating or updating)",
	}),
	enforcement: EnforcementSchema,
	conditions: Schema.optional(RulesetConditionsSchema),
	bypass_actors: Schema.optional(Schema.Array(BypassActorSchema)),
	// Boolean shorthands
	creation: Schema.optional(
		Schema.Boolean.annotate({
			title: "Restrict creation",
			description: "When true, adds a creation rule",
		}),
	),
	update: Schema.optional(
		Schema.Boolean.annotate({
			title: "Restrict updates",
			description: "When true, adds an update rule with update_allows_fetch_and_merge: true",
		}),
	),
	deletion: Schema.optional(
		Schema.Boolean.annotate({
			title: "Restrict deletion",
			description: "When true, adds a deletion rule",
		}),
	),
	required_linear_history: Schema.optional(
		Schema.Boolean.annotate({
			title: "Require linear history",
			description: "When true, adds a required_linear_history rule",
		}),
	),
	required_signatures: Schema.optional(
		Schema.Boolean.annotate({
			title: "Require signatures",
			description: "When true, adds a required_signatures rule",
		}),
	),
	non_fast_forward: Schema.optional(
		Schema.Boolean.annotate({
			title: "Prevent non-fast-forward",
			description: "When true, adds a non_fast_forward rule",
		}),
	),
	deployments: Schema.optional(
		Schema.Array(Schema.String).annotate({
			title: "Required deployments",
			description: "Deployment environments that must succeed; converts to required_deployments rule",
		}),
	),
	targets: Schema.optional(TargetsSchema),
	status_checks: Schema.optional(StatusChecksShorthandSchema),
	// Shared pattern rules
	commit_message: Schema.optional(
		Schema.Array(PatternEntrySchema).annotate({
			title: "Commit message patterns",
			description: "Commit message pattern rules",
		}),
	),
	commit_author_email: Schema.optional(
		Schema.Array(PatternEntrySchema).annotate({
			title: "Commit author email patterns",
			description: "Commit author email pattern rules",
		}),
	),
	committer_email: Schema.optional(
		Schema.Array(PatternEntrySchema).annotate({
			title: "Committer email patterns",
			description: "Committer email pattern rules",
		}),
	),
};

// --- Branch Ruleset ---

/**
 * A ruleset targeting branches.
 *
 * @public
 */
export const BranchRulesetSchema = Schema.Struct({
	...sharedRulesetFields,
	type: Schema.Literal("branch").annotate({
		title: "Ruleset type",
		description: "This ruleset applies to branches",
	}),
	pull_requests: Schema.optional(PullRequestsShorthandSchema),
	merge_queue: Schema.optional(MergeQueueShorthandSchema),
	copilot_review: Schema.optional(CopilotReviewShorthandSchema),
	code_scanning: Schema.optional(
		Schema.Array(CodeScanningEntrySchema).annotate({
			title: "Code scanning tools",
			description: "Code scanning tool requirements",
		}),
	),
	workflows: Schema.optional(WorkflowsShorthandSchema),
	branch_name: Schema.optional(
		Schema.Array(PatternEntrySchema).annotate({
			title: "Branch name patterns",
			description: "Branch name pattern rules",
		}),
	),
}).annotate({
	...tombi({ tableKeysOrder: "schema" }),
	...taplo({
		initKeys: ["name", "type", "enforcement", "targets"],
		links: { key: docs("06-rulesets.md") },
	}),
	identifier: "BranchRuleset",
	title: "Branch ruleset",
	description: "A ruleset that applies to branches",
});

// --- Tag Ruleset ---

/**
 * A ruleset targeting tags.
 *
 * @public
 */
export const TagRulesetSchema = Schema.Struct({
	...sharedRulesetFields,
	type: Schema.Literal("tag").annotate({
		title: "Ruleset type",
		description: "This ruleset applies to tags",
	}),
	tag_name: Schema.optional(
		Schema.Array(PatternEntrySchema).annotate({
			title: "Tag name patterns",
			description: "Tag name pattern rules",
		}),
	),
}).annotate({
	...tombi({ tableKeysOrder: "schema" }),
	...taplo({
		initKeys: ["name", "type", "enforcement", "targets"],
		links: { key: docs("06-rulesets.md") },
	}),
	identifier: "TagRuleset",
	title: "Tag ruleset",
	description: "A ruleset that applies to tags",
});

// --- Top-level Ruleset (discriminated union) ---

/**
 * A repository ruleset, discriminated on `type`.
 *
 * @public
 */
export const RulesetSchema = Schema.Union([BranchRulesetSchema, TagRulesetSchema]).annotate({
	...taplo({ links: { key: docs("06-rulesets.md") } }),
	identifier: "Ruleset",
	title: "Repository ruleset",
	description: "A set of rules to apply when specified conditions are met",
});

/**
 * The decoded shape of {@link RulesetSchema}.
 *
 * @public
 */
export type Ruleset = typeof RulesetSchema.Type;

// --- RulesetPayload ---
//
// Push rulesets (target: "push") are intentionally unsupported. They require
// org-owned private repos and support four rules with no branch/tag equivalent:
// file_path_restriction, file_extension_restriction, max_file_path_length, max_file_size.
// These rule types have no shorthand fields and cannot be configured.

/**
 * API-compatible payload for creating or updating a ruleset.
 *
 * @public
 */
export interface RulesetPayload {
	name: string;
	target: "branch" | "tag";
	enforcement: "disabled" | "active" | "evaluate";
	conditions?: Record<string, unknown>;
	bypass_actors?: ReadonlyArray<Record<string, unknown>>;
	rules?: ReadonlyArray<Record<string, unknown>>;
}

/**
 * Build an API-compatible ruleset payload from a config-level {@link Ruleset}.
 *
 * @remarks
 * Converts every shorthand field into the GitHub API's flat `rules` array. The
 * shorthands exist so a TOML config can say `creation = true` instead of
 * spelling out `{ type = "creation" }`; this is where that expansion happens,
 * and it is the only place that knows the mapping.
 *
 * @public
 */
export function buildRulesetPayload(ruleset: Ruleset): RulesetPayload {
	const rules: Record<string, unknown>[] = [];

	// Boolean rules
	if (ruleset.creation === true) rules.push({ type: "creation" });
	if (ruleset.update === true) rules.push({ type: "update", parameters: { update_allows_fetch_and_merge: true } });
	if (ruleset.deletion === true) rules.push({ type: "deletion" });
	if (ruleset.required_linear_history === true) rules.push({ type: "required_linear_history" });
	if (ruleset.required_signatures === true) rules.push({ type: "required_signatures" });
	if (ruleset.non_fast_forward === true) rules.push({ type: "non_fast_forward" });

	// Deployments
	if (ruleset.deployments !== undefined && ruleset.deployments.length > 0) {
		rules.push({
			type: "required_deployments",
			parameters: { required_deployment_environments: ruleset.deployments },
		});
	}

	// Pull requests (branch only)
	if (ruleset.type === "branch" && ruleset.pull_requests !== undefined) {
		const pr = ruleset.pull_requests;
		rules.push({
			type: "pull_request",
			parameters: {
				required_approving_review_count: pr.approvals,
				dismiss_stale_reviews_on_push: pr.dismiss_stale_reviews,
				require_code_owner_review: pr.code_owner_review,
				require_last_push_approval: pr.last_push_approval,
				required_review_thread_resolution: pr.resolve_threads,
				...(pr.merge_methods !== undefined ? { allowed_merge_methods: pr.merge_methods } : {}),
				...(pr.reviewers !== undefined ? { required_reviewers: pr.reviewers } : {}),
			},
		});
	}

	// Status checks
	if (ruleset.status_checks !== undefined) {
		const sc = ruleset.status_checks;
		const checks = sc.required.map((check) => {
			if (check.integration_id === undefined && sc.default_integration_id !== undefined) {
				return { ...check, integration_id: sc.default_integration_id };
			}
			return check;
		});
		rules.push({
			type: "required_status_checks",
			parameters: {
				strict_required_status_checks_policy: sc.update_branch ?? true,
				...(sc.on_creation === false ? { do_not_enforce_on_create: true } : {}),
				required_status_checks: checks,
			},
		});
	}

	// Merge queue (branch only)
	if (ruleset.type === "branch" && ruleset.merge_queue !== undefined) {
		const mq = ruleset.merge_queue;
		rules.push({
			type: "merge_queue",
			parameters: {
				check_response_timeout_minutes: mq.check_timeout,
				grouping_strategy: mq.grouping,
				max_entries_to_build: mq.max_build,
				max_entries_to_merge: mq.max_merge,
				merge_method: mq.merge_method,
				min_entries_to_merge: mq.min_merge,
				min_entries_to_merge_wait_minutes: mq.min_wait,
			},
		});
	}

	// Copilot review (branch only)
	if (ruleset.type === "branch" && ruleset.copilot_review !== undefined) {
		const cr = ruleset.copilot_review;
		rules.push({
			type: "copilot_code_review",
			parameters: {
				...(cr.draft_prs !== undefined ? { review_draft_pull_requests: cr.draft_prs } : {}),
				...(cr.on_push !== undefined ? { review_on_push: cr.on_push } : {}),
			},
		});
	}

	// Code scanning (branch only)
	if (ruleset.type === "branch" && ruleset.code_scanning !== undefined) {
		rules.push({
			type: "code_scanning",
			parameters: {
				code_scanning_tools: ruleset.code_scanning.map((entry) => ({
					tool: entry.tool,
					alerts_threshold: entry.alerts,
					security_alerts_threshold: entry.security_alerts,
				})),
			},
		});
	}

	// Workflows (branch only)
	if (ruleset.type === "branch" && ruleset.workflows !== undefined) {
		const wf = ruleset.workflows;
		rules.push({
			type: "workflows",
			parameters: {
				...(wf.on_creation === false ? { do_not_enforce_on_create: true } : {}),
				workflows: wf.required,
			},
		});
	}

	// Pattern rules (shared)
	for (const [field, ruleType] of [
		["commit_message", "commit_message_pattern"],
		["commit_author_email", "commit_author_email_pattern"],
		["committer_email", "committer_email_pattern"],
	] as const) {
		const patterns = ruleset[field];
		if (patterns !== undefined) {
			for (const entry of patterns) {
				rules.push({ type: ruleType, parameters: entry });
			}
		}
	}

	// Branch-only pattern
	if (ruleset.type === "branch" && ruleset.branch_name !== undefined) {
		for (const entry of ruleset.branch_name) {
			rules.push({ type: "branch_name_pattern", parameters: entry });
		}
	}

	// Tag-only pattern
	if (ruleset.type === "tag" && ruleset.tag_name !== undefined) {
		for (const entry of ruleset.tag_name) {
			rules.push({ type: "tag_name_pattern", parameters: entry });
		}
	}

	// Resolve targets → conditions
	let conditions: Record<string, unknown> | undefined = ruleset.conditions as Record<string, unknown> | undefined;
	if (ruleset.targets !== undefined) {
		if (ruleset.targets === "default") {
			conditions = { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } };
		} else if (ruleset.targets === "all") {
			conditions = { ref_name: { include: ["~ALL"], exclude: [] } };
		} else {
			const include: string[] = [];
			const exclude: string[] = [];
			for (const pattern of ruleset.targets) {
				if ("include" in pattern) include.push(pattern.include);
				else exclude.push(pattern.exclude);
			}
			conditions = { ref_name: { include, exclude } };
		}
	}

	return {
		name: ruleset.name,
		target: ruleset.type,
		enforcement: ruleset.enforcement,
		...(conditions !== undefined ? { conditions } : {}),
		...(ruleset.bypass_actors !== undefined
			? { bypass_actors: ruleset.bypass_actors as ReadonlyArray<Record<string, unknown>> }
			: {}),
		...(rules.length > 0 ? { rules } : {}),
	};
}
