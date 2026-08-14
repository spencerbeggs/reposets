import { Effect, Schema } from "effect";
import { docs, taplo, tombi } from "./annotations.js";

// --- Reviewer ---

const ReviewerTypeSchema = Schema.Literals(["User", "Team"]).annotate({
	title: "Reviewer type",
	description: "Whether the reviewer is an individual user or a team",
});

const ReviewerSchema = Schema.Struct({
	type: ReviewerTypeSchema,
	id: Schema.Int.annotate({
		title: "Reviewer ID",
		description: "The numeric GitHub ID of the user or team",
	}),
}).annotate({
	identifier: "Reviewer",
	title: "Reviewer",
	description: "A user or team required to review deployments",
});

// --- Deployment Branch Policy ---

const DeploymentBranchPolicySchema = Schema.Struct({
	name: Schema.String.annotate({
		title: "Pattern",
		description: "The name pattern (branch name, tag name, or glob) to allow deployments from",
	}),
	type: Schema.Literals(["branch", "tag"])
		.annotate({
			title: "Policy type",
			description: 'Whether this policy matches branches or tags. Defaults to "branch".',
		})
		.pipe(Schema.withDecodingDefaultKey(Effect.succeed("branch" as const))),
}).annotate({
	identifier: "DeploymentBranchPolicy",
	title: "Deployment branch policy",
	description: "A custom branch or tag pattern that deployments are allowed from",
});

// --- Deployment Branches ---

const DeploymentBranchesSchema = Schema.Union([
	Schema.Literals(["all", "protected"]).annotate({
		title: "Deployment branch preset",
		description: '"all" allows any branch, "protected" allows only protected branches',
	}),
	Schema.Array(DeploymentBranchPolicySchema).annotate({
		title: "Custom deployment policies",
		description: "Array of branch or tag name patterns allowed to deploy to this environment",
	}),
]).annotate({
	identifier: "DeploymentBranches",
	title: "Deployment branches",
	description: 'Controls which branches can deploy. Use "all", "protected", or a list of custom policies.',
});

// --- Environment ---

/**
 * One GitHub deployment environment.
 *
 * @public
 */
export const EnvironmentSchema = Schema.Struct({
	wait_timer: Schema.optional(
		Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 43200 })).annotate({
			title: "Wait timer (minutes)",
			description: "Number of minutes to wait before allowing deployments to proceed (0-43200)",
		}),
	),
	prevent_self_review: Schema.optional(
		Schema.Boolean.annotate({
			title: "Prevent self-review",
			description: "Prevent the user who triggered the deployment from approving it",
		}),
	),
	reviewers: Schema.optional(
		Schema.Array(ReviewerSchema).annotate({
			title: "Required reviewers",
			description: "Users or teams required to approve deployments to this environment",
		}),
	),
	deployment_branches: Schema.optional(DeploymentBranchesSchema),
}).annotate({
	...tombi({ tableKeysOrder: "schema" }),
	...taplo({ links: { key: docs("07-environments.md") } }),
	identifier: "Environment",
	title: "Deployment environment",
	description: "Configuration for a GitHub deployment environment",
});

/**
 * The decoded shape of {@link EnvironmentSchema}.
 *
 * @public
 */
export type Environment = typeof EnvironmentSchema.Type;
