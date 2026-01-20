import { Schema } from "effect";
import { CleanupSchema, ValueSourceSchema } from "./common.js";

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

export const RepoGroupSchema = Schema.Struct({
	owner: Schema.optional(
		Schema.String.annotations({
			title: "Owner override",
			description: "GitHub user or organization that owns these repos. Overrides the top-level owner.",
			examples: ["savvy-web"],
		}),
	),
	names: Schema.Array(Schema.String).annotations({
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
			title: "Ruleset groups",
			description: "Names of ruleset groups to apply to these repos",
			examples: [["standard"]],
		}),
	),
	cleanup: Schema.optional(CleanupSchema),
}).annotations({
	identifier: "RepoGroup",
	title: "Repository group",
	description: "A named group of repositories with their resource assignments",
	jsonSchema: { "x-tombi-table-keys-order": "schema" },
});

export type RepoGroup = typeof RepoGroupSchema.Type;

const ResourceGroupSchema = Schema.Record({
	key: Schema.String,
	value: ValueSourceSchema,
});

const SettingsGroupSchema = Schema.Record({
	key: Schema.String,
	value: Schema.Unknown,
});

export const ConfigSchema = Schema.Struct({
	owner: Schema.optional(
		Schema.String.annotations({
			title: "Default owner",
			description: "Default GitHub user or organization for all repo groups. Can be overridden per group.",
			examples: ["spencerbeggs", "savvy-web"],
		}),
	),
	settings: Schema.optionalWith(
		Schema.Record({ key: Schema.String, value: SettingsGroupSchema }).annotations({
			title: "Settings groups",
			description: "Named groups of GitHub repository settings (passed to the repos.update API)",
			jsonSchema: { "x-tombi-additional-key-label": "setting_group" },
		}),
		{ default: () => ({}) },
	),
	secrets: Schema.optionalWith(
		Schema.Record({
			key: Schema.String,
			value: ResourceGroupSchema.annotations({
				title: "Secret entries",
				description: "Named secrets with their value sources",
				jsonSchema: { "x-tombi-additional-key-label": "secret_name" },
			}),
		}).annotations({
			title: "Secret groups",
			description:
				"Named groups of secrets. Each entry maps a secret name to a value source (file, value, json, or op).",
			jsonSchema: { "x-tombi-additional-key-label": "secret_group" },
		}),
		{ default: () => ({}) },
	),
	variables: Schema.optionalWith(
		Schema.Record({
			key: Schema.String,
			value: ResourceGroupSchema.annotations({
				title: "Variable entries",
				description: "Named variables with their value sources",
				jsonSchema: { "x-tombi-additional-key-label": "variable_name" },
			}),
		}).annotations({
			title: "Variable groups",
			description:
				"Named groups of variables. Each entry maps a variable name to a value source (file, value, json, or op).",
			jsonSchema: { "x-tombi-additional-key-label": "variable_group" },
		}),
		{ default: () => ({}) },
	),
	rulesets: Schema.optionalWith(
		Schema.Record({
			key: Schema.String,
			value: ResourceGroupSchema.annotations({
				title: "Ruleset entries",
				description: "Named rulesets with their value sources (typically file references to JSON)",
				jsonSchema: { "x-tombi-additional-key-label": "ruleset_name" },
			}),
		}).annotations({
			title: "Ruleset groups",
			description:
				"Named groups of rulesets. Each entry maps a ruleset name to a value source (file, value, json, or op).",
			jsonSchema: { "x-tombi-additional-key-label": "ruleset_group" },
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
		description: "Default cleanup behavior for all repo groups. Can be overridden per group.",
	}),
	repos: Schema.Record({
		key: Schema.String,
		value: RepoGroupSchema,
	}).annotations({
		title: "Repository groups",
		description: "Named groups of repositories with their settings, secrets, variables, and ruleset assignments",
		jsonSchema: { "x-tombi-additional-key-label": "repo_group" },
	}),
}).annotations({
	identifier: "Config",
	title: "gh-sync Configuration",
	description: "Configuration for syncing GitHub repository settings, secrets, variables, and rulesets",
	jsonSchema: { "x-tombi-table-keys-order": "schema" },
});

export type Config = typeof ConfigSchema.Type;
