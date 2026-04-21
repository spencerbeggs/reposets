import { Context, Effect, Layer } from "effect";
import { OnePasswordError } from "../errors.js";

export interface OnePasswordClientService {
	readonly resolve: (reference: string, serviceAccountToken: string) => Effect.Effect<string, OnePasswordError>;
}

export class OnePasswordClient extends Context.Tag("OnePasswordClient")<
	OnePasswordClient,
	OnePasswordClientService
>() {}

/* v8 ignore start -- live 1Password SDK calls, tested via OnePasswordClientTest */
export const OnePasswordClientLive = Layer.succeed(OnePasswordClient, {
	resolve(reference: string, serviceAccountToken: string) {
		return Effect.tryPromise({
			try: async () => {
				const { createClient } = await import("@1password/sdk");
				const client = await createClient({
					auth: serviceAccountToken,
					integrationName: "reposets",
					integrationVersion: "1.0.0",
				});
				return await client.secrets.resolve(reference);
			},
			catch: (error) =>
				new OnePasswordError({
					message: `Failed to resolve ${reference}: ${error instanceof Error ? error.message : String(error)}`,
				}),
		});
	},
});
/* v8 ignore stop */

export function OnePasswordClientTest(stubs: Record<string, string>): Layer.Layer<OnePasswordClient> {
	return Layer.succeed(OnePasswordClient, {
		resolve(reference: string, _serviceAccountToken: string) {
			const value = stubs[reference];
			if (value === undefined) {
				return Effect.fail(
					new OnePasswordError({
						message: `Test stub: unknown reference ${reference}`,
					}),
				);
			}
			return Effect.succeed(value);
		},
	});
}
