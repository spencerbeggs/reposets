import { Schema } from "effect";

// --- Resource Group Schemas ---

const ResourceFileKind = Schema.Struct({
	file: Schema.Record({ key: Schema.String, value: Schema.String }).annotations({
		title: "File entries",
		description: "Named entries with file path values, resolved relative to config directory",
		jsonSchema: { "x-tombi-additional-key-label": "name" },
	}),
});

const ResourceValueKind = Schema.Struct({
	value: Schema.Record({
		key: Schema.String,
		value: Schema.Union(Schema.String, Schema.Record({ key: Schema.String, value: Schema.Unknown })),
	}).annotations({
		title: "Value entries",
		description: "Named entries with inline values. Strings used as-is, objects JSON-stringified.",
		jsonSchema: { "x-tombi-additional-key-label": "name" },
	}),
});

const ResourceResolvedKind = Schema.Struct({
	resolved: Schema.Record({ key: Schema.String, value: Schema.String }).annotations({
		title: "Resolved entries",
		description: "Named entries mapped to credential labels. Values come from the active credential profile.",
		jsonSchema: { "x-tombi-additional-key-label": "name" },
	}),
});

export const SecretGroupSchema = Schema.Union(ResourceFileKind, ResourceValueKind, ResourceResolvedKind).annotations({
	identifier: "SecretGroup",
	title: "Secret group",
	description: "A group of secrets. Must be exactly one kind: file, value, or resolved.",
});

export type SecretGroup = typeof SecretGroupSchema.Type;

export const VariableGroupSchema = Schema.Union(ResourceFileKind, ResourceValueKind, ResourceResolvedKind).annotations({
	identifier: "VariableGroup",
	title: "Variable group",
	description: "A group of variables. Must be exactly one kind: file, value, or resolved.",
});

export type VariableGroup = typeof VariableGroupSchema.Type;

// --- Cleanup Schema ---

export const CleanupPreserveSchema = Schema.Struct({
	secrets: Schema.optionalWith(Schema.Array(Schema.String), { default: () => [] }).annotations({
		title: "Preserved secrets",
		description: "Action secret names that should never be deleted during cleanup",
		examples: [["LEGACY_TOKEN", "DEPLOY_KEY"]],
		default: [],
	}),
	variables: Schema.optionalWith(Schema.Array(Schema.String), { default: () => [] }).annotations({
		title: "Preserved variables",
		description: "Action variable names that should never be deleted during cleanup",
		examples: [["LEGACY_VAR"]],
		default: [],
	}),
	dependabot_secrets: Schema.optionalWith(Schema.Array(Schema.String), { default: () => [] }).annotations({
		title: "Preserved Dependabot secrets",
		description: "Dependabot secret names that should never be deleted during cleanup",
		default: [],
	}),
	codespaces_secrets: Schema.optionalWith(Schema.Array(Schema.String), { default: () => [] }).annotations({
		title: "Preserved Codespaces secrets",
		description: "Codespaces secret names that should never be deleted during cleanup",
		default: [],
	}),
	rulesets: Schema.optionalWith(Schema.Array(Schema.String), { default: () => [] }).annotations({
		title: "Preserved rulesets",
		description: "Ruleset names that should never be deleted during cleanup",
		default: [],
	}),
}).annotations({
	identifier: "CleanupPreserve",
	title: "Preserve lists",
	description: "Resource names to preserve during cleanup (never delete)",
});

export type CleanupPreserve = typeof CleanupPreserveSchema.Type;

export const CleanupSchema = Schema.Struct({
	secrets: Schema.optionalWith(Schema.Boolean, { default: () => false }).annotations({
		title: "Clean up action secrets",
		description: "Delete action secrets not declared in any referenced secret group",
		default: false,
	}),
	variables: Schema.optionalWith(Schema.Boolean, { default: () => false }).annotations({
		title: "Clean up action variables",
		description: "Delete action variables not declared in any referenced variable group",
		default: false,
	}),
	dependabot_secrets: Schema.optionalWith(Schema.Boolean, { default: () => false }).annotations({
		title: "Clean up Dependabot secrets",
		description: "Delete Dependabot secrets not declared in any referenced secret group",
		default: false,
	}),
	codespaces_secrets: Schema.optionalWith(Schema.Boolean, { default: () => false }).annotations({
		title: "Clean up Codespaces secrets",
		description: "Delete Codespaces secrets not declared in any referenced secret group",
		default: false,
	}),
	rulesets: Schema.optionalWith(Schema.Boolean, { default: () => false }).annotations({
		title: "Clean up rulesets",
		description: "Delete repository rulesets not declared in any referenced ruleset group",
		default: false,
	}),
	preserve: Schema.optionalWith(CleanupPreserveSchema, {
		default: () => ({
			secrets: [],
			variables: [],
			dependabot_secrets: [],
			codespaces_secrets: [],
			rulesets: [],
		}),
	}).annotations({
		title: "Preserve lists",
		description: "Resource names to never delete during cleanup",
	}),
}).annotations({
	identifier: "Cleanup",
	title: "Cleanup configuration",
	description: "Controls deletion of resources not declared in config. All disabled by default.",
});

export type Cleanup = typeof CleanupSchema.Type;
