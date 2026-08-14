import { readFileSync } from "node:fs";
import { isAbsolute, resolve as resolvePath } from "node:path";
import { env } from "node:process";
import { Context, Data, Effect, Layer, Redacted } from "effect";
import type { CredentialProfile, CredentialSourceSchema } from "../schemas/credentials.js";
import { OnePasswordClient } from "./OnePasswordClient.js";

/**
 * Where one credential comes from.
 *
 * @remarks
 * Derived here rather than imported: `credentials.ts` exports
 * `CredentialSourceSchema` but not its `.Type`, unlike every sibling in that
 * module (`ResolveSection`, `CredentialProfile`, `Credentials` all export
 * both). Deriving it locally avoids editing that file for a one-line export.
 */
type CredentialSource = typeof CredentialSourceSchema.Type;

/**
 * A credential could not be resolved.
 *
 * @remarks
 * Every field is an **address**, never a value: the label a config refers to,
 * the kind of source it named, and why that source did not yield anything. A
 * file's contents, an environment variable's value and a 1Password item's value
 * are all deliberately absent — this error is the most likely thing to be
 * printed when credential handling goes wrong, which makes it the most likely
 * place to leak.
 *
 * @public
 */
export class ResolveError extends Data.TaggedError("ResolveError")<{
	/** The label from the config's `resolve` section, or `github_token`. */
	readonly label: string;
	/** Which sub-group named it. */
	readonly source: "op" | "env" | "file";
	/** Why it failed. Never the resolved value. */
	readonly reason: string;
}> {
	override get message(): string {
		return `Failed to resolve '${this.label}' from ${this.source}: ${this.reason}`;
	}
}

/**
 * Credential resolution.
 *
 * @public
 */
export interface CredentialResolverShape {
	/**
	 * Resolve a profile's GitHub token from its reference.
	 *
	 * @remarks
	 * The schema stores `{ op }` or `{ env }` and never the token itself, so
	 * turning that reference into a usable credential is this layer's job.
	 */
	readonly resolveGitHubToken: (profile: CredentialProfile) => Effect.Effect<Redacted.Redacted<string>, ResolveError>;
	/**
	 * Resolve every label in a profile's `resolve` section.
	 *
	 * @remarks
	 * `basePath` is the directory `file` entries are taken relative to — the
	 * **config** file's directory, which is what `SyncEngine` passes and what
	 * `config-format.md` documents. This said "the credentials file's own
	 * directory" and was wrong; a `[resolve].file` path resolves beside
	 * `reposets.config.toml`, and reading the wrong file silently is expensive.
	 */
	readonly resolveAll: (
		profile: CredentialProfile,
		basePath: string,
	) => Effect.Effect<ReadonlyMap<string, Redacted.Redacted<string>>, ResolveError>;
}

/** Read an environment variable, failing in terms of its name. */
const fromEnv = (label: string, variable: string): Effect.Effect<Redacted.Redacted<string>, ResolveError> =>
	Effect.suspend(() => {
		const value = env[variable];
		return value === undefined
			? Effect.fail(new ResolveError({ label, source: "env", reason: `environment variable ${variable} is not set` }))
			: Effect.succeed(Redacted.make(value, { label }));
	});

/** Read a file, failing in terms of its path. */
const fromFile = (
	label: string,
	filePath: string,
	basePath: string,
): Effect.Effect<Redacted.Redacted<string>, ResolveError> =>
	Effect.try({
		try: () => {
			const fullPath = isAbsolute(filePath) ? filePath : resolvePath(basePath, filePath);
			return Redacted.make(readFileSync(fullPath, "utf-8").trim(), { label });
		},
		catch: (error) =>
			// The fs error names the path, never the contents.
			new ResolveError({
				label,
				source: "file",
				reason: error instanceof Error ? error.message : String(error),
			}),
	});

/**
 * Turns the references in a credential profile into usable values.
 *
 * @remarks
 * Everything this service returns is {@link Redacted.Redacted}. A redacted value
 * renders as `<redacted>` through `toString`, template interpolation and
 * `JSON.stringify`, so the common ways a secret escapes — a log line, an error
 * message, a serialised object — are closed structurally rather than by
 * discipline. Reading the plaintext takes `Redacted.value`, which greps.
 *
 * All four `resolve` sub-groups are read: `op`, `env`, `file` and `value`.
 *
 * This docstring used to say the opposite — that `value` had been dropped from
 * the section — and the implementation matched the docstring rather than the
 * schema. That decision *was* made and then reversed: `value` holds named values
 * generally, and its common use is non-secret structured data, so the rule that
 * survived is narrower than "no inline anything". A *credential* is never
 * inlined, and that is enforced on `github_token`.
 *
 * The cost of the disagreement: every inline label resolved to nothing, and its
 * consumers reported that the label "is not defined in the active profile's
 * `[resolve]` section" — about a label that was declared and simply never read.
 * A schema and a docstring disagreed, and the code followed the docstring.
 *
 * @public
 */
export class CredentialResolver extends Context.Service<CredentialResolver, CredentialResolverShape>()(
	"reposets/CredentialResolver",
	{
		make: Effect.gen(function* () {
			const onePassword = yield* OnePasswordClient;

			/** One `op://` reference, with 1Password's failure restated in this service's terms. */
			const fromOnePassword = (
				label: string,
				reference: string,
			): Effect.Effect<Redacted.Redacted<string>, ResolveError> =>
				onePassword
					.resolve(reference)
					.pipe(Effect.mapError((error) => new ResolveError({ label, source: "op", reason: error.message })));

			const fromSource = (
				label: string,
				source: CredentialSource,
			): Effect.Effect<Redacted.Redacted<string>, ResolveError> =>
				"op" in source ? fromOnePassword(label, source.op) : fromEnv(label, source.env);

			return {
				resolveGitHubToken: (profile) => fromSource("github_token", profile.github_token),

				resolveAll: (profile, basePath) =>
					Effect.gen(function* () {
						const resolved = new Map<string, Redacted.Redacted<string>>();
						const section = profile.resolve;
						if (section === undefined) return resolved;

						// Order is op, env, file, value — the order the schema declares
						// them. Labels are unique per sub-group but not across them; a
						// label in two sub-groups resolves to the last one written, as
						// v3's single map did.
						for (const [label, reference] of Object.entries(section.op ?? {})) {
							resolved.set(label, yield* fromOnePassword(label, reference));
						}
						for (const [label, variable] of Object.entries(section.env ?? {})) {
							resolved.set(label, yield* fromEnv(label, variable));
						}
						for (const [label, filePath] of Object.entries(section.file ?? {})) {
							resolved.set(label, yield* fromFile(label, filePath, basePath));
						}
						// `value` was missing here, so every inline label resolved to
						// nothing and its consumers were told the label "is not defined
						// in the active profile's [resolve] section" — which named the
						// wrong file and the wrong mistake, since the label was declared
						// and simply never read.
						//
						// No failure path: an inline value cannot fail to resolve, which
						// is why `ResolveError.source` has no `value` member.
						for (const [label, value] of Object.entries(section.value ?? {})) {
							// Strings as-is, objects JSON-stringified — the same rule the
							// `value` kind of a secret or variable group follows, because
							// a label feeding one of those must arrive in the same shape.
							resolved.set(label, Redacted.make(typeof value === "string" ? value : JSON.stringify(value), { label }));
						}

						return resolved;
					}),
			} satisfies CredentialResolverShape;
		}),
	},
) {}

/**
 * Live resolver, over the ambient {@link OnePasswordClient}.
 *
 * @public
 */
export const CredentialResolverLive: Layer.Layer<CredentialResolver, never, OnePasswordClient> = Layer.effect(
	CredentialResolver,
	CredentialResolver.make,
);
