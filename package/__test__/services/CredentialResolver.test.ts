import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit, Layer, Redacted } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CredentialProfile } from "../../src/schemas/credentials.js";
import { CredentialResolver, CredentialResolverLive } from "../../src/services/CredentialResolver.js";
import { OnePasswordClient } from "../../src/services/OnePasswordClient.js";

/**
 * These tests are written against the **new** credentials schema:
 * `github_token` is a reference rather than a string, `op_service_account_token`
 * does not exist, and the `resolve` section has `op` / `env` / `file` but no
 * `value`. The v3 suite's `value` and threaded-token assertions are gone
 * because the things they asserted are gone.
 */

let tempDir: string;

beforeEach(() => {
	tempDir = join(tmpdir(), `reposets-cr-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
	rmSync(tempDir, { recursive: true, force: true });
});

const layerWith = (opStubs: Readonly<Record<string, string>> = {}): Layer.Layer<CredentialResolver> =>
	Layer.provide(CredentialResolverLive, OnePasswordClient.layerTest(opStubs));

const resolveAll = (
	profile: CredentialProfile,
	opStubs: Readonly<Record<string, string>> = {},
): Promise<Exit.Exit<ReadonlyMap<string, Redacted.Redacted<string>>, unknown>> =>
	Effect.runPromiseExit(
		Effect.flatMap(CredentialResolver, (r) => r.resolveAll(profile, tempDir)).pipe(Effect.provide(layerWith(opStubs))),
	);

/** Read a resolved label's plaintext, failing the test if it is absent. */
const plaintext = (
	exit: Exit.Exit<ReadonlyMap<string, Redacted.Redacted<string>>, unknown>,
	label: string,
): string | undefined => {
	if (!Exit.isSuccess(exit)) throw new Error(`expected success, got ${JSON.stringify(exit)}`);
	const value = exit.value.get(label);
	return value === undefined ? undefined : Redacted.value(value);
};

const OP_PROFILE: CredentialProfile = {
	username: "tester",
	github_token: { op: "op://vault/gh/token" },
	resolve: { op: { APP_ID: "op://vault/item/field" } },
};

describe("resolveAll", () => {
	it("resolves op entries", async () => {
		const exit = await resolveAll(OP_PROFILE, { "op://vault/item/field": "12345" });
		expect(plaintext(exit, "APP_ID")).toBe("12345");
	});

	// The `value` sub-group had no coverage at all, and `resolveAll` iterated
	// only op, env and file — so every inline label resolved to nothing, and its
	// consumers reported `credential label 'X' is not defined in the active
	// profile's [resolve] section` about a label that was declared and simply
	// never read. Found by a real config, not by this suite.
	it("resolves inline value entries", async () => {
		const exit = await resolveAll({
			username: "tester",
			github_token: { env: "GH" },
			resolve: { value: { REGISTRIES: "a,b" } },
		});
		expect(plaintext(exit, "REGISTRIES")).toBe("a,b");
	});

	it("JSON-stringifies a structured inline value", async () => {
		// The same rule the `value` kind of a secret or variable group follows: a
		// label feeding one of those has to arrive in the same shape, or the two
		// paths disagree about what an object means.
		const exit = await resolveAll({
			username: "tester",
			github_token: { env: "GH" },
			resolve: { value: { SBOM: { supplier: { name: "acme" } } } },
		});
		expect(plaintext(exit, "SBOM")).toBe('{"supplier":{"name":"acme"}}');
	});

	it("resolves every sub-group in one pass", async () => {
		// A profile using all four at once, because the defect was an omission in
		// a list and only a case that exercises the whole list can catch the next
		// one.
		writeFileSync(join(tempDir, "cert.pem"), "CERTBYTES");
		process.env.REPOSETS_TEST_ALL = "envvalue";
		try {
			const exit = await resolveAll(
				{
					username: "tester",
					github_token: { env: "GH" },
					resolve: {
						op: { A: "op://vault/item/field" },
						env: { B: "REPOSETS_TEST_ALL" },
						file: { C: "./cert.pem" },
						value: { D: "inline" },
					},
				},
				{ "op://vault/item/field": "opvalue" },
			);
			expect(plaintext(exit, "A")).toBe("opvalue");
			expect(plaintext(exit, "B")).toBe("envvalue");
			expect(plaintext(exit, "C")).toBe("CERTBYTES");
			expect(plaintext(exit, "D")).toBe("inline");
		} finally {
			delete process.env.REPOSETS_TEST_ALL;
		}
	});

	it("resolves env entries", async () => {
		process.env.REPOSETS_TEST_ENV_LABEL = "from-environment";
		try {
			const exit = await resolveAll({
				username: "tester",
				github_token: { env: "GH" },
				resolve: { env: { BOT_NAME: "REPOSETS_TEST_ENV_LABEL" } },
			});
			expect(plaintext(exit, "BOT_NAME")).toBe("from-environment");
		} finally {
			delete process.env.REPOSETS_TEST_ENV_LABEL;
		}
	});

	it("resolves file entries relative to the base path", async () => {
		writeFileSync(join(tempDir, "secret.txt"), "file-value");
		const exit = await resolveAll({
			username: "tester",
			github_token: { env: "GH" },
			resolve: { file: { MY_SECRET: "./secret.txt" } },
		});
		expect(plaintext(exit, "MY_SECRET")).toBe("file-value");
	});

	it("trims trailing whitespace from file entries", async () => {
		writeFileSync(join(tempDir, "secret.txt"), "file-value\n\n");
		const exit = await resolveAll({
			username: "tester",
			github_token: { env: "GH" },
			resolve: { file: { MY_SECRET: "./secret.txt" } },
		});
		expect(plaintext(exit, "MY_SECRET")).toBe("file-value");
	});

	it("merges all three sub-groups", async () => {
		writeFileSync(join(tempDir, "cert.pem"), "cert-data");
		process.env.REPOSETS_TEST_MERGE = "env-data";
		try {
			const exit = await resolveAll(
				{
					username: "tester",
					github_token: { op: "op://vault/gh/token" },
					resolve: {
						op: { APP_ID: "op://vault/app/id" },
						env: { NAME: "REPOSETS_TEST_MERGE" },
						file: { CERT: "./cert.pem" },
					},
				},
				{ "op://vault/app/id": "999" },
			);
			expect(plaintext(exit, "APP_ID")).toBe("999");
			expect(plaintext(exit, "NAME")).toBe("env-data");
			expect(plaintext(exit, "CERT")).toBe("cert-data");
		} finally {
			delete process.env.REPOSETS_TEST_MERGE;
		}
	});

	it("returns an empty map when there is no resolve section", async () => {
		const exit = await resolveAll({ username: "tester", github_token: { env: "GH" } });
		if (!Exit.isSuccess(exit)) throw new Error("expected success");
		expect(exit.value.size).toBe(0);
	});

	it("fails when a file is missing", async () => {
		const exit = await resolveAll({
			username: "tester",
			github_token: { env: "GH" },
			resolve: { file: { MISSING: "./nope.txt" } },
		});
		expect(Exit.isFailure(exit)).toBe(true);
		expect(JSON.stringify(exit)).toContain("MISSING");
	});

	it("fails when an environment variable is unset", async () => {
		const exit = await resolveAll({
			username: "tester",
			github_token: { env: "GH" },
			resolve: { env: { ABSENT: "REPOSETS_DEFINITELY_NOT_SET" } },
		});
		expect(Exit.isFailure(exit)).toBe(true);
		expect(JSON.stringify(exit)).toContain("REPOSETS_DEFINITELY_NOT_SET");
	});

	it("fails when a 1Password reference is unknown", async () => {
		const exit = await resolveAll(OP_PROFILE, {});
		expect(Exit.isFailure(exit)).toBe(true);
		expect(JSON.stringify(exit)).toContain("op://vault/item/field");
	});
});

describe("resolveGitHubToken", () => {
	const token = (
		profile: CredentialProfile,
		opStubs: Readonly<Record<string, string>> = {},
	): Promise<Exit.Exit<Redacted.Redacted<string>, unknown>> =>
		Effect.runPromiseExit(
			Effect.flatMap(CredentialResolver, (r) => r.resolveGitHubToken(profile)).pipe(Effect.provide(layerWith(opStubs))),
		);

	it("resolves an op reference", async () => {
		const exit = await token(
			{ username: "tester", github_token: { op: "op://vault/gh/token" } },
			{ "op://vault/gh/token": "ghp_real" },
		);
		if (!Exit.isSuccess(exit)) throw new Error("expected success");
		expect(Redacted.value(exit.value)).toBe("ghp_real");
	});

	it("resolves an env reference", async () => {
		process.env.REPOSETS_TEST_GH = "ghp_from_env";
		try {
			const exit = await token({ username: "tester", github_token: { env: "REPOSETS_TEST_GH" } });
			if (!Exit.isSuccess(exit)) throw new Error("expected success");
			expect(Redacted.value(exit.value)).toBe("ghp_from_env");
		} finally {
			delete process.env.REPOSETS_TEST_GH;
		}
	});

	it("fails, naming the variable, when the env reference is unset", async () => {
		const exit = await token({ username: "tester", github_token: { env: "REPOSETS_DEFINITELY_NOT_SET" } });
		expect(Exit.isFailure(exit)).toBe(true);
		expect(JSON.stringify(exit)).toContain("REPOSETS_DEFINITELY_NOT_SET");
	});
});

/**
 * The tests that matter most here. Every path below has already failed or
 * succeeded; what is being asserted is that the *rendered* form of the result
 * never contains the credential.
 */
describe("does not leak resolved values", () => {
	const SECRET = "sk-live-DO-NOT-LEAK-9f3a2b";

	it("keeps op values out of every rendering of a success", async () => {
		const exit = await resolveAll(OP_PROFILE, { "op://vault/item/field": SECRET });
		if (!Exit.isSuccess(exit)) throw new Error("expected success");
		const value = exit.value.get("APP_ID");

		expect(String(value)).not.toContain(SECRET);
		expect(`${value}`).not.toContain(SECRET);
		expect(JSON.stringify(exit)).not.toContain(SECRET);
		// The map itself is a plausible thing to dump while debugging.
		expect(JSON.stringify([...exit.value])).not.toContain(SECRET);
		expect(plaintext(exit, "APP_ID")).toBe(SECRET);
	});

	it("keeps file contents out of every rendering of a success", async () => {
		writeFileSync(join(tempDir, "leak.txt"), SECRET);
		const exit = await resolveAll({
			username: "tester",
			github_token: { env: "GH" },
			resolve: { file: { CERT: "./leak.txt" } },
		});
		expect(JSON.stringify(exit)).not.toContain(SECRET);
		expect(plaintext(exit, "CERT")).toBe(SECRET);
	});

	it("keeps env values out of every rendering of a success", async () => {
		process.env.REPOSETS_TEST_LEAK = SECRET;
		try {
			const exit = await resolveAll({
				username: "tester",
				github_token: { env: "GH" },
				resolve: { env: { TOKEN: "REPOSETS_TEST_LEAK" } },
			});
			expect(JSON.stringify(exit)).not.toContain(SECRET);
			expect(plaintext(exit, "TOKEN")).toBe(SECRET);
		} finally {
			delete process.env.REPOSETS_TEST_LEAK;
		}
	});

	it("keeps the value out of a failure that happens after a successful resolve", async () => {
		// APP_ID resolves to the secret; the file entry then blows up. The error
		// is what gets printed, and the already-resolved secret must not ride
		// along in it.
		const exit = await resolveAll(
			{
				username: "tester",
				github_token: { op: "op://vault/gh/token" },
				resolve: { op: { APP_ID: "op://vault/item/field" }, file: { CERT: "./nope.txt" } },
			},
			{ "op://vault/item/field": SECRET },
		);
		expect(Exit.isFailure(exit)).toBe(true);
		expect(JSON.stringify(exit)).not.toContain(SECRET);
	});

	it("keeps a GitHub token out of every rendering", async () => {
		const exit = await Effect.runPromiseExit(
			Effect.flatMap(CredentialResolver, (r) =>
				r.resolveGitHubToken({ username: "tester", github_token: { op: "op://vault/gh/token" } }),
			).pipe(Effect.provide(layerWith({ "op://vault/gh/token": SECRET }))),
		);
		if (!Exit.isSuccess(exit)) throw new Error("expected success");
		expect(String(exit.value)).not.toContain(SECRET);
		expect(JSON.stringify(exit)).not.toContain(SECRET);
		expect(Redacted.value(exit.value)).toBe(SECRET);
	});

	it("the leak assertions can actually fail", () => {
		// The guard above is only meaningful if `toContain` on a rendered value
		// would catch a plaintext leak. Prove the detector works against a value
		// that is deliberately NOT redacted.
		const unprotected = { token: SECRET };
		expect(JSON.stringify(unprotected)).toContain(SECRET);
	});
});
