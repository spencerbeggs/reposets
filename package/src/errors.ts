import { Data } from "effect";

export class ConfigError extends Data.TaggedError("ConfigError")<{
	readonly message: string;
}> {}

export class CredentialsError extends Data.TaggedError("CredentialsError")<{
	readonly message: string;
}> {}

export class ResolveError extends Data.TaggedError("ResolveError")<{
	readonly message: string;
}> {}

export class OnePasswordError extends Data.TaggedError("OnePasswordError")<{
	readonly message: string;
}> {}

export class GitHubApiError extends Data.TaggedError("GitHubApiError")<{
	readonly message: string;
	readonly status?: number;
}> {}

export class SyncError extends Data.TaggedError("SyncError")<{
	readonly message: string;
}> {}
