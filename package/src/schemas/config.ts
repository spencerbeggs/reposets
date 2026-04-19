import { Schema } from "effect";
import { CleanupSchema, SecretGroupSchema, VariableGroupSchema } from "./common.js";
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
}).annotations({
	identifier: "SecretScopes",
	title: "Secret scopes",
	description: "Assign secret groups to GitHub secret scopes (actions, dependabot, codespaces)",
});

export const VariableScopesSchema = Schema.Struct({
	actions: Schema.optional(
		Schema.Array(Schema.String).annotations({
			title: "Action variable groups",
			description: "Variable groups to sync as GitHub Actions repository variables",
			examples: [["common"]],
		}),
	),
}).annotations({
	identifier: "VariableScopes",
	title: "Variable scopes",
	description: "Assign variable groups to GitHub variable scopes",
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

const SettingsGroupSchema = Schema.Record({
	key: Schema.String,
	value: Schema.Unknown,
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
	cleanup: Schema.optionalWith(CleanupSchema, {
		default: () => ({
			secrets: false,
			variables: false,
			dependabot_secrets: false,
			codespaces_secrets: false,
			rulesets: false,
			preserve: {
				secrets: [],
				variables: [],
				dependabot_secrets: [],
				codespaces_secrets: [],
				rulesets: [],
			},
		}),
	}).annotations({
		title: "Cleanup defaults",
		description: "Default cleanup behavior for all groups. Can be overridden per group.",
	}),
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
	title: "gh-sync Configuration",
	description: "Configuration for syncing GitHub repository settings, secrets, variables, and rulesets",
	jsonSchema: { "x-tombi-table-keys-order": "schema" },
});

export type Config = typeof ConfigSchema.Type;
