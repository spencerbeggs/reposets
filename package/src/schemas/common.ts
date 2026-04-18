import { Schema } from "effect";

const FileSource = Schema.Struct({
	file: Schema.String.annotations({
		title: "File path",
		description: "Path to a file containing the value, resolved relative to the config directory",
		examples: ["./private/my-secret", "./rulesets/workflow.json"],
	}),
});

const InlineValueSource = Schema.Struct({
	value: Schema.String.annotations({
		title: "Inline value",
		description: "A literal string value",
		examples: ["my-secret-value", "production"],
	}),
});

const JsonSource = Schema.Struct({
	json: Schema.Record({ key: Schema.String, value: Schema.Unknown }).annotations({
		title: "JSON object",
		description: "An inline object that will be serialized to a JSON string",
		examples: [{ github: "https://npm.pkg.github.com", npm: "https://registry.npmjs.org" }],
	}),
});

const OpSource = Schema.Struct({
	op: Schema.String.annotations({
		title: "1Password reference",
		description: "A 1Password secret reference resolved at runtime via the 1Password SDK",
		examples: ["op://Private/npm-token/credential", "op://Work/api-key/password"],
	}),
});

export const ValueSourceSchema = Schema.Union(FileSource, InlineValueSource, JsonSource, OpSource).annotations({
	identifier: "ValueSource",
	title: "Value source",
	description: "A value source: file path, inline string, JSON object, or 1Password reference",
});

export type ValueSource = typeof ValueSourceSchema.Type;

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
