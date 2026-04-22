import { Schema } from "effect";
import { Jsonifiable, taplo, tombi } from "xdg-effect";

// --- Resource Group Schemas ---

const ResourceFileKind = Schema.Struct({
	file: Schema.Record({ key: Schema.String, value: Schema.String }).annotations({
		title: "File entries",
		description: "Named entries with file path values, resolved relative to config directory",
		jsonSchema: tombi({ additionalKeyLabel: "name" }),
	}),
});

const ResourceValueKind = Schema.Struct({
	value: Schema.Record({
		key: Schema.String,
		value: Schema.Union(Schema.String, Schema.Record({ key: Schema.String, value: Jsonifiable })),
	}).annotations({
		title: "Value entries",
		description: "Named entries with inline values. Strings used as-is, objects JSON-stringified.",
		jsonSchema: tombi({ additionalKeyLabel: "name" }),
	}),
});

const ResourceResolvedKind = Schema.Struct({
	resolved: Schema.Record({ key: Schema.String, value: Schema.String }).annotations({
		title: "Resolved entries",
		description: "Named entries mapped to credential labels. Values come from the active credential profile.",
		jsonSchema: tombi({ additionalKeyLabel: "name" }),
	}),
});

export const SecretGroupSchema = Schema.Union(ResourceFileKind, ResourceValueKind, ResourceResolvedKind).annotations({
	identifier: "SecretGroup",
	title: "Secret group",
	description: "A group of secrets. Must be exactly one kind: file, value, or resolved.",
	jsonSchema: taplo({
		links: { key: "https://github.com/spencerbeggs/reposets/blob/main/docs/secrets-and-variables.md" },
	}),
});

export type SecretGroup = typeof SecretGroupSchema.Type;

export const VariableGroupSchema = Schema.Union(ResourceFileKind, ResourceValueKind, ResourceResolvedKind).annotations({
	identifier: "VariableGroup",
	title: "Variable group",
	description: "A group of variables. Must be exactly one kind: file, value, or resolved.",
	jsonSchema: taplo({
		links: { key: "https://github.com/spencerbeggs/reposets/blob/main/docs/secrets-and-variables.md" },
	}),
});

export type VariableGroup = typeof VariableGroupSchema.Type;

// --- Cleanup Schema ---

export const CleanupScopeSchema = Schema.Union(
	Schema.Boolean,
	Schema.Struct({
		preserve: Schema.Array(Schema.String).annotations({
			title: "Preserve list",
			description: "Resource names that should never be deleted during cleanup",
			examples: [["LEGACY_TOKEN", "DEPLOY_KEY"]],
		}),
	}),
).annotations({
	identifier: "CleanupScope",
	title: "Cleanup scope",
	description:
		"Controls cleanup for a single resource scope. false disables cleanup, true enables full cleanup, or specify names to preserve.",
});

export type CleanupScope = typeof CleanupScopeSchema.Type;

const CleanupSecretsSchema = Schema.Struct({
	actions: Schema.optionalWith(CleanupScopeSchema, { default: () => false as CleanupScope }).annotations({
		title: "Clean up Actions secrets",
		description: "Delete Actions secrets not declared in any referenced secret group",
		default: false,
	}),
	dependabot: Schema.optionalWith(CleanupScopeSchema, { default: () => false as CleanupScope }).annotations({
		title: "Clean up Dependabot secrets",
		description: "Delete Dependabot secrets not declared in any referenced secret group",
		default: false,
	}),
	codespaces: Schema.optionalWith(CleanupScopeSchema, { default: () => false as CleanupScope }).annotations({
		title: "Clean up Codespaces secrets",
		description: "Delete Codespaces secrets not declared in any referenced secret group",
		default: false,
	}),
	environments: Schema.optionalWith(CleanupScopeSchema, { default: () => false as CleanupScope }).annotations({
		title: "Clean up environment secrets",
		description: "Delete environment secrets not declared in any referenced secret group",
		default: false,
	}),
}).annotations({
	identifier: "CleanupSecrets",
	title: "Secrets cleanup configuration",
	description: "Controls deletion of secrets by scope (Actions, Dependabot, Codespaces, environments).",
});

const CleanupVariablesSchema = Schema.Struct({
	actions: Schema.optionalWith(CleanupScopeSchema, { default: () => false as CleanupScope }).annotations({
		title: "Clean up Actions variables",
		description: "Delete Actions variables not declared in any referenced variable group",
		default: false,
	}),
	environments: Schema.optionalWith(CleanupScopeSchema, { default: () => false as CleanupScope }).annotations({
		title: "Clean up environment variables",
		description: "Delete environment variables not declared in any referenced variable group",
		default: false,
	}),
}).annotations({
	identifier: "CleanupVariables",
	title: "Variables cleanup configuration",
	description: "Controls deletion of variables by scope (Actions, environments).",
});

export const CleanupSchema = Schema.Struct({
	secrets: Schema.optionalWith(CleanupSecretsSchema, {
		default: () => ({
			actions: false as CleanupScope,
			dependabot: false as CleanupScope,
			codespaces: false as CleanupScope,
			environments: false as CleanupScope,
		}),
	}).annotations({
		title: "Secrets cleanup",
		description: "Controls cleanup of secrets by scope",
	}),
	variables: Schema.optionalWith(CleanupVariablesSchema, {
		default: () => ({
			actions: false as CleanupScope,
			environments: false as CleanupScope,
		}),
	}).annotations({
		title: "Variables cleanup",
		description: "Controls cleanup of variables by scope",
	}),
	rulesets: Schema.optionalWith(CleanupScopeSchema, { default: () => false as CleanupScope }).annotations({
		title: "Clean up rulesets",
		description: "Delete repository rulesets not declared in any referenced ruleset group",
		default: false,
	}),
	environments: Schema.optionalWith(CleanupScopeSchema, { default: () => false as CleanupScope }).annotations({
		title: "Clean up environments",
		description: "Delete repository environments not declared in config",
		default: false,
	}),
}).annotations({
	identifier: "Cleanup",
	title: "Cleanup configuration",
	description: "Controls deletion of resources not declared in config. All disabled by default.",
	jsonSchema: taplo({
		links: { key: "https://github.com/spencerbeggs/reposets/blob/main/docs/cleanup.md" },
	}),
});

export type Cleanup = typeof CleanupSchema.Type;
