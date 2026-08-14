import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { CredentialsSchema } from "../../src/schemas/credentials.js";

const decode = (input: unknown): unknown => Effect.runSync(Schema.decodeUnknownEffect(CredentialsSchema)(input));

/**
 * Decode the way the loader does.
 *
 * @remarks
 * `ConfigFiles` passes `onExcessProperty: "error"`, so the schema alone and the
 * loading path answer differently for an unknown key. These assertions cover the
 * path a user's file actually takes.
 */
const decodeStrict = (input: unknown): unknown =>
	Effect.runSync(Schema.decodeUnknownEffect(CredentialsSchema)(input, { onExcessProperty: "error" }));

const strictOk = (input: unknown): boolean => {
	try {
		decodeStrict(input);
		return true;
	} catch {
		return false;
	}
};

const decodeResult = (input: unknown): { ok: boolean } => {
	try {
		decode(input);
		return { ok: true };
	} catch {
		return { ok: false };
	}
};

describe("CredentialsSchema", () => {
	it("defaults profiles to an empty record", () => {
		expect(decode({})).toEqual({ profiles: {} });
	});

	describe("a profile says who it acts as, and only one thing", () => {
		const profile = (owner: Record<string, unknown>) => ({
			profiles: { p: { ...owner, github_token: { env: "GH" } } },
		});

		it("accepts a username", () => {
			expect(decodeResult(profile({ username: "spencerbeggs" })).ok).toBe(true);
		});

		it("accepts an org", () => {
			expect(decodeResult(profile({ org: "savvy-web" })).ok).toBe(true);
		});

		it("rejects a profile declaring both", () => {
			// The reason the branches forbid each other's key rather than simply
			// omitting it. A plain union of two structs ACCEPTS this input and
			// silently drops `org`, which would make the contradictory state
			// representable and resolve it by branch order — verified against the
			// installed beta before choosing this shape.
			expect(decodeResult(profile({ username: "spencerbeggs", org: "savvy-web" })).ok).toBe(false);
		});

		it("rejects a profile declaring neither", () => {
			// An owner is not optional: it is what decides whether an org-only
			// setting is even valid, which is the check that no longer needs the
			// network.
			expect(decodeResult(profile({})).ok).toBe(false);
		});
	});

	it("accepts an op reference for github_token", () => {
		const parsed = decode({
			profiles: {
				sandbox: {
					org: "reposets-sandbox",
					github_token: { op: "op://Savvy CI/GitHub Apps/reposets-scratch/ORG_TOKEN" },
				},
			},
		}) as { profiles: Record<string, { github_token: { op: string } }> };

		expect(parsed.profiles.sandbox?.github_token).toEqual({
			op: "op://Savvy CI/GitHub Apps/reposets-scratch/ORG_TOKEN",
		});
	});

	it("accepts an env reference for github_token", () => {
		const parsed = decode({
			profiles: { ci: { username: "tester", github_token: { env: "REPOSETS_GITHUB_TOKEN" } } },
		}) as { profiles: Record<string, { github_token: { env: string } }> };

		expect(parsed.profiles.ci?.github_token).toEqual({ env: "REPOSETS_GITHUB_TOKEN" });
	});

	// The point of the redesign: a bare string was the v3 form, and it is the one
	// shape that puts a live token on disk. It must not decode.
	it("rejects a bare string github_token", () => {
		expect(
			decodeResult({ profiles: { old: { username: "tester", github_token: "ghp_xxxxxxxxxxxxxxxxxxxx" } } }).ok,
		).toBe(false);
	});

	it("rejects an inline value for github_token", () => {
		expect(decodeResult({ profiles: { old: { username: "tester", github_token: { value: "ghp_xxxx" } } } }).ok).toBe(
			false,
		);
	});

	// op_service_account_token left the schema: it authenticates the SDK that
	// resolves everything else, so keeping it here would store the credential
	// that unlocks every other credential alongside them.
	//
	// The schema alone ignores it — v4 drops unknown keys by default — but the
	// loader decodes with onExcessProperty "error", so a migrating user is told
	// rather than left believing a dead token is live.
	it("rejects a leftover op_service_account_token through the loader path", () => {
		const stale = {
			profiles: { old: { username: "tester", github_token: { env: "T" }, op_service_account_token: "ops_xxxx" } },
		};

		expect(strictOk(stale)).toBe(false);
		// Schema-only decoding still drops it, which is why the loader must opt in.
		expect(decode(stale)).toEqual({ profiles: { old: { username: "tester", github_token: { env: "T" } } } });
	});

	it("accepts a resolve section with op, env and file sub-groups", () => {
		const parsed = decode({
			profiles: {
				sandbox: {
					username: "tester",
					github_token: { env: "T" },
					resolve: {
						op: { npm_token: "op://Vault/npm/token" },
						env: { region: "AWS_REGION" },
						file: { cert: "./certs/x.pem" },
					},
				},
			},
		}) as { profiles: Record<string, { resolve: { op: Record<string, string> } }> };

		expect(parsed.profiles.sandbox?.resolve.op).toEqual({ npm_token: "op://Vault/npm/token" });
	});

	// resolve.value survives: the section holds named values generally, and its
	// common use is non-secret structured data — an SBOM supplier block, a
	// registry list. Removing it generalised the token rule to a section that is
	// not only about tokens. What must never be inlined is a *credential*, and
	// that is enforced on github_token, not here.
	it("accepts an inline value sub-group in resolve", () => {
		expect(
			strictOk({
				profiles: { p: { username: "tester", github_token: { env: "T" }, resolve: { value: { REGISTRIES: "a,b" } } } },
			}),
		).toBe(true);
	});

	it("accepts a structured object as an inline value", () => {
		expect(
			strictOk({
				profiles: {
					p: {
						username: "tester",
						github_token: { env: "T" },
						resolve: { value: { SBOM: { supplier: { name: "acme", url: "https://acme.test" } } } },
					},
				},
			}),
		).toBe(true);
	});

	// The documented [settings.*]-style pass-through must survive strictness:
	// keys covered by a rest schema are not excess. Credentials has no such
	// section, so here the check is that a fully valid file still decodes.
	it("still accepts a valid file under strict decoding", () => {
		expect(
			strictOk({
				profiles: {
					p: { username: "tester", github_token: { op: "op://V/i/f" }, resolve: { op: { t: "op://V/n/t" } } },
				},
			}),
		).toBe(true);
	});
});
