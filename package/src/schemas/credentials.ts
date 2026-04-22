import { Schema } from "effect";
import { Jsonifiable, taplo, tombi } from "xdg-effect";

export const ResolveSectionSchema = Schema.Struct({
	op: Schema.optional(
		Schema.Record({ key: Schema.String, value: Schema.String }).annotations({
			title: "1Password references",
			description: "Named values resolved via 1Password SDK. Values are op:// reference strings.",
			jsonSchema: tombi({ additionalKeyLabel: "label" }),
		}),
	),
	file: Schema.optional(
		Schema.Record({ key: Schema.String, value: Schema.String }).annotations({
			title: "File references",
			description: "Named values read from files. Values are file paths relative to the credentials directory.",
			jsonSchema: tombi({ additionalKeyLabel: "label" }),
		}),
	),
	value: Schema.optional(
		Schema.Record({
			key: Schema.String,
			value: Schema.Union(Schema.String, Schema.Record({ key: Schema.String, value: Jsonifiable })),
		}).annotations({
			title: "Inline values",
			description: "Named inline values. Strings are used as-is, objects are JSON-stringified.",
			jsonSchema: tombi({ additionalKeyLabel: "label" }),
		}),
	),
}).annotations({
	identifier: "ResolveSection",
	title: "Resolve section",
	description:
		"Named values resolved from 1Password, files, or inline. Referenced by resolved entries in secret and variable groups.",
	jsonSchema: taplo({
		links: { key: "https://github.com/spencerbeggs/reposets/blob/main/docs/credentials.md" },
	}),
});

export type ResolveSection = typeof ResolveSectionSchema.Type;

export const CredentialProfileSchema = Schema.Struct({
	github_token: Schema.String.annotations({
		title: "GitHub token",
		description:
			"A GitHub personal access token (fine-grained) with administration, secrets, variables, environments, and GPG keys permissions",
		examples: ["ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"],
	}),
	op_service_account_token: Schema.optional(
		Schema.String.annotations({
			title: "1Password service account token",
			description: "A 1Password service account token for resolving op:// secret references",
			examples: ["ops_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"],
		}),
	),
	resolve: Schema.optional(ResolveSectionSchema),
}).annotations({
	identifier: "CredentialProfile",
	title: "Credential profile",
	description:
		"Authentication credentials for a GitHub account with optional named values for secret and variable resolution",
	jsonSchema: taplo({
		initKeys: ["github_token"],
		links: { key: "https://github.com/spencerbeggs/reposets/blob/main/docs/credentials.md" },
	}),
});

export type CredentialProfile = typeof CredentialProfileSchema.Type;

export const CredentialsSchema = Schema.Struct({
	profiles: Schema.optionalWith(
		Schema.Record({ key: Schema.String, value: CredentialProfileSchema }).annotations({
			title: "Credential profiles",
			description:
				"Named credential profiles. If only one profile is defined, it is used automatically for all repo groups.",
			jsonSchema: tombi({ additionalKeyLabel: "profile_name" }),
		}),
		{ default: () => ({}) },
	),
}).annotations({
	identifier: "Credentials",
	title: "reposets Credentials",
	description: "Authentication profiles for reposets. This file should be gitignored.",
	jsonSchema: taplo({
		initKeys: ["profiles"],
		links: { key: "https://github.com/spencerbeggs/reposets/blob/main/docs/credentials.md" },
	}),
});

export type Credentials = typeof CredentialsSchema.Type;
