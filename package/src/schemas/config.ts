import { Schema } from "effect";
import { CleanupSchema, SecretGroupSchema, VariableGroupSchema } from "./common.js";
import { EnvironmentSchema } from "./environment.js";
import { RulesetSchema } from "./ruleset.js";

export const SecretScopesSchema = Schema.Struct({
	actions: Schema.optional(
		Schema.Array(Schema.String).annotations({
			title: "Action secret groups",
			description: "Secret groups to sync as GitHub Actions repository secrets",
			examples: [["deploy", "app"]],
		}),
	),
	dependabot: Schema.optional(
		Schema.Array(Schema.String).annotations({
			title: "Dependabot secret groups",
			description: "Secret groups to sync as Dependabot secrets",
			examples: [["deploy"]],
		}),
	),
	codespaces: Schema.optional(
		Schema.Array(Schema.String).annotations({
			title: "Codespaces secret groups",
			description: "Secret groups to sync as Codespaces secrets",
			examples: [["deploy"]],
		}),
	),
	environments: Schema.optional(
		Schema.Record({
			key: Schema.String,
			value: Schema.Array(Schema.String).annotations({
				title: "Environment secret groups",
				description: "Secret groups to sync as environment secrets",
			}),
		}).annotations({
			title: "Environment secret scopes",
			description: "Map of environment names to secret group references",
			jsonSchema: { "x-tombi-additional-key-label": "environment_name" },
		}),
	),
}).annotations({
	identifier: "SecretScopes",
	title: "Secret scopes",
	description: "Assign secret groups to GitHub secret scopes (actions, dependabot, codespaces, environments)",
});

export const VariableScopesSchema = Schema.Struct({
	actions: Schema.optional(
		Schema.Array(Schema.String).annotations({
			title: "Action variable groups",
			description: "Variable groups to sync as GitHub Actions repository variables",
			examples: [["common"]],
		}),
	),
	environments: Schema.optional(
		Schema.Record({
			key: Schema.String,
			value: Schema.Array(Schema.String).annotations({
				title: "Environment variable groups",
				description: "Variable groups to sync as environment variables",
			}),
		}).annotations({
			title: "Environment variable scopes",
			description: "Map of environment names to variable group references",
			jsonSchema: { "x-tombi-additional-key-label": "environment_name" },
		}),
	),
}).annotations({
	identifier: "VariableScopes",
	title: "Variable scopes",
	description: "Assign variable groups to GitHub variable scopes (actions, environments)",
});

export const GroupSchema = Schema.Struct({
	owner: Schema.optional(
		Schema.String.annotations({
			title: "Owner override",
			description: "GitHub user or organization that owns these repos. Overrides the top-level owner.",
			examples: ["savvy-web"],
		}),
	),
	repos: Schema.Array(Schema.String).annotations({
		title: "Repository names",
		description: "List of repository names (without owner prefix) to sync in this group",
		examples: [["repo-one", "repo-two", "repo-three"]],
		jsonSchema: { "x-tombi-array-values-order": "ascending" },
	}),
	credentials: Schema.optional(
		Schema.String.annotations({
			title: "Credential profile",
			description: "Name of the credential profile to use. If only one profile exists, it is used automatically.",
			examples: ["personal", "work"],
		}),
	),
	settings: Schema.optional(
		Schema.Array(Schema.String).annotations({
			title: "Settings groups",
			description: "Names of settings groups to apply to these repos",
			examples: [["oss-defaults"]],
		}),
	),
	environments: Schema.optional(
		Schema.Array(Schema.String).annotations({
			title: "Environments",
			description: "Names of environment definitions to create/update for these repos",
			examples: [["staging", "production"]],
		}),
	),
	secrets: Schema.optional(SecretScopesSchema),
	variables: Schema.optional(VariableScopesSchema),
	rulesets: Schema.optional(
		Schema.Array(Schema.String).annotations({
			title: "Rulesets",
			description: "Names of rulesets to apply to these repos",
			examples: [["workflow", "release"]],
		}),
	),
	cleanup: Schema.optional(CleanupSchema),
}).annotations({
	identifier: "Group",
	title: "Repository group",
	description: "A named group of repositories with their resource assignments",
	jsonSchema: { "x-tombi-table-keys-order": "schema" },
});

export type Group = typeof GroupSchema.Type;

const SquashMergeCommitTitleSchema = Schema.Literal("PR_TITLE", "COMMIT_OR_PR_TITLE").annotations({
	title: "Squash merge commit title",
	description:
		"Default title for squash merge commits: PR_TITLE uses the pull request title, COMMIT_OR_PR_TITLE uses the commit message if only one commit, otherwise the PR title",
});

const SquashMergeCommitMessageSchema = Schema.Literal("PR_BODY", "COMMIT_MESSAGES", "BLANK").annotations({
	title: "Squash merge commit message",
	description:
		"Default message body for squash merge commits: PR_BODY uses the pull request body, COMMIT_MESSAGES concatenates all commit messages, BLANK leaves it empty",
});

const MergeCommitTitleSchema = Schema.Literal("PR_TITLE", "MERGE_MESSAGE").annotations({
	title: "Merge commit title",
	description:
		"Default title for merge commits: PR_TITLE uses the pull request title, MERGE_MESSAGE uses the classic merge message",
});

const MergeCommitMessageSchema = Schema.Literal("PR_BODY", "PR_TITLE", "BLANK").annotations({
	title: "Merge commit message",
	description:
		"Default message body for merge commits: PR_BODY uses the pull request body, PR_TITLE uses the PR title, BLANK leaves it empty",
});

const SettingsGroupSchema = Schema.Struct(
	{
		is_template: Schema.optional(
			Schema.Boolean.annotations({
				title: "Template repository",
				description: "Whether the repository is a template that can be used to generate new repositories",
			}),
		),
		has_wiki: Schema.optional(
			Schema.Boolean.annotations({
				title: "Wikis",
				description: "Enable the wiki feature for the repository",
			}),
		),
		has_issues: Schema.optional(
			Schema.Boolean.annotations({
				title: "Issues",
				description: "Enable the issues feature for the repository",
			}),
		),
		has_projects: Schema.optional(
			Schema.Boolean.annotations({
				title: "Projects",
				description: "Enable the projects feature for the repository",
			}),
		),
		has_discussions: Schema.optional(
			Schema.Boolean.annotations({
				title: "Discussions",
				description: "Enable the discussions feature for the repository",
			}),
		),
		has_sponsorships: Schema.optional(
			Schema.Boolean.annotations({
				title: "Sponsorships",
				description: "Display a Sponsor button for the repository (synced via GraphQL)",
			}),
		),
		has_pull_requests: Schema.optional(
			Schema.Boolean.annotations({
				title: "Pull requests",
				description: "Enable the pull requests feature for the repository (synced via GraphQL)",
			}),
		),
		allow_forking: Schema.optional(
			Schema.Boolean.annotations({
				title: "Allow forking",
				description: "Allow forking of the repository",
			}),
		),
		allow_merge_commit: Schema.optional(
			Schema.Boolean.annotations({
				title: "Allow merge commits",
				description: "Allow merge commits when merging pull requests",
			}),
		),
		allow_squash_merge: Schema.optional(
			Schema.Boolean.annotations({
				title: "Allow squash merging",
				description: "Allow squash merging when merging pull requests",
			}),
		),
		allow_rebase_merge: Schema.optional(
			Schema.Boolean.annotations({
				title: "Allow rebase merging",
				description: "Allow rebase merging when merging pull requests",
			}),
		),
		allow_auto_merge: Schema.optional(
			Schema.Boolean.annotations({
				title: "Allow auto-merge",
				description: "Allow pull requests to be automatically merged once all requirements are met",
			}),
		),
		allow_update_branch: Schema.optional(
			Schema.Boolean.annotations({
				title: "Always suggest updating pull request branches",
				description: "Show the update branch button on pull requests",
			}),
		),
		squash_merge_commit_title: Schema.optional(SquashMergeCommitTitleSchema),
		squash_merge_commit_message: Schema.optional(SquashMergeCommitMessageSchema),
		merge_commit_title: Schema.optional(MergeCommitTitleSchema),
		merge_commit_message: Schema.optional(MergeCommitMessageSchema),
		delete_branch_on_merge: Schema.optional(
			Schema.Boolean.annotations({
				title: "Automatically delete head branches",
				description: "Automatically delete head branches after pull requests are merged",
			}),
		),
		web_commit_signoff_required: Schema.optional(
			Schema.Boolean.annotations({
				title: "Require commit signoff",
				description: "Require contributors to sign off on web-based commits",
			}),
		),
	},
	{ key: Schema.String, value: Schema.Unknown },
).annotations({
	identifier: "SettingsGroup",
	title: "Settings group",
	description:
		"GitHub repository settings to apply. Known fields are typed; additional fields are passed through to the API.",
	jsonSchema: { "x-tombi-table-keys-order": "schema" },
});

export const LogLevelSchema = Schema.Literal("silent", "info", "verbose", "debug").annotations({
	identifier: "LogLevel",
	title: "Log level",
	description:
		"Controls output verbosity: silent (none), info (summaries), verbose (per-operation), debug (with sources)",
});

export type LogLevel = typeof LogLevelSchema.Type;

export const ConfigSchema = Schema.Struct({
	owner: Schema.optional(
		Schema.String.annotations({
			title: "Default owner",
			description: "Default GitHub user or organization for all groups. Can be overridden per group.",
			examples: ["spencerbeggs", "savvy-web"],
		}),
	),
	log_level: Schema.optionalWith(LogLevelSchema, { default: () => "info" as const }).annotations({
		title: "Log level",
		description: "Default output verbosity. Can be overridden with --log-level CLI flag.",
	}),
	settings: Schema.optionalWith(
		Schema.Record({ key: Schema.String, value: SettingsGroupSchema }).annotations({
			title: "Settings groups",
			description: "Named groups of GitHub repository settings (passed to the repos.update API)",
			jsonSchema: { "x-tombi-additional-key-label": "setting_group" },
		}),
		{ default: () => ({}) },
	),
	secrets: Schema.optionalWith(
		Schema.Record({ key: Schema.String, value: SecretGroupSchema }).annotations({
			title: "Secret groups",
			description: "Named groups of secrets. Each group is one kind: file, value, or resolved.",
			jsonSchema: { "x-tombi-additional-key-label": "secret_group" },
		}),
		{ default: () => ({}) },
	),
	variables: Schema.optionalWith(
		Schema.Record({ key: Schema.String, value: VariableGroupSchema }).annotations({
			title: "Variable groups",
			description: "Named groups of variables. Each group is one kind: file, value, or resolved.",
			jsonSchema: { "x-tombi-additional-key-label": "variable_group" },
		}),
		{ default: () => ({}) },
	),
	rulesets: Schema.optionalWith(
		Schema.Record({
			key: Schema.String,
			value: RulesetSchema,
		}).annotations({
			title: "Rulesets",
			description: "Named rulesets defining branch/tag/push protection rules",
			jsonSchema: { "x-tombi-additional-key-label": "ruleset_name" },
		}),
		{ default: () => ({}) },
	),
	environments: Schema.optionalWith(
		Schema.Record({
			key: Schema.String,
			value: EnvironmentSchema,
		}).annotations({
			title: "Environments",
			description: "Named deployment environment configurations",
			jsonSchema: { "x-tombi-additional-key-label": "environment_name" },
		}),
		{ default: () => ({}) },
	),
	groups: Schema.Record({
		key: Schema.String,
		value: GroupSchema,
	}).annotations({
		title: "Groups",
		description: "Named groups of repositories with their settings, secrets, variables, and ruleset assignments",
		jsonSchema: { "x-tombi-additional-key-label": "group_name" },
	}),
}).annotations({
	identifier: "Config",
	title: "repo-sync Configuration",
	description: "Configuration for syncing GitHub repository settings, secrets, variables, and rulesets",
	jsonSchema: { "x-tombi-table-keys-order": "schema" },
});

export type Config = typeof ConfigSchema.Type;
