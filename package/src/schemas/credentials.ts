import { Schema } from "effect";

export const CredentialProfileSchema = Schema.Struct({
	github_token: Schema.String.annotations({
		title: "GitHub token",
		description: "A GitHub personal access token (fine-grained) with repo administration and secrets permissions",
		examples: ["ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"],
	}),
	op_service_account_token: Schema.optional(
		Schema.String.annotations({
			title: "1Password service account token",
			description: "A 1Password service account token for resolving op:// secret references",
			examples: ["ops_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"],
		}),
	),
}).annotations({
	identifier: "CredentialProfile",
	title: "Credential profile",
	description: "Authentication credentials for a GitHub account and optional 1Password service account",
});

export type CredentialProfile = typeof CredentialProfileSchema.Type;

export const CredentialsSchema = Schema.Struct({
	profiles: Schema.optionalWith(
		Schema.Record({ key: Schema.String, value: CredentialProfileSchema }).annotations({
			title: "Credential profiles",
			description:
				"Named credential profiles. If only one profile is defined, it is used automatically for all repo groups.",
			jsonSchema: { "x-tombi-additional-key-label": "profile_name" },
		}),
		{ default: () => ({}) },
	),
}).annotations({
	identifier: "Credentials",
	title: "gh-sync Credentials",
	description: "Authentication profiles for gh-sync. This file should be gitignored.",
});

export type Credentials = typeof CredentialsSchema.Type;
