import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { Context, Effect, Layer } from "effect";
import { ResolveError } from "../errors.js";
import type { CredentialProfile } from "../schemas/credentials.js";
import { OnePasswordClient } from "./OnePasswordClient.js";

export interface CredentialResolverService {
	readonly resolveAll: (
		profile: CredentialProfile,
		basePath: string,
	) => Effect.Effect<Map<string, string>, ResolveError>;
}

export class CredentialResolver extends Context.Tag("CredentialResolver")<
	CredentialResolver,
	CredentialResolverService
>() {}

export const CredentialResolverLive = Layer.effect(
	CredentialResolver,
	Effect.gen(function* () {
		const opClient = yield* OnePasswordClient;

		return {
			resolveAll(profile: CredentialProfile, basePath: string) {
				return Effect.gen(function* () {
					const result = new Map<string, string>();
					const resolveSection = profile.resolve;
					if (!resolveSection) return result;

					// Resolve value entries (strings used as-is, objects JSON-stringified)
					if (resolveSection.value) {
						for (const [label, val] of Object.entries(resolveSection.value)) {
							if (typeof val === "string") {
								result.set(label, val);
							} else {
								result.set(label, JSON.stringify(val));
							}
						}
					}

					// Resolve file entries
					if (resolveSection.file) {
						for (const [label, filePath] of Object.entries(resolveSection.file)) {
							const fullPath = isAbsolute(filePath) ? filePath : resolve(basePath, filePath);
							const content = yield* Effect.try({
								try: () => readFileSync(fullPath, "utf-8").trim(),
								catch: (error) =>
									new ResolveError({
										message: `Failed to read file for label '${label}': ${error instanceof Error ? error.message : String(error)}`,
									}),
							});
							result.set(label, content);
						}
					}

					// Resolve op entries
					if (resolveSection.op) {
						const opToken = profile.op_service_account_token;
						if (!opToken) {
							return yield* Effect.fail(
								new ResolveError({
									message: "No 1Password service account token provided but resolve.op entries are defined",
								}),
							);
						}
						for (const [label, reference] of Object.entries(resolveSection.op)) {
							const value = yield* opClient.resolve(reference, opToken).pipe(
								Effect.mapError(
									(err) =>
										new ResolveError({
											message: `Failed to resolve label '${label}': ${err.message}`,
										}),
								),
							);
							result.set(label, value);
						}
					}

					return result;
				});
			},
		};
	}),
);
