import { Effect, Exit, Redacted } from "effect";
import { describe, expect, it } from "vitest";
import type { OnePasswordError } from "../../src/services/OnePasswordClient.js";
import { OnePasswordClient } from "../../src/services/OnePasswordClient.js";

const testLayer = OnePasswordClient.layerTest({
	"op://vault/item/field": "resolved-secret-value",
	"op://vault/other/field": "other-value",
});

const resolve = (reference: string): Promise<Exit.Exit<Redacted.Redacted<string>, OnePasswordError>> =>
	Effect.runPromiseExit(
		Effect.flatMap(OnePasswordClient, (client) => client.resolve(reference)).pipe(Effect.provide(testLayer)),
	);

describe("OnePasswordClient", () => {
	it("resolves a known reference", async () => {
		const exit = await resolve("op://vault/item/field");
		expect(Exit.isSuccess(exit)).toBe(true);
		if (Exit.isSuccess(exit)) {
			expect(Redacted.value(exit.value)).toBe("resolved-secret-value");
		}
	});

	it("fails for an unknown reference", async () => {
		const exit = await resolve("op://vault/missing/field");
		expect(Exit.isFailure(exit)).toBe(true);
	});

	it("names the reference in its failure, because an address is safe to print", async () => {
		const exit = await resolve("op://vault/missing/field");
		expect(JSON.stringify(exit)).toContain("op://vault/missing/field");
	});
});

/**
 * The hazard tests. A resolved credential must not reach a log line, an error
 * message, or a thrown value — and the ways it would get there are all
 * *formatting*, so these assert on rendered output rather than on structure.
 */
describe("OnePasswordClient does not leak resolved values", () => {
	const SECRET = "resolved-secret-value";

	it("renders as <redacted> rather than the value", async () => {
		const exit = await resolve("op://vault/item/field");
		if (!Exit.isSuccess(exit)) throw new Error("expected success");

		expect(String(exit.value)).not.toContain(SECRET);
		expect(`${exit.value}`).not.toContain(SECRET);
		expect(JSON.stringify(exit.value)).not.toContain(SECRET);
		expect(JSON.stringify({ token: exit.value })).not.toContain(SECRET);
		// It renders as something useful, not as an empty string that would hide
		// the omission.
		expect(String(exit.value)).toContain("redacted");
	});

	it("keeps the value out of a serialised Exit", async () => {
		const exit = await resolve("op://vault/item/field");
		// The whole Exit is what a naive failure handler or a debug dump prints.
		expect(JSON.stringify(exit)).not.toContain(SECRET);
	});

	it("still yields the real value through Redacted.value", async () => {
		const exit = await resolve("op://vault/item/field");
		if (!Exit.isSuccess(exit)) throw new Error("expected success");
		// The guard must be a formatting guard, not a data-loss bug.
		expect(Redacted.value(exit.value)).toBe(SECRET);
	});
});
