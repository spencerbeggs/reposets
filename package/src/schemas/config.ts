import { Effect, Schema } from "effect";
import { docs, taplo, tombi } from "./annotations.js";
import { CleanupSchema, SecretGroupSchema, VariableGroupSchema } from "./common.js";
import { EnvironmentSchema } from "./environment.js";
import { RulesetSchema } from "./ruleset.js";

/**
 * Which secret groups apply to which GitHub secret scopes.
 *
 * @public
 */
export const SecretScopesSchema = Schema.Struct({
	actions: Schema.optional(
		Schema.Array(Schema.String).annotate({
			title: "Action secret groups",
			description: "Secret groups to sync as GitHub Actions repository secrets",
			examples: [["deploy", "app"]],
		}),
	),
	dependabot: Schema.optional(
		Schema.Array(Schema.String).annotate({
			title: "Dependabot secret groups",
			description: "Secret groups to sync as Dependabot secrets",
			examples: [["deploy"]],
		}),
	),
	codespaces: Schema.optional(
		Schema.Array(Schema.String).annotate({
			title: "Codespaces secret groups",
			description: "Secret groups to sync as Codespaces secrets",
			examples: [["deploy"]],
		}),
	),
	environments: Schema.optional(
		Schema.Record(
			Schema.String,
			Schema.Array(Schema.String).annotate({
				title: "Environment secret groups",
				description: "Secret groups to sync as environment secrets",
			}),
		).annotate({
			...tombi({ additionalKeyLabel: "environment_name" }),
			title: "Environment secret scopes",
			description: "Map of environment names to secret group references",
		}),
	),
}).annotate({
	identifier: "SecretScopes",
	title: "Secret scopes",
	description: "Assign secret groups to GitHub secret scopes (actions, dependabot, codespaces, environments)",
});

/**
 * The decoded shape of {@link SecretScopesSchema}.
 *
 * @public
 */
export type SecretScopes = typeof SecretScopesSchema.Type;

/**
 * Which variable groups apply to which GitHub variable scopes.
 *
 * @public
 */
export const VariableScopesSchema = Schema.Struct({
	actions: Schema.optional(
		Schema.Array(Schema.String).annotate({
			title: "Action variable groups",
			description: "Variable groups to sync as GitHub Actions repository variables",
			examples: [["common"]],
		}),
	),
	environments: Schema.optional(
		Schema.Record(
			Schema.String,
			Schema.Array(Schema.String).annotate({
				title: "Environment variable groups",
				description: "Variable groups to sync as environment variables",
			}),
		).annotate({
			...tombi({ additionalKeyLabel: "environment_name" }),
			title: "Environment variable scopes",
			description: "Map of environment names to variable group references",
		}),
	),
}).annotate({
	identifier: "VariableScopes",
	title: "Variable scopes",
	description: "Assign variable groups to GitHub variable scopes (actions, environments)",
});

/**
 * The decoded shape of {@link VariableScopesSchema}.
 *
 * @public
 */
export type VariableScopes = typeof VariableScopesSchema.Type;

/**
 * A named group of repositories and the resources assigned to them.
 *
 * @public
 */
export const GroupSchema = Schema.Struct({
	repos: Schema.Array(Schema.String).annotate({
		...tombi({ arrayValuesOrder: "ascending" }),
		title: "Repository names",
		description: "List of repository names (without owner prefix) to sync in this group",
		examples: [["repo-one", "repo-two", "repo-three"]],
	}),
	// Required, deliberately, even when only one profile exists.
	//
	// This names the identity the group is synced AS, and an optional field
	// would have to mean "the only profile" — which stops being well defined
	// the day a second profile is added. That is the failure worth designing
	// out: adding an unrelated profile would silently change which account an
	// existing group writes to, or turn a working config into an error, with
	// nothing in the group itself having changed.
	credentials: Schema.String.annotate({
		title: "Credential profile",
		description: "Name of the credential profile this group authenticates as. Required.",
		examples: ["personal", "work"],
	}),
	settings: Schema.optional(
		Schema.Array(Schema.String).annotate({
			title: "Settings groups",
			description: "Names of settings groups to apply to these repos",
			examples: [["oss-defaults"]],
		}),
	),
	environments: Schema.optional(
		Schema.Array(Schema.String).annotate({
			title: "Environments",
			description: "Names of environment definitions to create/update for these repos",
			examples: [["staging", "production"]],
		}),
	),
	secrets: Schema.optional(SecretScopesSchema),
	variables: Schema.optional(VariableScopesSchema),
	rulesets: Schema.optional(
		Schema.Array(Schema.String).annotate({
			title: "Rulesets",
			description: "Names of rulesets to apply to these repos",
			examples: [["workflow", "release"]],
		}),
	),
	security: Schema.optional(
		Schema.Array(Schema.String).annotate({
			title: "Security groups",
			description:
				"Names of security groups (vulnerability alerts, automated security fixes, private vulnerability reporting) to apply to these repos",
			examples: [["oss-defaults"]],
		}),
	),
	code_scanning: Schema.optional(
		Schema.Array(Schema.String).annotate({
			title: "Code scanning groups",
			description: "Names of code_scanning groups (CodeQL default setup) to apply to these repos",
			examples: [["oss-defaults"]],
		}),
	),
	cleanup: Schema.optional(CleanupSchema),
}).annotate({
	...tombi({ tableKeysOrder: "schema" }),
	...taplo({
		initKeys: ["repos"],
		links: { key: docs("03-configuration.md") },
	}),
	identifier: "Group",
	title: "Repository group",
	description: "A named group of repositories with their resource assignments",
});

/**
 * The decoded shape of {@link GroupSchema}.
 *
 * @public
 */
export type Group = typeof GroupSchema.Type;

const SquashMergeCommitTitleSchema = Schema.Literals(["PR_TITLE", "COMMIT_OR_PR_TITLE"]).annotate({
	title: "Squash merge commit title",
	description:
		"Default title for squash merge commits: PR_TITLE uses the pull request title, COMMIT_OR_PR_TITLE uses the commit message if only one commit, otherwise the PR title",
});

const SquashMergeCommitMessageSchema = Schema.Literals(["PR_BODY", "COMMIT_MESSAGES", "BLANK"]).annotate({
	title: "Squash merge commit message",
	description:
		"Default message body for squash merge commits: PR_BODY uses the pull request body, COMMIT_MESSAGES concatenates all commit messages, BLANK leaves it empty",
});

const MergeCommitTitleSchema = Schema.Literals(["PR_TITLE", "MERGE_MESSAGE"]).annotate({
	title: "Merge commit title",
	description:
		"Default title for merge commits: PR_TITLE uses the pull request title, MERGE_MESSAGE uses the classic merge message",
});

const MergeCommitMessageSchema = Schema.Literals(["PR_BODY", "PR_TITLE", "BLANK"]).annotate({
	title: "Merge commit message",
	description:
		"Default message body for merge commits: PR_BODY uses the pull request body, PR_TITLE uses the PR title, BLANK leaves it empty",
});

const SecurityAndAnalysisStatusSchema = Schema.Literals(["enabled", "disabled"]).annotate({
	identifier: "SecurityAndAnalysisStatus",
	title: "Security feature status",
	description: 'Whether the security feature is "enabled" or "disabled"',
});

const DelegatedBypassReviewerModeSchema = Schema.Literals(["ALWAYS", "EXEMPT"]).annotate({
	identifier: "DelegatedBypassReviewerMode",
	title: "Delegated bypass reviewer mode",
	description: "ALWAYS: reviewer is always required to approve bypass; EXEMPT: reviewer can bypass without review",
});

const DelegatedBypassReviewerSchema = Schema.Union([
	Schema.Struct({
		team: Schema.String.annotate({
			title: "Team slug",
			description: 'GitHub team slug (e.g., "security-team"); resolved to numeric reviewer_id at sync time',
			examples: ["security-team"],
		}),
		mode: Schema.optional(DelegatedBypassReviewerModeSchema),
	}),
	Schema.Struct({
		role: Schema.String.annotate({
			title: "Organization role name",
			description:
				'Organization role name as defined in `GET /orgs/{org}/organization-roles` (e.g., "all_repo_admin", "security_manager"). Resolved to the numeric role ID at sync time.',
			examples: ["all_repo_admin", "all_repo_maintain", "security_manager"],
		}),
		mode: Schema.optional(DelegatedBypassReviewerModeSchema),
	}),
]).annotate({
	identifier: "DelegatedBypassReviewer",
	title: "Delegated bypass reviewer",
	description:
		"A reviewer who can approve secret-scanning push-protection bypass requests. Must specify exactly one of team or role.",
});

const SecurityAndAnalysisSchema = Schema.Struct({
	advanced_security: Schema.optional(
		SecurityAndAnalysisStatusSchema.annotate({
			title: "GitHub Advanced Security",
			description:
				"(GHAS-licensed) Master toggle for GitHub Advanced Security features. Free on public repos; requires a GHAS license on private repos.",
		}),
	),
	code_security: Schema.optional(
		SecurityAndAnalysisStatusSchema.annotate({
			title: "GitHub Code Security",
			description: "(GHAS-licensed) Toggle GitHub Code Security functionality.",
		}),
	),
	secret_scanning: Schema.optional(
		SecurityAndAnalysisStatusSchema.annotate({
			title: "Secret scanning",
			description: "Detect exposed credentials and sensitive data committed to the repository.",
		}),
	),
	secret_scanning_push_protection: Schema.optional(
		SecurityAndAnalysisStatusSchema.annotate({
			title: "Secret scanning push protection",
			description: "Block git pushes that contain detected secrets.",
		}),
	),
	secret_scanning_ai_detection: Schema.optional(
		SecurityAndAnalysisStatusSchema.annotate({
			title: "Secret scanning AI detection",
			description: "(GHAS-licensed) AI-powered detection of generic secrets beyond standard provider patterns.",
		}),
	),
	secret_scanning_non_provider_patterns: Schema.optional(
		SecurityAndAnalysisStatusSchema.annotate({
			title: "Secret scanning non-provider patterns",
			description: "(GHAS-licensed) Detect custom secret patterns beyond the standard provider list.",
		}),
	),
	secret_scanning_delegated_alert_dismissal: Schema.optional(
		SecurityAndAnalysisStatusSchema.annotate({
			title: "Delegated alert dismissal",
			description: "(org-only) Allow delegated dismissal of secret scanning alerts.",
		}),
	),
	secret_scanning_delegated_bypass: Schema.optional(
		SecurityAndAnalysisStatusSchema.annotate({
			title: "Delegated push protection bypass",
			description: "(org-only) Allow delegated approval of secret scanning push protection bypass requests.",
		}),
	),
	delegated_bypass_reviewers: Schema.optional(
		Schema.Array(DelegatedBypassReviewerSchema).annotate({
			title: "Delegated bypass reviewers",
			description:
				"(org-only) Reviewers authorized to approve push protection bypass requests. Each entry must specify a team slug or role name.",
		}),
	),
	dependabot_security_updates: Schema.optional(
		SecurityAndAnalysisStatusSchema.annotate({
			title: "Dependabot security updates",
			description: "Automatically open pull requests to patch known dependency vulnerabilities.",
		}),
	),
}).annotate({
	...tombi({ tableKeysOrder: "schema" }),
	...taplo({ links: { key: docs("03-configuration.md") } }),
	identifier: "SecurityAndAnalysis",
	title: "Security and analysis",
	description:
		"GitHub repository security_and_analysis fields applied via the same PATCH /repos call as other settings. (GHAS-licensed) fields require a GHAS license on private repos; (org-only) fields are silently skipped on personal repos.",
});

/**
 * The decoded shape of {@link SecurityAndAnalysisSchema}.
 *
 * @public
 */
export type SecurityAndAnalysis = typeof SecurityAndAnalysisSchema.Type;

/**
 * Repository settings to apply: known fields typed, unknown fields passed
 * through to the API.
 *
 * @remarks
 * v3 spelled the pass-through as `Schema.Struct(fields, { key, value })` — a
 * second argument that v4's `Struct` no longer takes. `StructWithRest` is the
 * replacement, and it composes the same way: the decoded type is the struct
 * intersected with the record. GitHub adds repository settings faster than this
 * schema tracks them, and an unknown key should reach the API rather than fail
 * validation.
 *
 * @public
 */
export const SettingsGroupSchema = Schema.StructWithRest(
	Schema.Struct({
		is_template: Schema.optional(
			Schema.Boolean.annotate({
				title: "Template repository",
				description: "Whether the repository is a template that can be used to generate new repositories",
			}),
		),
		has_wiki: Schema.optional(
			Schema.Boolean.annotate({
				title: "Wikis",
				description: "Enable the wiki feature for the repository",
			}),
		),
		has_issues: Schema.optional(
			Schema.Boolean.annotate({
				title: "Issues",
				description: "Enable the issues feature for the repository",
			}),
		),
		has_projects: Schema.optional(
			Schema.Boolean.annotate({
				title: "Projects",
				description: "Enable the projects feature for the repository",
			}),
		),
		has_discussions: Schema.optional(
			Schema.Boolean.annotate({
				title: "Discussions",
				description: "Enable the discussions feature for the repository",
			}),
		),
		has_sponsorships: Schema.optional(
			Schema.Boolean.annotate({
				title: "Sponsorships",
				description: "Display a Sponsor button for the repository (synced via GraphQL)",
			}),
		),
		has_pull_requests: Schema.optional(
			Schema.Boolean.annotate({
				title: "Pull requests",
				description: "Enable the pull requests feature for the repository (synced via GraphQL)",
			}),
		),
		allow_forking: Schema.optional(
			Schema.Boolean.annotate({
				title: "Allow forking",
				description: "Allow forking of the repository",
			}),
		),
		allow_merge_commit: Schema.optional(
			Schema.Boolean.annotate({
				title: "Allow merge commits",
				description: "Allow merge commits when merging pull requests",
			}),
		),
		allow_squash_merge: Schema.optional(
			Schema.Boolean.annotate({
				title: "Allow squash merging",
				description: "Allow squash merging when merging pull requests",
			}),
		),
		allow_rebase_merge: Schema.optional(
			Schema.Boolean.annotate({
				title: "Allow rebase merging",
				description: "Allow rebase merging when merging pull requests",
			}),
		),
		allow_auto_merge: Schema.optional(
			Schema.Boolean.annotate({
				title: "Allow auto-merge",
				description: "Allow pull requests to be automatically merged once all requirements are met",
			}),
		),
		allow_update_branch: Schema.optional(
			Schema.Boolean.annotate({
				title: "Always suggest updating pull request branches",
				description: "Show the update branch button on pull requests",
			}),
		),
		squash_merge_commit_title: Schema.optional(SquashMergeCommitTitleSchema),
		squash_merge_commit_message: Schema.optional(SquashMergeCommitMessageSchema),
		merge_commit_title: Schema.optional(MergeCommitTitleSchema),
		merge_commit_message: Schema.optional(MergeCommitMessageSchema),
		delete_branch_on_merge: Schema.optional(
			Schema.Boolean.annotate({
				title: "Automatically delete head branches",
				description: "Automatically delete head branches after pull requests are merged",
			}),
		),
		web_commit_signoff_required: Schema.optional(
			Schema.Boolean.annotate({
				title: "Require commit signoff",
				description: "Require contributors to sign off on web-based commits",
			}),
		),
		security_and_analysis: Schema.optional(SecurityAndAnalysisSchema),
	}),
	[Schema.Record(Schema.String, Schema.Json)],
).annotate({
	...tombi({ tableKeysOrder: "schema" }),
	...taplo({ links: { key: docs("03-configuration.md") } }),
	identifier: "SettingsGroup",
	title: "Settings group",
	description:
		"GitHub repository settings to apply. Known fields are typed; additional fields are passed through to the API.",
});

/**
 * The decoded shape of {@link SettingsGroupSchema}.
 *
 * @public
 */
export type SettingsGroup = typeof SettingsGroupSchema.Type;

/**
 * Repository security toggles that have dedicated PUT/DELETE endpoints.
 *
 * @public
 */
export const SecurityGroupSchema = Schema.Struct({
	vulnerability_alerts: Schema.optional(
		Schema.Boolean.annotate({
			title: "Vulnerability alerts",
			description: "Enable Dependabot vulnerability alerts (PUT/DELETE /repos/{o}/{r}/vulnerability-alerts).",
		}),
	),
	automated_security_fixes: Schema.optional(
		Schema.Boolean.annotate({
			title: "Automated security fixes",
			description:
				"Enable Dependabot security pull requests (PUT/DELETE /repos/{o}/{r}/automated-security-fixes). Requires vulnerability_alerts to also be enabled.",
		}),
	),
	private_vulnerability_reporting: Schema.optional(
		Schema.Boolean.annotate({
			title: "Private vulnerability reporting",
			description:
				"Enable the private vulnerability reporting inbox (PUT/DELETE /repos/{o}/{r}/private-vulnerability-reporting).",
		}),
	),
})
	.annotate({
		...tombi({ tableKeysOrder: "schema" }),
		...taplo({ links: { key: docs("03-configuration.md") } }),
		identifier: "SecurityGroup",
		title: "Security group",
		description:
			"Toggles for repository-level security features that have dedicated PUT/DELETE endpoints (vulnerability alerts, automated security fixes, private vulnerability reporting). Omitted keys are left untouched.",
	})
	.check(
		Schema.makeFilter((group) =>
			group.automated_security_fixes === true && group.vulnerability_alerts === false
				? "automated_security_fixes = true requires vulnerability_alerts to be enabled (or omitted to leave the existing setting in place)"
				: undefined,
		),
	);

/**
 * The decoded shape of {@link SecurityGroupSchema}.
 *
 * @public
 */
export type SecurityGroup = typeof SecurityGroupSchema.Type;

/**
 * A language GitHub code scanning default setup supports.
 *
 * @public
 */
export const CodeScanningLanguageSchema = Schema.Literals([
	"actions",
	"c-cpp",
	"csharp",
	"go",
	"java-kotlin",
	"javascript-typescript",
	"python",
	"ruby",
	"swift",
]).annotate({
	identifier: "CodeScanningLanguage",
	title: "CodeQL default-setup language",
	description:
		"Languages supported by GitHub code scanning default setup. Note: this is narrower than the CodeQL analyzer (Rust is supported by CodeQL but not by default setup).",
});

/**
 * The decoded shape of {@link CodeScanningLanguageSchema}.
 *
 * @public
 */
export type CodeScanningLanguage = typeof CodeScanningLanguageSchema.Type;

const CodeScanningStateSchema = Schema.Literals(["configured", "not-configured"]).annotate({
	identifier: "CodeScanningState",
	title: "Default setup state",
	description: '"configured" enables CodeQL default setup; "not-configured" disables it.',
});

const CodeScanningQuerySuiteSchema = Schema.Literals(["default", "extended"]).annotate({
	identifier: "CodeScanningQuerySuite",
	title: "Query suite",
	description: '"default" runs the standard query set; "extended" includes additional security queries.',
});

const CodeScanningThreatModelSchema = Schema.Literals(["remote", "remote_and_local"]).annotate({
	identifier: "CodeScanningThreatModel",
	title: "Threat model",
	description:
		'"remote" analyzes network sources only; "remote_and_local" also includes filesystem and environment access.',
});

const CodeScanningRunnerTypeSchema = Schema.Literals(["standard", "labeled"]).annotate({
	identifier: "CodeScanningRunnerType",
	title: "Runner type",
	description: '"standard" uses GitHub-hosted runners; "labeled" uses runners matching runner_label.',
});

/**
 * CodeQL default setup configuration.
 *
 * @public
 */
export const CodeScanningGroupSchema = Schema.Struct({
	state: Schema.optional(CodeScanningStateSchema),
	languages: Schema.optional(
		Schema.Array(CodeScanningLanguageSchema).annotate({
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
		Schema.String.annotate({
			title: "Runner label",
			description: 'Self-hosted runner label. Required when runner_type = "labeled".',
		}),
	),
})
	.annotate({
		...tombi({ tableKeysOrder: "schema" }),
		...taplo({ links: { key: docs("03-configuration.md") } }),
		identifier: "CodeScanningGroup",
		title: "Code scanning group",
		description:
			"CodeQL default setup configuration applied via PATCH /repos/{o}/{r}/code-scanning/default-setup. The endpoint returns 202 Accepted and configures asynchronously; reposets sends the request and does not poll for completion.",
	})
	.check(
		Schema.makeFilter((group) =>
			group.runner_type === "labeled" && group.runner_label === undefined
				? 'runner_label is required when runner_type = "labeled"'
				: undefined,
		),
	);

/**
 * The decoded shape of {@link CodeScanningGroupSchema}.
 *
 * @public
 */
export type CodeScanningGroup = typeof CodeScanningGroupSchema.Type;

/**
 * The whole `reposets.config.toml` document.
 *
 * @remarks
 * `groups` is the only required key. Every resource map defaults to empty, so a
 * config that declares repositories and nothing else is valid and does nothing —
 * which is the right behaviour for a tool that mutates GitHub.
 *
 * @public
 */
export const ConfigSchema = Schema.Struct({
	settings: Schema.Record(Schema.String, SettingsGroupSchema)
		.annotate({
			...tombi({ additionalKeyLabel: "setting_group" }),
			title: "Settings groups",
			description: "Named groups of GitHub repository settings to apply",
		})
		.pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
	secrets: Schema.Record(Schema.String, SecretGroupSchema)
		.annotate({
			...tombi({ additionalKeyLabel: "secret_group" }),
			title: "Secret groups",
			description: "Named groups of secrets. Each group is one kind: file, value, or resolved.",
		})
		.pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
	variables: Schema.Record(Schema.String, VariableGroupSchema)
		.annotate({
			...tombi({ additionalKeyLabel: "variable_group" }),
			title: "Variable groups",
			description: "Named groups of variables. Each group is one kind: file, value, or resolved.",
		})
		.pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
	rulesets: Schema.Record(Schema.String, RulesetSchema)
		.annotate({
			...tombi({ additionalKeyLabel: "ruleset_name" }),
			title: "Rulesets",
			description: "Named rulesets defining branch and tag protection rules",
		})
		.pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
	environments: Schema.Record(Schema.String, EnvironmentSchema)
		.annotate({
			...tombi({ additionalKeyLabel: "environment_name" }),
			title: "Environments",
			description: "Named deployment environment configurations",
		})
		.pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
	security: Schema.Record(Schema.String, SecurityGroupSchema)
		.annotate({
			...tombi({ additionalKeyLabel: "security_group" }),
			title: "Security groups",
			description:
				"Named security groups for vulnerability alerts, automated security fixes, and private vulnerability reporting",
		})
		.pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
	code_scanning: Schema.Record(Schema.String, CodeScanningGroupSchema)
		.annotate({
			...tombi({ additionalKeyLabel: "code_scanning_group" }),
			title: "Code scanning groups",
			description: "Named code scanning groups for CodeQL default setup configuration",
		})
		.pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
	groups: Schema.Record(Schema.String, GroupSchema)
		.annotate({
			...tombi({ additionalKeyLabel: "group_name" }),
			title: "Groups",
			description:
				"Named groups of repositories with their settings, secrets, variables, rulesets, environments, security, and code scanning assignments",
		})
		// Defaults to `{}` like every sibling section. It was the one required
		// key, which made `reposets init`'s own scaffold fail `reposets validate`
		// — the first two commands a new user runs, in that order.
		.pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
}).annotate({
	...tombi({ tableKeysOrder: "schema" }),
	...taplo({
		initKeys: ["groups"],
		links: { key: docs("03-configuration.md") },
	}),
	identifier: "Config",
	title: "reposets Configuration",
	description:
		"Configuration for syncing GitHub repository settings, secrets, variables, rulesets, deployment environments, advanced security toggles, and CodeQL default setup",
});

/**
 * The decoded shape of {@link ConfigSchema}.
 *
 * @public
 */
export type Config = typeof ConfigSchema.Type;
