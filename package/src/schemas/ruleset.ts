import { Schema } from "effect";

export const ResolvedRefSchema = Schema.Struct({
	resolved: Schema.String.annotations({
		title: "Credential label",
		description: "Reference to a named value in the active credential profile's resolve section",
	}),
}).annotations({
	identifier: "ResolvedRef",
	title: "Resolved reference",
	description: "A reference to a credential-resolved value",
});

export type ResolvedRef = typeof ResolvedRefSchema.Type;

// --- Bypass Actors ---

const ActorTypeSchema = Schema.Literal(
	"Integration",
	"OrganizationAdmin",
	"RepositoryRole",
	"Team",
	"DeployKey",
).annotations({
	title: "Actor type",
	description: "The type of actor that can bypass a ruleset",
});

const BypassModeSchema = Schema.Literal("always", "pull_request", "exempt").annotations({
	title: "Bypass mode",
	description: "When the specified actor can bypass the ruleset",
});

export const BypassActorSchema = Schema.Struct({
	actor_id: Schema.optional(
		Schema.Union(Schema.Int, ResolvedRefSchema).annotations({
			title: "Actor ID",
			description: "The ID of the actor, or a { resolved } reference to a credential label.",
		}),
	),
	actor_type: ActorTypeSchema,
	bypass_mode: Schema.optionalWith(BypassModeSchema, { default: () => "always" as const }),
}).annotations({
	identifier: "BypassActor",
	title: "Bypass actor",
	description: "An actor that can bypass rules in a ruleset",
});

export type BypassActor = typeof BypassActorSchema.Type;

// --- Conditions ---

export const RefNameConditionSchema = Schema.Struct({
	include: Schema.optionalWith(
		Schema.Array(Schema.String).annotations({
			title: "Include patterns",
			description: "Ref name patterns to include. Accepts ~DEFAULT_BRANCH, ~ALL, or glob patterns.",
			examples: [["~DEFAULT_BRANCH"]],
		}),
		{ default: () => [] },
	),
	exclude: Schema.optionalWith(
		Schema.Array(Schema.String).annotations({
			title: "Exclude patterns",
			description: "Ref name patterns to exclude",
		}),
		{ default: () => [] },
	),
}).annotations({
	identifier: "RefNameCondition",
	title: "Ref name condition",
	description: "Conditions for matching ref names (branches or tags)",
});

export const RulesetConditionsSchema = Schema.Struct({
	ref_name: Schema.optional(RefNameConditionSchema),
}).annotations({
	identifier: "RulesetConditions",
	title: "Ruleset conditions",
	description: "Conditions that determine when the ruleset applies",
});

// --- Parameterless Rules ---

const CreationRule = Schema.Struct({ type: Schema.Literal("creation") });
const DeletionRule = Schema.Struct({ type: Schema.Literal("deletion") });
const NonFastForwardRule = Schema.Struct({ type: Schema.Literal("non_fast_forward") });
const RequiredLinearHistoryRule = Schema.Struct({ type: Schema.Literal("required_linear_history") });
const RequiredSignaturesRule = Schema.Struct({ type: Schema.Literal("required_signatures") });

// --- Pattern Rules (shared parameter shape) ---

const PatternParametersSchema = Schema.Struct({
	name: Schema.optional(Schema.String.annotations({ description: "Display name for this rule" })),
	negate: Schema.optional(
		Schema.Boolean.annotations({ description: "If true, the rule fails when the pattern matches" }),
	),
	operator: Schema.Literal("starts_with", "ends_with", "contains", "regex").annotations({
		description: "The operator to use for matching",
	}),
	pattern: Schema.String.annotations({ description: "The pattern to match" }),
});

function makePatternRule(ruleType: string) {
	return Schema.Struct({
		type: Schema.Literal(ruleType),
		parameters: PatternParametersSchema,
	});
}

const CommitMessagePatternRule = makePatternRule("commit_message_pattern");
const CommitAuthorEmailPatternRule = makePatternRule("commit_author_email_pattern");
const CommitterEmailPatternRule = makePatternRule("committer_email_pattern");
const BranchNamePatternRule = makePatternRule("branch_name_pattern");
const TagNamePatternRule = makePatternRule("tag_name_pattern");

// --- Update Rule ---

const UpdateRule = Schema.Struct({
	type: Schema.Literal("update"),
	parameters: Schema.Struct({
		update_allows_fetch_and_merge: Schema.Boolean.annotations({
			description: "Branch can pull changes from its upstream repository",
		}),
	}),
});

// --- Required Deployments Rule ---

const RequiredDeploymentsRule = Schema.Struct({
	type: Schema.Literal("required_deployments"),
	parameters: Schema.Struct({
		required_deployment_environments: Schema.Array(Schema.String).annotations({
			description: "Environments that must be successfully deployed before merging",
		}),
	}),
});

// --- File Restriction Rules ---

const FilePathRestrictionRule = Schema.Struct({
	type: Schema.Literal("file_path_restriction"),
	parameters: Schema.Struct({
		restricted_file_paths: Schema.Array(Schema.String).annotations({
			description: "File paths restricted from being pushed",
		}),
	}),
});

const FileExtensionRestrictionRule = Schema.Struct({
	type: Schema.Literal("file_extension_restriction"),
	parameters: Schema.Struct({
		restricted_file_extensions: Schema.Array(Schema.String).annotations({
			description: "File extensions restricted from being pushed",
		}),
	}),
});

const MaxFilePathLengthRule = Schema.Struct({
	type: Schema.Literal("max_file_path_length"),
	parameters: Schema.Struct({
		max_file_path_length: Schema.Int.pipe(Schema.between(1, 32767)).annotations({
			description: "Maximum character limit for file paths",
		}),
	}),
});

const MaxFileSizeRule = Schema.Struct({
	type: Schema.Literal("max_file_size"),
	parameters: Schema.Struct({
		max_file_size: Schema.Int.pipe(Schema.between(1, 100)).annotations({
			description: "Maximum file size in megabytes (does not apply to Git LFS)",
		}),
	}),
});

// --- Pull Request Rule ---

const RequiredReviewerSchema = Schema.Struct({
	file_patterns: Schema.Array(Schema.String).annotations({
		description: "File patterns this reviewer must approve (fnmatch syntax)",
	}),
	minimum_approvals: Schema.Int.annotations({
		description: "Minimum approvals required from this team (0 = optional)",
	}),
	reviewer: Schema.Struct({
		id: Schema.Int.annotations({ description: "Team ID" }),
		type: Schema.Literal("Team"),
	}),
});

const PullRequestRule = Schema.Struct({
	type: Schema.Literal("pull_request"),
	parameters: Schema.Struct({
		allowed_merge_methods: Schema.optional(
			Schema.Array(Schema.Literal("merge", "squash", "rebase")).annotations({
				description: "Allowed merge methods. At least one must be enabled.",
			}),
		),
		dismiss_stale_reviews_on_push: Schema.Boolean.annotations({
			description: "Dismiss previous approvals when new commits are pushed",
		}),
		require_code_owner_review: Schema.Boolean.annotations({
			description: "Require review from code owners for files they own",
		}),
		require_last_push_approval: Schema.Boolean.annotations({
			description: "Most recent push must be approved by someone other than the pusher",
		}),
		required_approving_review_count: Schema.Int.pipe(Schema.between(0, 10)).annotations({
			description: "Number of approving reviews required (0-10)",
		}),
		required_review_thread_resolution: Schema.Boolean.annotations({
			description: "All review conversations must be resolved before merging",
		}),
		required_reviewers: Schema.optional(Schema.Array(RequiredReviewerSchema)),
	}),
});

// --- Required Status Checks Rule ---

const StatusCheckSchema = Schema.Struct({
	context: Schema.String.annotations({
		description: "The status check context name that must be present on the commit",
	}),
	integration_id: Schema.optional(
		Schema.Union(Schema.Int, ResolvedRefSchema).annotations({
			description: "The integration ID, or a { resolved } reference to a credential label",
		}),
	),
});

const RequiredStatusChecksRule = Schema.Struct({
	type: Schema.Literal("required_status_checks"),
	parameters: Schema.Struct({
		do_not_enforce_on_create: Schema.optional(
			Schema.Boolean.annotations({
				description: "Allow branch creation even if checks would prohibit it",
			}),
		),
		required_status_checks: Schema.Array(StatusCheckSchema).annotations({
			description: "Status checks that are required",
		}),
		strict_required_status_checks_policy: Schema.Boolean.annotations({
			description: "PRs must be tested with the latest code",
		}),
	}),
});

// --- Merge Queue Rule ---

const MergeQueueRule = Schema.Struct({
	type: Schema.Literal("merge_queue"),
	parameters: Schema.Struct({
		check_response_timeout_minutes: Schema.Int.pipe(Schema.between(1, 360)).annotations({
			description: "Max time for status checks to report (minutes)",
		}),
		grouping_strategy: Schema.Literal("ALLGREEN", "HEADGREEN").annotations({
			description: "Whether all commits or only the head commit must pass checks",
		}),
		max_entries_to_build: Schema.Int.pipe(Schema.between(0, 100)).annotations({
			description: "Max queued PRs requesting checks simultaneously",
		}),
		max_entries_to_merge: Schema.Int.pipe(Schema.between(0, 100)).annotations({
			description: "Max PRs merged together in a group",
		}),
		merge_method: Schema.Literal("MERGE", "SQUASH", "REBASE").annotations({
			description: "Merge method for queued PRs",
		}),
		min_entries_to_merge: Schema.Int.pipe(Schema.between(0, 100)).annotations({
			description: "Min PRs merged together in a group",
		}),
		min_entries_to_merge_wait_minutes: Schema.Int.pipe(Schema.between(0, 360)).annotations({
			description: "Wait time for min group size after first PR is added (minutes)",
		}),
	}),
});

// --- Workflows Rule ---

const WorkflowFileSchema = Schema.Struct({
	path: Schema.String.annotations({ description: "Path to the workflow file" }),
	ref: Schema.optional(Schema.String.annotations({ description: "Branch or tag of the workflow file" })),
	repository_id: Schema.Union(Schema.Int, ResolvedRefSchema).annotations({
		description: "Repository ID, or a { resolved } reference to a credential label",
	}),
	sha: Schema.optional(Schema.String.annotations({ description: "Commit SHA of the workflow file" })),
});

const WorkflowsRule = Schema.Struct({
	type: Schema.Literal("workflows"),
	parameters: Schema.Struct({
		do_not_enforce_on_create: Schema.optional(
			Schema.Boolean.annotations({ description: "Allow branch creation even if checks would prohibit it" }),
		),
		workflows: Schema.Array(WorkflowFileSchema).annotations({
			description: "Workflows that must pass for this rule",
		}),
	}),
});

// --- Code Scanning Rule ---

const CodeScanningToolSchema = Schema.Struct({
	tool: Schema.String.annotations({ description: "Name of the code scanning tool" }),
	alerts_threshold: Schema.Literal("none", "errors", "errors_and_warnings", "all").annotations({
		description: "Severity level at which alerts block updates",
	}),
	security_alerts_threshold: Schema.Literal(
		"none",
		"critical",
		"high_or_higher",
		"medium_or_higher",
		"all",
	).annotations({
		description: "Severity level at which security alerts block updates",
	}),
});

const CodeScanningRule = Schema.Struct({
	type: Schema.Literal("code_scanning"),
	parameters: Schema.Struct({
		code_scanning_tools: Schema.Array(CodeScanningToolSchema).annotations({
			description: "Tools that must provide code scanning results",
		}),
	}),
});

// --- Copilot Code Review Rule ---

const CopilotCodeReviewRule = Schema.Struct({
	type: Schema.Literal("copilot_code_review"),
	parameters: Schema.optional(
		Schema.Struct({
			review_draft_pull_requests: Schema.optional(
				Schema.Boolean.annotations({ description: "Review draft PRs before they are marked ready" }),
			),
			review_on_push: Schema.optional(Schema.Boolean.annotations({ description: "Review each new push to the PR" })),
		}),
	),
});

// --- Rule Union ---

export const RuleSchema = Schema.Union(
	CreationRule,
	UpdateRule,
	DeletionRule,
	RequiredLinearHistoryRule,
	MergeQueueRule,
	RequiredDeploymentsRule,
	RequiredSignaturesRule,
	PullRequestRule,
	RequiredStatusChecksRule,
	NonFastForwardRule,
	CommitMessagePatternRule,
	CommitAuthorEmailPatternRule,
	CommitterEmailPatternRule,
	BranchNamePatternRule,
	TagNamePatternRule,
	FilePathRestrictionRule,
	MaxFilePathLengthRule,
	FileExtensionRestrictionRule,
	MaxFileSizeRule,
	WorkflowsRule,
	CodeScanningRule,
	CopilotCodeReviewRule,
).annotations({
	identifier: "Rule",
	title: "Repository rule",
	description: "A rule to enforce on matching refs",
});

export type Rule = typeof RuleSchema.Type;

// --- Top-level Ruleset ---

const EnforcementSchema = Schema.Literal("disabled", "active", "evaluate").annotations({
	title: "Enforcement level",
	description: "disabled = off, active = enforced, evaluate = test mode (GitHub Enterprise only)",
});

const TargetSchema = Schema.Literal("branch", "tag", "push").annotations({
	title: "Ruleset target",
	description: "The type of ref this ruleset applies to",
});

export const RulesetSchema = Schema.Struct({
	name: Schema.String.annotations({
		title: "Ruleset name",
		description: "The name of the ruleset (used for matching when creating or updating)",
	}),
	enforcement: EnforcementSchema,
	target: Schema.optionalWith(TargetSchema, { default: () => "branch" as const }),
	conditions: Schema.optional(RulesetConditionsSchema),
	bypass_actors: Schema.optional(Schema.Array(BypassActorSchema)),
	rules: Schema.optional(Schema.Array(RuleSchema)),
}).annotations({
	identifier: "Ruleset",
	title: "Repository ruleset",
	description: "A set of rules to apply when specified conditions are met",
	jsonSchema: { "x-tombi-table-keys-order": "schema" },
});

export type Ruleset = typeof RulesetSchema.Type;
