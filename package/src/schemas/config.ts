import { Schema } from "effect";
import { Jsonifiable, taplo, tombi } from "xdg-effect";
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
			jsonSchema: tombi({ additionalKeyLabel: "environment_name" }),
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
			jsonSchema: tombi({ additionalKeyLabel: "environment_name" }),
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
		jsonSchema: tombi({ arrayValuesOrder: "ascending" }),
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
	security: Schema.optional(
		Schema.Array(Schema.String).annotations({
			title: "Security groups",
			description:
				"Names of security groups (vulnerability alerts, automated security fixes, private vulnerability reporting) to apply to these repos",
			examples: [["oss-defaults"]],
		}),
	),
	code_scanning: Schema.optional(
		Schema.Array(Schema.String).annotations({
			title: "Code scanning groups",
			description: "Names of code_scanning groups (CodeQL default setup) to apply to these repos",
			examples: [["oss-defaults"]],
		}),
	),
	cleanup: Schema.optional(CleanupSchema),
}).annotations({
	identifier: "Group",
	title: "Repository group",
	description: "A named group of repositories with their resource assignments",
	jsonSchema: {
		...tombi({ tableKeysOrder: "schema" }),
		...taplo({
			initKeys: ["repos"],
			links: { key: "https://github.com/spencerbeggs/reposets/blob/main/docs/configuration.md" },
		}),
	},
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

const SecurityAndAnalysisStatusSchema = Schema.Literal("enabled", "disabled").annotations({
	identifier: "SecurityAndAnalysisStatus",
	title: "Security feature status",
	description: 'Whether the security feature is "enabled" or "disabled"',
});

const DelegatedBypassReviewerModeSchema = Schema.Literal("ALWAYS", "EXEMPT").annotations({
	identifier: "DelegatedBypassReviewerMode",
	title: "Delegated bypass reviewer mode",
	description: "ALWAYS: reviewer is always required to approve bypass; EXEMPT: reviewer can bypass without review",
});

const DelegatedBypassReviewerSchema = Schema.Union(
	Schema.Struct({
		team: Schema.String.annotations({
			title: "Team slug",
			description: 'GitHub team slug (e.g., "security-team"); resolved to numeric reviewer_id at sync time',
			examples: ["security-team"],
		}),
		mode: Schema.optional(DelegatedBypassReviewerModeSchema),
	}),
	Schema.Struct({
		role: Schema.String.annotations({
			title: "Organization role name",
			description:
				'Organization role name as defined in `GET /orgs/{org}/organization-roles` (e.g., "all_repo_admin", "security_manager"). Resolved to the numeric role ID at sync time.',
			examples: ["all_repo_admin", "all_repo_maintain", "security_manager"],
		}),
		mode: Schema.optional(DelegatedBypassReviewerModeSchema),
	}),
).annotations({
	identifier: "DelegatedBypassReviewer",
	title: "Delegated bypass reviewer",
	description:
		"A reviewer who can approve secret-scanning push-protection bypass requests. Must specify exactly one of team or role.",
});

const SecurityAndAnalysisSchema = Schema.Struct({
	advanced_security: Schema.optional(
		SecurityAndAnalysisStatusSchema.annotations({
			title: "GitHub Advanced Security",
			description:
				"(GHAS-licensed) Master toggle for GitHub Advanced Security features. Free on public repos; requires a GHAS license on private repos.",
		}),
	),
	code_security: Schema.optional(
		SecurityAndAnalysisStatusSchema.annotations({
			title: "GitHub Code Security",
			description: "(GHAS-licensed) Toggle GitHub Code Security functionality.",
		}),
	),
	secret_scanning: Schema.optional(
		SecurityAndAnalysisStatusSchema.annotations({
			title: "Secret scanning",
			description: "Detect exposed credentials and sensitive data committed to the repository.",
		}),
	),
	secret_scanning_push_protection: Schema.optional(
		SecurityAndAnalysisStatusSchema.annotations({
			title: "Secret scanning push protection",
			description: "Block git pushes that contain detected secrets.",
		}),
	),
	secret_scanning_ai_detection: Schema.optional(
		SecurityAndAnalysisStatusSchema.annotations({
			title: "Secret scanning AI detection",
			description: "(GHAS-licensed) AI-powered detection of generic secrets beyond standard provider patterns.",
		}),
	),
	secret_scanning_non_provider_patterns: Schema.optional(
		SecurityAndAnalysisStatusSchema.annotations({
			title: "Secret scanning non-provider patterns",
			description: "(GHAS-licensed) Detect custom secret patterns beyond the standard provider list.",
		}),
	),
	secret_scanning_delegated_alert_dismissal: Schema.optional(
		SecurityAndAnalysisStatusSchema.annotations({
			title: "Delegated alert dismissal",
			description: "(org-only) Allow delegated dismissal of secret scanning alerts.",
		}),
	),
	secret_scanning_delegated_bypass: Schema.optional(
		SecurityAndAnalysisStatusSchema.annotations({
			title: "Delegated push protection bypass",
			description: "(org-only) Allow delegated approval of secret scanning push protection bypass requests.",
		}),
	),
	delegated_bypass_reviewers: Schema.optional(
		Schema.Array(DelegatedBypassReviewerSchema).annotations({
			title: "Delegated bypass reviewers",
			description:
				"(org-only) Reviewers authorized to approve push protection bypass requests. Each entry must specify a team slug or role name.",
		}),
	),
	dependabot_security_updates: Schema.optional(
		SecurityAndAnalysisStatusSchema.annotations({
			title: "Dependabot security updates",
			description: "Automatically open pull requests to patch known dependency vulnerabilities.",
		}),
	),
}).annotations({
	identifier: "SecurityAndAnalysis",
	title: "Security and analysis",
	description:
		"GitHub repository security_and_analysis fields applied via the same PATCH /repos call as other settings. (GHAS-licensed) fields require a GHAS license on private repos; (org-only) fields are silently skipped on personal repos.",
	jsonSchema: {
		...tombi({ tableKeysOrder: "schema" }),
		...taplo({
			links: { key: "https://github.com/spencerbeggs/reposets/blob/main/docs/configuration.md" },
		}),
	},
});

export type SecurityAndAnalysis = typeof SecurityAndAnalysisSchema.Type;

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
		security_and_analysis: Schema.optional(SecurityAndAnalysisSchema),
	},
	{ key: Schema.String, value: Jsonifiable },
).annotations({
	identifier: "SettingsGroup",
	title: "Settings group",
	description:
		"GitHub repository settings to apply. Known fields are typed; additional fields are passed through to the API.",
	jsonSchema: {
		...tombi({ tableKeysOrder: "schema" }),
		...taplo({
			links: { key: "https://github.com/spencerbeggs/reposets/blob/main/docs/configuration.md" },
		}),
	},
});

export const SecurityGroupSchema = Schema.Struct({
	vulnerability_alerts: Schema.optional(
		Schema.Boolean.annotations({
			title: "Vulnerability alerts",
			description: "Enable Dependabot vulnerability alerts (PUT/DELETE /repos/{o}/{r}/vulnerability-alerts).",
		}),
	),
	automated_security_fixes: Schema.optional(
		Schema.Boolean.annotations({
			title: "Automated security fixes",
			description:
				"Enable Dependabot security pull requests (PUT/DELETE /repos/{o}/{r}/automated-security-fixes). Requires vulnerability_alerts to also be enabled.",
		}),
	),
	private_vulnerability_reporting: Schema.optional(
		Schema.Boolean.annotations({
			title: "Private vulnerability reporting",
			description:
				"Enable the private vulnerability reporting inbox (PUT/DELETE /repos/{o}/{r}/private-vulnerability-reporting).",
		}),
	),
})
	.pipe(
		Schema.filter((group) => !(group.automated_security_fixes === true && group.vulnerability_alerts === false), {
			identifier: "SecurityGroup",
			message: () =>
				"automated_security_fixes = true requires vulnerability_alerts to be enabled (or omitted to leave the existing setting in place)",
		}),
	)
	.annotations({
		identifier: "SecurityGroup",
		title: "Security group",
		description:
			"Toggles for repository-level security features that have dedicated PUT/DELETE endpoints (vulnerability alerts, automated security fixes, private vulnerability reporting). Omitted keys are left untouched.",
		jsonSchema: {
			...tombi({ tableKeysOrder: "schema" }),
			...taplo({
				links: { key: "https://github.com/spencerbeggs/reposets/blob/main/docs/configuration.md" },
			}),
		},
	});

export type SecurityGroup = typeof SecurityGroupSchema.Type;

export const CodeScanningLanguageSchema = Schema.Literal(
	"actions",
	"c-cpp",
	"csharp",
	"go",
	"java-kotlin",
	"javascript-typescript",
	"python",
	"ruby",
	"swift",
).annotations({
	identifier: "CodeScanningLanguage",
	title: "CodeQL default-setup language",
	description:
		"Languages supported by GitHub code scanning default setup. Note: this is narrower than the CodeQL analyzer (Rust is supported by CodeQL but not by default setup).",
});

const CodeScanningStateSchema = Schema.Literal("configured", "not-configured").annotations({
	identifier: "CodeScanningState",
	title: "Default setup state",
	description: '"configured" enables CodeQL default setup; "not-configured" disables it.',
});

const CodeScanningQuerySuiteSchema = Schema.Literal("default", "extended").annotations({
	identifier: "CodeScanningQuerySuite",
	title: "Query suite",
	description: '"default" runs the standard query set; "extended" includes additional security queries.',
});

const CodeScanningThreatModelSchema = Schema.Literal("remote", "remote_and_local").annotations({
	identifier: "CodeScanningThreatModel",
	title: "Threat model",
	description:
		'"remote" analyzes network sources only; "remote_and_local" also includes filesystem and environment access.',
});

const CodeScanningRunnerTypeSchema = Schema.Literal("standard", "labeled").annotations({
	identifier: "CodeScanningRunnerType",
	title: "Runner type",
	description: '"standard" uses GitHub-hosted runners; "labeled" uses runners matching runner_label.',
});

export const CodeScanningGroupSchema = Schema.Struct({
	state: Schema.optional(CodeScanningStateSchema),
	languages: Schema.optional(
		Schema.Array(CodeScanningLanguageSchema).annotations({
			title: "Languages",
			description:
				"CodeQL languages to analyze. Languages not detected in the repository are skipped with a warning at sync time.",
			examples: [["javascript-typescript", "python"]],
		}),
	),
	query_suite: Schema.optional(CodeScanningQuerySuiteSchema),
	threat_model: Schema.optional(CodeScanningThreatModelSchema),
	runner_type: Schema.optional(CodeScanningRunnerTypeSchema),
	runner_label: Schema.optional(
		Schema.String.annotations({
			title: "Runner label",
			description: 'Self-hosted runner label. Required when runner_type = "labeled".',
		}),
	),
})
	.pipe(
		Schema.filter((group) => group.runner_type !== "labeled" || group.runner_label !== undefined, {
			identifier: "CodeScanningGroup",
			message: () => 'runner_label is required when runner_type = "labeled"',
		}),
	)
	.annotations({
		identifier: "CodeScanningGroup",
		title: "Code scanning group",
		description:
			"CodeQL default setup configuration applied via PATCH /repos/{o}/{r}/code-scanning/default-setup. The endpoint returns 202 Accepted and configures asynchronously; reposets sends the request and does not poll for completion.",
		jsonSchema: {
			...tombi({ tableKeysOrder: "schema" }),
			...taplo({
				links: { key: "https://github.com/spencerbeggs/reposets/blob/main/docs/configuration.md" },
			}),
		},
	});

export type CodeScanningGroup = typeof CodeScanningGroupSchema.Type;

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
			description: "Named groups of GitHub repository settings to apply",
			jsonSchema: tombi({ additionalKeyLabel: "setting_group" }),
		}),
		{ default: () => ({}) },
	),
	secrets: Schema.optionalWith(
		Schema.Record({ key: Schema.String, value: SecretGroupSchema }).annotations({
			title: "Secret groups",
			description: "Named groups of secrets. Each group is one kind: file, value, or resolved.",
			jsonSchema: tombi({ additionalKeyLabel: "secret_group" }),
		}),
		{ default: () => ({}) },
	),
	variables: Schema.optionalWith(
		Schema.Record({ key: Schema.String, value: VariableGroupSchema }).annotations({
			title: "Variable groups",
			description: "Named groups of variables. Each group is one kind: file, value, or resolved.",
			jsonSchema: tombi({ additionalKeyLabel: "variable_group" }),
		}),
		{ default: () => ({}) },
	),
	rulesets: Schema.optionalWith(
		Schema.Record({
			key: Schema.String,
			value: RulesetSchema,
		}).annotations({
			title: "Rulesets",
			description: "Named rulesets defining branch and tag protection rules",
			jsonSchema: tombi({ additionalKeyLabel: "ruleset_name" }),
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
			jsonSchema: tombi({ additionalKeyLabel: "environment_name" }),
		}),
		{ default: () => ({}) },
	),
	security: Schema.optionalWith(
		Schema.Record({
			key: Schema.String,
			value: SecurityGroupSchema,
		}).annotations({
			title: "Security groups",
			description:
				"Named security groups for vulnerability alerts, automated security fixes, and private vulnerability reporting",
			jsonSchema: tombi({ additionalKeyLabel: "security_group" }),
		}),
		{ default: () => ({}) },
	),
	code_scanning: Schema.optionalWith(
		Schema.Record({
			key: Schema.String,
			value: CodeScanningGroupSchema,
		}).annotations({
			title: "Code scanning groups",
			description: "Named code scanning groups for CodeQL default setup configuration",
			jsonSchema: tombi({ additionalKeyLabel: "code_scanning_group" }),
		}),
		{ default: () => ({}) },
	),
	groups: Schema.Record({
		key: Schema.String,
		value: GroupSchema,
	}).annotations({
		title: "Groups",
		description:
			"Named groups of repositories with their settings, secrets, variables, rulesets, environments, security, and code scanning assignments",
		jsonSchema: tombi({ additionalKeyLabel: "group_name" }),
	}),
}).annotations({
	identifier: "Config",
	title: "reposets Configuration",
	description:
		"Configuration for syncing GitHub repository settings, secrets, variables, rulesets, deployment environments, advanced security toggles, and CodeQL default setup",
	jsonSchema: {
		...tombi({ tableKeysOrder: "schema" }),
		...taplo({
			initKeys: ["owner", "groups"],
			links: { key: "https://github.com/spencerbeggs/reposets/blob/main/docs/configuration.md" },
		}),
	},
});

export type Config = typeof ConfigSchema.Type;
