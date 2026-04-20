import { Schema } from "effect";

// --- Reviewer ---

const ReviewerTypeSchema = Schema.Literal("User", "Team").annotations({
	title: "Reviewer type",
	description: "Whether the reviewer is an individual user or a team",
});

const ReviewerSchema = Schema.Struct({
	type: ReviewerTypeSchema,
	id: Schema.Int.annotations({
		title: "Reviewer ID",
		description: "The ID of the user or team",
	}),
}).annotations({
	identifier: "Reviewer",
	title: "Reviewer",
	description: "A user or team required to review deployments",
});

// --- Deployment Branch Policy ---

const DeploymentBranchPolicySchema = Schema.Struct({
	name: Schema.String.annotations({
		title: "Pattern",
		description: "The name pattern (branch name, tag name, or glob) to allow deployments from",
	}),
	type: Schema.optionalWith(
		Schema.Literal("branch", "tag").annotations({
			title: "Policy type",
			description: 'Whether this policy matches branches or tags. Defaults to "branch".',
		}),
		{ default: () => "branch" as const },
	),
}).annotations({
	identifier: "DeploymentBranchPolicy",
	title: "Deployment branch policy",
	description: "A custom branch or tag pattern that deployments are allowed from",
});

// --- Deployment Branches ---

const DeploymentBranchesSchema = Schema.Union(
	Schema.Literal("all", "protected").annotations({
		title: "Deployment branch preset",
		description: '"all" allows any branch, "protected" allows only protected branches',
	}),
	Schema.Array(DeploymentBranchPolicySchema).annotations({
		title: "Custom deployment policies",
		description: "Array of branch or tag name patterns allowed to deploy to this environment",
	}),
).annotations({
	identifier: "DeploymentBranches",
	title: "Deployment branches",
	description: 'Controls which branches can deploy. Use "all", "protected", or a list of custom policies.',
});

// --- Environment ---

export const EnvironmentSchema = Schema.Struct({
	wait_timer: Schema.optional(
		Schema.Int.pipe(Schema.between(0, 43200)).annotations({
			title: "Wait timer (minutes)",
			description: "Number of minutes to wait before allowing deployments to proceed (0-43200)",
		}),
	),
	prevent_self_review: Schema.optional(
		Schema.Boolean.annotations({
			title: "Prevent self-review",
			description: "Prevent the user who triggered the deployment from approving it",
		}),
	),
	reviewers: Schema.optional(
		Schema.Array(ReviewerSchema).annotations({
			title: "Required reviewers",
			description: "Users or teams required to approve deployments to this environment",
		}),
	),
	deployment_branches: Schema.optional(DeploymentBranchesSchema),
}).annotations({
	identifier: "Environment",
	title: "Deployment environment",
	description: "Configuration for a GitHub deployment environment",
	jsonSchema: { "x-tombi-table-keys-order": "schema" },
});

export type Environment = typeof EnvironmentSchema.Type;
