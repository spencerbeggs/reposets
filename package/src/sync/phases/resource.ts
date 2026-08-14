import { readFileSync } from "node:fs";
import { isAbsolute, resolve as resolvePath } from "node:path";
import { Effect, Redacted } from "effect";
import type { SecretGroup, VariableGroup } from "../../schemas/common.js";
import type { RepoContext } from "../phase.js";

/** A resolved resource group: names to values, values still redacted. */
export type ResolvedEntries = ReadonlyMap<string, Redacted.Redacted<string>>;

/** One failure, in the shape a `PhaseResult` carries. */
export interface ResolveFailure {
	readonly context: string;
	readonly message: string;
}

/** What resolving a set of groups produced. */
export interface ResolveOutcome {
	readonly entries: ResolvedEntries;
	readonly errors: ReadonlyArray<ResolveFailure>;
}

/**
 * Resolve one secret or variable group into named values.
 *
 * @remarks
 * The three kinds are exclusive by schema, so this branches once rather than
 * merging. Values come back {@link Redacted.Redacted} regardless of kind — a
 * variable is not secret, but a uniform return type means no call site has to
 * decide, and unwrapping stays a deliberate `Redacted.value` at the write.
 *
 * `value` entries may be a string or arbitrary JSON. A string is used as-is and
 * anything else is `JSON.stringify`d, which is what v3 did and what the config
 * schema's `string | Json` implies — GitHub stores a string either way.
 *
 * `file` paths resolve against `ctx.configDir` — the directory the config was
 * loaded from, threaded by the engine — never against the working directory. A
 * relative path resolved against `cwd` would read a different file depending on
 * where the CLI happened to be invoked, silently, and into a secret.
 *
 * A file that cannot be read is reported with its **path**, never its contents:
 * this runs on the secret-loading path, and the error is the most likely thing
 * to reach a log.
 */
const resolveOne = (group: SecretGroup | VariableGroup, label: string, ctx: RepoContext): ResolveOutcome => {
	const entries = new Map<string, Redacted.Redacted<string>>();
	const errors: ResolveFailure[] = [];

	if ("value" in group) {
		for (const [name, value] of Object.entries(group.value)) {
			entries.set(name, Redacted.make(typeof value === "string" ? value : JSON.stringify(value), { label: name }));
		}
		return { entries, errors };
	}

	if ("resolved" in group) {
		for (const [name, credentialLabel] of Object.entries(group.resolved)) {
			const value = ctx.credentials.get(credentialLabel);
			if (value === undefined) {
				errors.push({
					context: `${label}.${name}`,
					// The label is an address into the credentials file, not a secret.
					message: `credential label '${credentialLabel}' is not defined in the active profile's [resolve] section`,
				});
				continue;
			}
			entries.set(name, value);
		}
		return { entries, errors };
	}

	for (const [name, filePath] of Object.entries(group.file)) {
		const fullPath = isAbsolute(filePath) ? filePath : resolvePath(ctx.configDir, filePath);
		try {
			entries.set(name, Redacted.make(readFileSync(fullPath, "utf-8").trim(), { label: name }));
		} catch (error) {
			errors.push({
				context: `${label}.${name}`,
				// The fs error names the path; it never carries file contents.
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return { entries, errors };
};

/**
 * Resolve every group a scope references, later groups winning.
 *
 * @remarks
 * Last-write-wins across groups matches how every other referenced section
 * composes. A reference with no matching definition is skipped rather than
 * reported — `danglingReferences` owns cross-reference checking, and duplicating
 * it here would report one mistake twice with less context.
 *
 * @public
 */
export const resolveGroups = (
	refs: ReadonlyArray<string>,
	definitions: Readonly<Record<string, SecretGroup | VariableGroup>>,
	ctx: RepoContext,
): ResolveOutcome => {
	const entries = new Map<string, Redacted.Redacted<string>>();
	const errors: ResolveFailure[] = [];

	for (const ref of refs) {
		const group = definitions[ref];
		if (group === undefined) continue;
		const outcome = resolveOne(group, ref, ctx);
		for (const [name, value] of outcome.entries) entries.set(name, value);
		errors.push(...outcome.errors);
	}

	return { entries, errors };
};

/**
 * The names a set of groups declares, without resolving any value.
 *
 * @remarks
 * `cleanup` needs to know *which* names a config declares so it can delete the
 * rest. It has no use for the values, and reading them would be actively wrong:
 * a `{ file }` group would open every secret file — on the path whose whole job
 * is deletion — and a missing file would report an error about a resource
 * cleanup was only ever going to keep.
 *
 * All three kinds carry their names as keys, so the names are available without
 * touching a filesystem or a credential.
 *
 * @public
 */
export const declaredNames = (
	refs: ReadonlyArray<string>,
	definitions: Readonly<Record<string, SecretGroup | VariableGroup>>,
): ReadonlySet<string> => {
	const names = new Set<string>();
	for (const ref of refs) {
		const group = definitions[ref];
		if (group === undefined) continue;
		const entries = "value" in group ? group.value : "resolved" in group ? group.resolved : group.file;
		for (const name of Object.keys(entries)) names.add(name);
	}
	return names;
};

/**
 * Read something, keeping the failure's own words if it fails.
 *
 * @remarks
 * The alternative — `Effect.orElseSucceed(() => Option.none())` — discards a
 * structured `GitHubError` and leaves the call site inventing a generic string.
 * A real run showed why that matters: a 403 from a mis-scoped token, a 404 for
 * a deleted repository and a network failure all printed "could not read
 * current state", which tells a user nothing about what to do. `GitHubError`
 * already carries `kind`, `status` and `reason`, and its `message` renders
 * them; this keeps that instead of throwing it away.
 *
 * @public
 */
export const read = <A, E extends { readonly message?: string }, R = never>(
	effect: Effect.Effect<A, E, R>,
): Effect.Effect<{ readonly value: A } | { readonly failed: string }, never, R> =>
	effect.pipe(
		Effect.map((value) => ({ value }) as { readonly value: A } | { readonly failed: string }),
		Effect.catch((error: E) => Effect.succeed({ failed: error.message ?? String(error) })),
	);

/**
 * Wrap an operation so a failure becomes a reportable error rather than a
 * failed run.
 *
 * @public
 */
export const capture = <A, E extends { readonly message?: string }, R = never>(
	context: string,
	effect: Effect.Effect<A, E, R>,
): Effect.Effect<ResolveFailure | undefined, never, R> =>
	effect.pipe(
		Effect.as(undefined as ResolveFailure | undefined),
		Effect.catch((error: E) => Effect.succeed({ context, message: error.message ?? String(error) })),
	);
