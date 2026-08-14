import { env } from "node:process";
import { Context, Data, Effect, Layer, Redacted } from "effect";

/**
 * The environment variable the 1Password SDK is authenticated from.
 *
 * @public
 */
export const OP_SERVICE_ACCOUNT_TOKEN = "OP_SERVICE_ACCOUNT_TOKEN";

/**
 * A 1Password reference could not be resolved.
 *
 * @remarks
 * Carries the `op://` **reference** — an address, safe to print — and never the
 * value it points at. `reason` holds the SDK's own diagnostic, which describes
 * why a lookup failed rather than what it would have returned.
 *
 * @public
 */
export class OnePasswordError extends Data.TaggedError("OnePasswordError")<{
	/** The `op://` address that failed. Safe to log. */
	readonly reference: string;
	/** Why it failed. Never the resolved value. */
	readonly reason: string;
}> {
	override get message(): string {
		return `Failed to resolve ${this.reference}: ${this.reason}`;
	}
}

/**
 * The 1Password operations reposets needs.
 *
 * @public
 */
export interface OnePasswordClientShape {
	/**
	 * Resolve one `op://` reference.
	 *
	 * @remarks
	 * The service account token is the service's own concern — read from
	 * {@link OP_SERVICE_ACCOUNT_TOKEN} — not a parameter threaded from the caller.
	 */
	readonly resolve: (reference: string) => Effect.Effect<Redacted.Redacted<string>, OnePasswordError>;
}

/** Read the service account token, failing in terms of the reference that needed it. */
const serviceAccountToken = (reference: string): Effect.Effect<string, OnePasswordError> =>
	Effect.suspend(() => {
		const token = env[OP_SERVICE_ACCOUNT_TOKEN];
		return token === undefined || token === ""
			? Effect.fail(
					new OnePasswordError({
						reference,
						reason: `${OP_SERVICE_ACCOUNT_TOKEN} is not set in the environment`,
					}),
				)
			: Effect.succeed(token);
	});

/**
 * Resolves `op://` references through the 1Password SDK.
 *
 * @remarks
 * Resolved values come back as {@link Redacted.Redacted}. That is the point of
 * this service's return type rather than a convention: a redacted value renders
 * as `<redacted>` through `toString`, template interpolation and
 * `JSON.stringify`, so a secret cannot reach a log line or an error message by
 * being accidentally formatted. Reading it requires `Redacted.value`, which is
 * greppable.
 *
 * The service account token is read from the environment at call time, not
 * taken as a parameter and not read from the credentials file. It authenticates
 * the SDK that resolves everything else, so keeping it beside the references it
 * unlocks would put the one credential that opens all the others in the file
 * those others merely point out of. Reading it lazily also means a config with
 * no `op` entries never needs it.
 *
 * @public
 */
export class OnePasswordClient extends Context.Service<OnePasswordClient, OnePasswordClientShape>()(
	"reposets/OnePasswordClient",
	{
		make: Effect.succeed({
			resolve: (reference: string) =>
				Effect.gen(function* () {
					const token = yield* serviceAccountToken(reference);
					// A fresh SDK client per reference, as v3 did. See the note on
					// `OnePasswordClientLive` — this is a known cost, kept deliberately.
					const value = yield* Effect.tryPromise({
						try: async () => {
							const { createClient } = await import("@1password/sdk");
							const client = await createClient({
								auth: token,
								integrationName: "reposets",
								integrationVersion: "1.0.0",
							});
							return await client.secrets.resolve(reference);
						},
						catch: (error) =>
							new OnePasswordError({
								reference,
								reason: error instanceof Error ? error.message : String(error),
							}),
					});
					return Redacted.make(value, { label: reference });
				}),
		} satisfies OnePasswordClientShape),
	},
) {
	/**
	 * A double over a fixed reference → value table.
	 *
	 * @remarks
	 * An unknown reference fails exactly as a missing 1Password item does, so a
	 * test can exercise the not-found path without a vault.
	 */
	static readonly layerTest = (stubs: Readonly<Record<string, string>>): Layer.Layer<OnePasswordClient> =>
		Layer.succeed(OnePasswordClient, {
			resolve: (reference) => {
				const value = stubs[reference];
				return value === undefined
					? Effect.fail(new OnePasswordError({ reference, reason: "no item found at that reference" }))
					: Effect.succeed(Redacted.make(value, { label: reference }));
			},
		});
}

/**
 * Live 1Password client.
 *
 * @remarks
 * **Builds one SDK client per reference resolved**, which means one
 * authentication handshake per secret rather than one per run. That is v3's
 * behaviour, ported unchanged rather than quietly improved; a profile with
 * twenty `op` entries pays for it twenty times. Memoising the client is the
 * obvious fix and a deliberate follow-up, not an oversight.
 *
 * @public
 */
export const OnePasswordClientLive: Layer.Layer<OnePasswordClient> = Layer.effect(
	OnePasswordClient,
	OnePasswordClient.make,
);
