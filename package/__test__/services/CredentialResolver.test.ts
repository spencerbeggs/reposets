import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CredentialProfile } from "../../src/schemas/credentials.js";
import { CredentialResolver, CredentialResolverLive } from "../../src/services/CredentialResolver.js";
import { OnePasswordClientTest } from "../../src/services/OnePasswordClient.js";

describe("CredentialResolver", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `reposets-cr-test-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	function makeLayer(opStubs: Record<string, string> = {}) {
		const opLayer = OnePasswordClientTest(opStubs);
		return Layer.provide(CredentialResolverLive, opLayer);
	}

	it("resolves value entries", async () => {
		const profile: CredentialProfile = {
			github_token: "ghp_test",
			resolve: { value: { BOT_NAME: "mybot" } },
		};
		const layer = makeLayer();
		const program = Effect.gen(function* () {
			const resolver = yield* CredentialResolver;
			return yield* resolver.resolveAll(profile, tempDir);
		}).pipe(Effect.provide(layer));

		const result = await Effect.runPromise(program);
		expect(result.get("BOT_NAME")).toBe("mybot");
	});

	it("JSON-stringifies object values", async () => {
		const profile: CredentialProfile = {
			github_token: "ghp_test",
			resolve: {
				value: {
					REGS: { npm: "https://registry.npmjs.org" } as unknown as string,
				},
			},
		};
		const layer = makeLayer();
		const program = Effect.gen(function* () {
			const resolver = yield* CredentialResolver;
			return yield* resolver.resolveAll(profile, tempDir);
		}).pipe(Effect.provide(layer));

		const result = await Effect.runPromise(program);
		expect(result.get("REGS")).toBe('{"npm":"https://registry.npmjs.org"}');
	});

	it("resolves file entries", async () => {
		writeFileSync(join(tempDir, "secret.txt"), "file-value");
		const profile: CredentialProfile = {
			github_token: "ghp_test",
			resolve: { file: { MY_SECRET: "./secret.txt" } },
		};
		const layer = makeLayer();
		const program = Effect.gen(function* () {
			const resolver = yield* CredentialResolver;
			return yield* resolver.resolveAll(profile, tempDir);
		}).pipe(Effect.provide(layer));

		const result = await Effect.runPromise(program);
		expect(result.get("MY_SECRET")).toBe("file-value");
	});

	it("resolves op entries", async () => {
		const profile: CredentialProfile = {
			github_token: "ghp_test",
			op_service_account_token: "ops_test",
			resolve: { op: { APP_ID: "op://vault/item/field" } },
		};
		const layer = makeLayer({ "op://vault/item/field": "12345" });
		const program = Effect.gen(function* () {
			const resolver = yield* CredentialResolver;
			return yield* resolver.resolveAll(profile, tempDir);
		}).pipe(Effect.provide(layer));

		const result = await Effect.runPromise(program);
		expect(result.get("APP_ID")).toBe("12345");
	});

	it("merges all three sub-groups", async () => {
		writeFileSync(join(tempDir, "cert.pem"), "cert-data");
		const profile: CredentialProfile = {
			github_token: "ghp_test",
			op_service_account_token: "ops_test",
			resolve: {
				op: { APP_ID: "op://vault/app/id" },
				file: { CERT: "./cert.pem" },
				value: { NAME: "static" },
			},
		};
		const layer = makeLayer({ "op://vault/app/id": "999" });
		const program = Effect.gen(function* () {
			const resolver = yield* CredentialResolver;
			return yield* resolver.resolveAll(profile, tempDir);
		}).pipe(Effect.provide(layer));

		const result = await Effect.runPromise(program);
		expect(result.get("APP_ID")).toBe("999");
		expect(result.get("CERT")).toBe("cert-data");
		expect(result.get("NAME")).toBe("static");
	});

	it("returns empty map when no resolve section", async () => {
		const profile: CredentialProfile = { github_token: "ghp_test" };
		const layer = makeLayer();
		const program = Effect.gen(function* () {
			const resolver = yield* CredentialResolver;
			return yield* resolver.resolveAll(profile, tempDir);
		}).pipe(Effect.provide(layer));

		const result = await Effect.runPromise(program);
		expect(result.size).toBe(0);
	});
});
