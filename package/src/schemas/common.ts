import { Effect, Schema } from "effect";
import { docs, taplo, tombi } from "./annotations.js";

// --- Resource Group Schemas ---

const ResourceFileKind = Schema.Struct({
	file: Schema.Record(Schema.String, Schema.String).annotate({
		...tombi({ additionalKeyLabel: "name" }),
		title: "File entries",
		description: "Named entries with file path values, resolved relative to config directory",
	}),
});

const ResourceValueKind = Schema.Struct({
	value: Schema.Record(
		Schema.String,
		Schema.Union([Schema.String, Schema.Record(Schema.String, Schema.Json)]),
	).annotate({
		...tombi({ additionalKeyLabel: "name" }),
		title: "Value entries",
		description: "Named entries with inline values. Strings used as-is, objects JSON-stringified.",
	}),
});

const ResourceResolvedKind = Schema.Struct({
	resolved: Schema.Record(Schema.String, Schema.String).annotate({
		...tombi({ additionalKeyLabel: "name" }),
		title: "Resolved entries",
		description: "Named entries mapped to credential labels. Values come from the active credential profile.",
	}),
});

/**
 * A group of secrets: exactly one of `file`, `value` or `resolved`.
 *
 * @public
 */
export const SecretGroupSchema = Schema.Union([ResourceFileKind, ResourceValueKind, ResourceResolvedKind]).annotate({
	...taplo({ links: { key: docs("05-secrets-and-variables.md") } }),
	identifier: "SecretGroup",
	title: "Secret group",
	description: "A group of secrets. Must be exactly one kind: file, value, or resolved.",
});

/**
 * The decoded shape of {@link SecretGroupSchema}.
 *
 * @public
 */
export type SecretGroup = typeof SecretGroupSchema.Type;

/**
 * A group of variables: exactly one of `file`, `value` or `resolved`.
 *
 * @public
 */
export const VariableGroupSchema = Schema.Union([ResourceFileKind, ResourceValueKind, ResourceResolvedKind]).annotate({
	...taplo({ links: { key: docs("05-secrets-and-variables.md") } }),
	identifier: "VariableGroup",
	title: "Variable group",
	description: "A group of variables. Must be exactly one kind: file, value, or resolved.",
});

/**
 * The decoded shape of {@link VariableGroupSchema}.
 *
 * @public
 */
export type VariableGroup = typeof VariableGroupSchema.Type;

// --- Cleanup Schema ---

/**
 * Cleanup policy for one resource scope.
 *
 * @remarks
 * Three-way on purpose: `false` disables cleanup, `true` deletes everything
 * undeclared, and `{ preserve }` deletes everything undeclared except the named
 * resources. Omitting the scope means `false` — leave it alone.
 *
 * @public
 */
export const CleanupScopeSchema = Schema.Union([
	Schema.Boolean,
	Schema.Struct({
		preserve: Schema.Array(Schema.String).annotate({
			title: "Preserve list",
			description: "Resource names that should never be deleted during cleanup",
			examples: [["LEGACY_TOKEN", "DEPLOY_KEY"]],
		}),
	}),
]).annotate({
	identifier: "CleanupScope",
	title: "Cleanup scope",
	description:
		"Controls cleanup for a single resource scope. false disables cleanup, true enables full cleanup, or specify names to preserve.",
});

/**
 * The decoded shape of {@link CleanupScopeSchema}.
 *
 * @public
 */
export type CleanupScope = typeof CleanupScopeSchema.Type;

/**
 * A cleanup scope that defaults to `false` when the key is absent.
 *
 * @remarks
 * v3 wrote this as `Schema.optionalWith(CleanupScopeSchema, { default: () => false })`.
 * v4 splits that into `optionalKey` on the encoded side plus a decoding default;
 * `withDecodingDefaultKey` is the combinator that does both, and it takes the
 * default as an `Effect` rather than a thunk.
 */
const cleanupScopeDefaultingToFalse = CleanupScopeSchema.pipe(
	Schema.withDecodingDefaultKey(Effect.succeed<CleanupScope>(false)),
);

const CleanupSecretsSchema = Schema.Struct({
	actions: cleanupScopeDefaultingToFalse.annotate({
		title: "Clean up Actions secrets",
		description: "Delete Actions secrets not declared in any referenced secret group",
		default: false,
	}),
	dependabot: cleanupScopeDefaultingToFalse.annotate({
		title: "Clean up Dependabot secrets",
		description: "Delete Dependabot secrets not declared in any referenced secret group",
		default: false,
	}),
	codespaces: cleanupScopeDefaultingToFalse.annotate({
		title: "Clean up Codespaces secrets",
		description: "Delete Codespaces secrets not declared in any referenced secret group",
		default: false,
	}),
	environments: cleanupScopeDefaultingToFalse.annotate({
		title: "Clean up environment secrets",
		description: "Delete environment secrets not declared in any referenced secret group",
		default: false,
	}),
}).annotate({
	identifier: "CleanupSecrets",
	title: "Secrets cleanup configuration",
	description: "Controls deletion of secrets by scope (Actions, Dependabot, Codespaces, environments).",
});

const CleanupVariablesSchema = Schema.Struct({
	actions: cleanupScopeDefaultingToFalse.annotate({
		title: "Clean up Actions variables",
		description: "Delete Actions variables not declared in any referenced variable group",
		default: false,
	}),
	environments: cleanupScopeDefaultingToFalse.annotate({
		title: "Clean up environment variables",
		description: "Delete environment variables not declared in any referenced variable group",
		default: false,
	}),
}).annotate({
	identifier: "CleanupVariables",
	title: "Variables cleanup configuration",
	description: "Controls deletion of variables by scope (Actions, environments).",
});

/**
 * Per-group cleanup configuration.
 *
 * @remarks
 * Everything defaults to disabled. Deleting resources a config does not declare
 * is destructive and opt-in at every level.
 *
 * @public
 */
export const CleanupSchema = Schema.Struct({
	secrets: CleanupSecretsSchema.pipe(
		Schema.withDecodingDefaultKey(
			Effect.succeed({
				actions: false as const,
				dependabot: false as const,
				codespaces: false as const,
				environments: false as const,
			}),
		),
	).annotate({
		title: "Secrets cleanup",
		description: "Controls cleanup of secrets by scope",
	}),
	variables: CleanupVariablesSchema.pipe(
		Schema.withDecodingDefaultKey(Effect.succeed({ actions: false as const, environments: false as const })),
	).annotate({
		title: "Variables cleanup",
		description: "Controls cleanup of variables by scope",
	}),
	rulesets: cleanupScopeDefaultingToFalse.annotate({
		title: "Clean up rulesets",
		description: "Delete repository rulesets not declared in any referenced ruleset group",
		default: false,
	}),
	environments: cleanupScopeDefaultingToFalse.annotate({
		title: "Clean up environments",
		description: "Delete repository environments not declared in config",
		default: false,
	}),
}).annotate({
	...taplo({ links: { key: docs("08-cleanup.md") } }),
	identifier: "Cleanup",
	title: "Cleanup configuration",
	description: "Controls deletion of resources not declared in config. All disabled by default.",
});

/**
 * The decoded shape of {@link CleanupSchema}.
 *
 * @public
 */
export type Cleanup = typeof CleanupSchema.Type;
