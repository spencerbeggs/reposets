import { Effect, Schema } from "effect";
import { docs, taplo, tombi } from "./annotations.js";

const CREDENTIALS_DOCS = docs("04-credentials.md");

/**
 * A 1Password secret reference.
 *
 * @public
 */
export const OpReferenceSchema = Schema.Struct({
	op: Schema.String.annotate({
		title: "1Password reference",
		description: "An op:// secret reference, resolved through the 1Password SDK at run time",
		examples: ["op://Vault/item/field", "op://Vault/item/section/field"],
	}),
}).annotate({
	identifier: "OpReference",
	title: "1Password reference",
	description: "Resolved through the 1Password SDK using OP_SERVICE_ACCOUNT_TOKEN from the environment",
});

/**
 * An environment-variable reference.
 *
 * @public
 */
export const EnvReferenceSchema = Schema.Struct({
	env: Schema.String.annotate({
		title: "Environment variable",
		description: "The name of an environment variable holding the value",
		examples: ["REPOSETS_GITHUB_TOKEN"],
	}),
}).annotate({
	identifier: "EnvReference",
	title: "Environment variable reference",
	description: "For CI, where the platform's secret store injects the value",
});

/**
 * Where a credential comes from.
 *
 * @remarks
 * **Deliberately never an inline value.** A credentials file holds references,
 * not secrets: every variant here points somewhere else, so the file itself is
 * safe to read, back up, and sit in a terminal scrollback.
 *
 * `{ op }` is the intended form. `{ env }` exists for CI, where a platform
 * secret store injects the value and no 1Password service account is available.
 *
 * @public
 */
export const CredentialSourceSchema = Schema.Union([OpReferenceSchema, EnvReferenceSchema]).annotate({
	identifier: "CredentialSource",
	title: "Credential source",
	description: "Exactly one of op (1Password reference) or env (environment variable name)",
});

/**
 * The decoded shape of {@link CredentialSourceSchema}.
 *
 * @public
 */
export type CredentialSource = typeof CredentialSourceSchema.Type;

/**
 * Named values referenced by `resolved` secret and variable groups.
 *
 * @remarks
 * **`value` holds named values, not only secrets.** An earlier revision removed
 * it by generalising the token rule — `github_token` and the service-account
 * token are unambiguously credentials and must be references. This section is
 * not: real configs use it for structured, non-secret data such as an SBOM
 * supplier block or a registry list, and forcing those into 1Password buys no
 * security and costs a round trip.
 *
 * The rule that does hold: a *credential* is never inlined. That is enforced
 * where credentials are declared, not here.
 *
 * `file` and `env` are pointers — the value lives outside this file.
 *
 * @public
 */
export const ResolveSectionSchema = Schema.Struct({
	op: Schema.optional(
		Schema.Record(Schema.String, Schema.String).annotate({
			...tombi({ additionalKeyLabel: "label" }),
			title: "1Password references",
			description: "Named values resolved via the 1Password SDK. Values are op:// reference strings.",
		}),
	),
	env: Schema.optional(
		Schema.Record(Schema.String, Schema.String).annotate({
			...tombi({ additionalKeyLabel: "label" }),
			title: "Environment variable references",
			description: "Named values read from the environment. Values are variable names, not values.",
		}),
	),
	file: Schema.optional(
		Schema.Record(Schema.String, Schema.String).annotate({
			...tombi({ additionalKeyLabel: "label" }),
			title: "File references",
			description: "Named values read from files. Values are paths relative to the credentials directory.",
		}),
	),
	value: Schema.optional(
		Schema.Record(
			Schema.String,
			// A string is used as-is; an object is JSON-stringified before it is
			// sent. `Json` rather than `Unknown` so a value that cannot survive
			// serialisation is rejected at decode rather than at the API call.
			Schema.Union([Schema.String, Schema.Json]),
		).annotate({
			...tombi({ additionalKeyLabel: "label" }),
			title: "Inline values",
			description: "Named inline values. Strings are used as-is, objects are JSON-stringified.",
		}),
	),
}).annotate({
	...taplo({ links: { key: CREDENTIALS_DOCS } }),
	identifier: "ResolveSection",
	title: "Resolve section",
	description: "Named values resolved from 1Password, the environment, or files, for use by resolved groups",
});

/**
 * The decoded shape of {@link ResolveSectionSchema}.
 *
 * @public
 */
export type ResolveSection = typeof ResolveSectionSchema.Type;

/** Everything a profile carries apart from who it acts as. */
const profileFields = {
	github_token: CredentialSourceSchema.annotate({
		...taplo({ links: { key: CREDENTIALS_DOCS } }),
		title: "GitHub token",
		description:
			'Reference to a fine-grained personal access token. Never the token itself — use { op = "op://..." } or { env = "VAR" }.',
	}),
	resolve: Schema.optional(ResolveSectionSchema),
};

/**
 * A profile acting as a personal account.
 *
 * @remarks
 * `org` is forbidden rather than merely absent. A plain union of two structs
 * accepts a profile declaring **both** and silently drops the second — verified
 * against the installed beta — so the invalid state would be representable and
 * quietly resolved, which is the failure this shape exists to prevent.
 */
const UserProfileSchema = Schema.Struct({
	username: Schema.String.annotate({
		title: "GitHub username",
		description: "The personal account this profile acts as. Mutually exclusive with org.",
		examples: ["spencerbeggs"],
	}),
	org: Schema.optional(Schema.Never),
	...profileFields,
});

/** A profile acting within an organization. */
const OrgProfileSchema = Schema.Struct({
	org: Schema.String.annotate({
		title: "GitHub organization",
		description: "The organization this profile acts within. Mutually exclusive with username.",
		examples: ["savvy-web"],
	}),
	username: Schema.optional(Schema.Never),
	...profileFields,
});

/**
 * A named credential profile: who it acts as, and what it can resolve.
 *
 * @remarks
 * **The owner belongs here, not in the config.** A token authenticates as an
 * identity, so the account it acts on is a property of the credential rather
 * than of the repositories being configured. Declaring it as `username` or
 * `org` — two keys, not an `owner` plus an `owner_type` — makes an owner
 * without a type unrepresentable.
 *
 * The type is what makes `validate` able to reject an organization-only
 * construct without a network call: team-based ruleset actors, environment
 * team reviewers and `delegated_bypass_reviewers` all need an organization, and
 * before this the only way to learn the owner's type was to ask GitHub.
 *
 * **It is a declaration, not proof.** `sync` still verifies it against the API
 * before writing, because a wrong declaration would otherwise produce exactly
 * the 422 the gating exists to prevent.
 *
 * One owner per profile. A token reaching several owners is declared as several
 * profiles sharing a token reference — repetitive, but it keeps every group's
 * owner a single lookup with no fallback chain.
 *
 * @public
 */
export const CredentialProfileSchema = Schema.Union([UserProfileSchema, OrgProfileSchema]).annotate({
	...taplo({ initKeys: ["github_token"], links: { key: CREDENTIALS_DOCS } }),
	identifier: "CredentialProfile",
	title: "Credential profile",
	description: "Exactly one of username or org, a GitHub token reference, and any named values to resolve",
});

/**
 * The decoded shape of {@link CredentialProfileSchema}.
 *
 * @public
 */
export type CredentialProfile = typeof CredentialProfileSchema.Type;

/**
 * Who a profile acts as.
 *
 * @remarks
 * One reader for the two-key encoding, so no consumer re-derives the owner type
 * from which key happens to be present. The schema guarantees exactly one is
 * set, which is what lets this return a total value rather than an option.
 *
 * @public
 */
export const profileOwner = (
	profile: CredentialProfile,
): { readonly owner: string; readonly ownerType: "User" | "Organization" } =>
	"username" in profile && typeof profile.username === "string"
		? { owner: profile.username, ownerType: "User" }
		: { owner: (profile as { readonly org: string }).org, ownerType: "Organization" };

/**
 * `reposets.credentials.toml`.
 *
 * @remarks
 * **No credential is ever written to this file.** `github_token` is a reference,
 * and the 1Password service-account token is not in the schema at all.
 *
 * `resolve.value` can still hold an inline value, because that section is for
 * named values generally and its common use is non-secret structured data. So
 * this file is not categorically secret-free — it is *credential*-free, which is
 * the property that matters. Keep it out of version control regardless.
 *
 * @public
 */
export const CredentialsSchema = Schema.Struct({
	profiles: Schema.Record(Schema.String, CredentialProfileSchema)
		.annotate({
			...tombi({ additionalKeyLabel: "profile_name" }),
			title: "Credential profiles",
			description: "Named credential profiles. Every group names one explicitly in its `credentials` field.",
		})
		.pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
}).annotate({
	...taplo({ initKeys: ["profiles"], links: { key: CREDENTIALS_DOCS } }),
	identifier: "Credentials",
	title: "reposets Credentials",
	description: "Credential references for reposets. Contains no secret values.",
});

/**
 * The decoded shape of {@link CredentialsSchema}.
 *
 * @public
 */
export type Credentials = typeof CredentialsSchema.Type;
