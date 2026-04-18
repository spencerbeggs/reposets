import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { OnePasswordClient, OnePasswordClientTest } from "../../src/services/OnePasswordClient.js";

describe("OnePasswordClient", () => {
	describe("Test implementation", () => {
		const testLayer = OnePasswordClientTest({
			"op://vault/item/field": "resolved-secret-value",
			"op://vault/other/field": "other-value",
		});

		it("resolves known reference", async () => {
			const program = Effect.gen(function* () {
				const client = yield* OnePasswordClient;
				return yield* client.resolve("op://vault/item/field", "fake-token");
			}).pipe(Effect.provide(testLayer));

			const result = await Effect.runPromise(program);
			expect(result).toBe("resolved-secret-value");
		});

		it("fails for unknown reference", async () => {
			const program = Effect.gen(function* () {
				const client = yield* OnePasswordClient;
				return yield* client.resolve("op://vault/missing/field", "fake-token");
			}).pipe(Effect.provide(testLayer));

			const exit = await Effect.runPromiseExit(program);
			expect(exit._tag).toBe("Failure");
		});
	});
});
