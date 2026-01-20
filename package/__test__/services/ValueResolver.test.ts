import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OnePasswordClientTest } from "../../src/services/OnePasswordClient.js";
import { ValueResolver, ValueResolverLive } from "../../src/services/ValueResolver.js";

describe("ValueResolver", () => {
	let tempDir: string;

	const opStubs = OnePasswordClientTest({
		"op://vault/item/field": "op-resolved-value",
	});

	const testLayer = Layer.provide(ValueResolverLive, opStubs);

	beforeEach(() => {
		tempDir = join(tmpdir(), `gh-sync-vr-test-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("resolves file source", async () => {
		writeFileSync(join(tempDir, "secret.txt"), "file-secret-value");

		const program = Effect.gen(function* () {
			const resolver = yield* ValueResolver;
			return yield* resolver.resolve({ file: "./secret.txt" }, tempDir);
		}).pipe(Effect.provide(testLayer));

		const result = await Effect.runPromise(program);
		expect(result).toBe("file-secret-value");
	});

	it("resolves value source", async () => {
		const program = Effect.gen(function* () {
			const resolver = yield* ValueResolver;
			return yield* resolver.resolve({ value: "inline-secret" }, tempDir);
		}).pipe(Effect.provide(testLayer));

		const result = await Effect.runPromise(program);
		expect(result).toBe("inline-secret");
	});

	it("resolves json source", async () => {
		const program = Effect.gen(function* () {
			const resolver = yield* ValueResolver;
			return yield* resolver.resolve({ json: { foo: "bar", baz: 123 } }, tempDir);
		}).pipe(Effect.provide(testLayer));

		const result = await Effect.runPromise(program);
		expect(result).toBe(JSON.stringify({ foo: "bar", baz: 123 }));
	});

	it("resolves op source", async () => {
		const program = Effect.gen(function* () {
			const resolver = yield* ValueResolver;
			return yield* resolver.resolve({ op: "op://vault/item/field" }, tempDir, "fake-token");
		}).pipe(Effect.provide(testLayer));

		const result = await Effect.runPromise(program);
		expect(result).toBe("op-resolved-value");
	});

	it("fails for missing file", async () => {
		const program = Effect.gen(function* () {
			const resolver = yield* ValueResolver;
			return yield* resolver.resolve({ file: "./missing.txt" }, tempDir);
		}).pipe(Effect.provide(testLayer));

		const exit = await Effect.runPromiseExit(program);
		expect(exit._tag).toBe("Failure");
	});

	it("fails for op source without token", async () => {
		const program = Effect.gen(function* () {
			const resolver = yield* ValueResolver;
			return yield* resolver.resolve({ op: "op://vault/item/field" }, tempDir);
		}).pipe(Effect.provide(testLayer));

		const exit = await Effect.runPromiseExit(program);
		expect(exit._tag).toBe("Failure");
	});
});
