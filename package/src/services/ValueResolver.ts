import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { Context, Effect, Layer } from "effect";
import { ResolveError } from "../errors.js";
import type { ValueSource } from "../schemas/common.js";
import { OnePasswordClient } from "./OnePasswordClient.js";

export interface ValueResolverService {
	readonly resolve: (source: ValueSource, basePath: string, opToken?: string) => Effect.Effect<string, ResolveError>;
}

export class ValueResolver extends Context.Tag("ValueResolver")<ValueResolver, ValueResolverService>() {}

export const ValueResolverLive = Layer.effect(
	ValueResolver,
	Effect.gen(function* () {
		const opClient = yield* OnePasswordClient;

		return {
			resolve(source: ValueSource, basePath: string, opToken?: string) {
				if ("file" in source) {
					return Effect.try({
						try: () => {
							const filePath = isAbsolute(source.file) ? source.file : resolve(basePath, source.file);
							return readFileSync(filePath, "utf-8").trim();
						},
						catch: (error) =>
							new ResolveError({
								message: `Failed to read file ${source.file}: ${error instanceof Error ? error.message : String(error)}`,
							}),
					});
				}

				if ("value" in source) {
					return Effect.succeed(source.value);
				}

				if ("json" in source) {
					return Effect.try({
						try: () => JSON.stringify(source.json),
						catch: (error) =>
							new ResolveError({
								message: `Failed to serialize JSON: ${error instanceof Error ? error.message : String(error)}`,
							}),
					});
				}

				if ("op" in source) {
					if (!opToken) {
						return Effect.fail(
							new ResolveError({
								message: `No 1Password service account token provided for ${source.op}`,
							}),
						);
					}
					return opClient.resolve(source.op, opToken).pipe(
						Effect.mapError(
							(err) =>
								new ResolveError({
									message: err.message,
								}),
						),
					);
				}

				return Effect.fail(new ResolveError({ message: "Unknown value source type" }));
			},
		};
	}),
);
