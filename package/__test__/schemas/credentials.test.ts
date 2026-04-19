import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { CredentialProfileSchema, CredentialsSchema } from "../../src/schemas/credentials.js";

const decodeProfile = Schema.decodeUnknownSync(CredentialProfileSchema);
const decodeCreds = Schema.decodeUnknownSync(CredentialsSchema);

describe("CredentialProfileSchema", () => {
	it("accepts profile with github token only", () => {
		const result = decodeProfile({ github_token: "ghp_abc123" });
		expect(result.github_token).toBe("ghp_abc123");
		expect(result.op_service_account_token).toBeUndefined();
	});

	it("accepts profile with both tokens", () => {
		const result = decodeProfile({
			github_token: "ghp_abc123",
			op_service_account_token: "ops_xyz789",
		});
		expect(result.github_token).toBe("ghp_abc123");
		expect(result.op_service_account_token).toBe("ops_xyz789");
	});

	it("rejects profile without github token", () => {
		expect(() => decodeProfile({})).toThrow();
	});

	it("accepts profile with resolve.op section", () => {
		const result = decodeProfile({
			github_token: "ghp_abc",
			resolve: {
				op: { SILK_APP_ID: "op://vault/item/field" },
			},
		});
		expect(result.resolve?.op?.SILK_APP_ID).toBe("op://vault/item/field");
	});

	it("accepts profile with resolve.file section", () => {
		const result = decodeProfile({
			github_token: "ghp_abc",
			resolve: {
				file: { NPM_TOKEN: "./private/npm-token" },
			},
		});
		expect(result.resolve?.file?.NPM_TOKEN).toBe("./private/npm-token");
	});

	it("accepts profile with resolve.value section", () => {
		const result = decodeProfile({
			github_token: "ghp_abc",
			resolve: {
				value: {
					BOT_NAME: "mybot[bot]",
					REGISTRIES: { npm: "https://registry.npmjs.org" },
				},
			},
		});
		expect(result.resolve?.value?.BOT_NAME).toBe("mybot[bot]");
	});

	it("accepts profile with all three resolve sub-groups", () => {
		const result = decodeProfile({
			github_token: "ghp_abc",
			op_service_account_token: "ops_xyz",
			resolve: {
				op: { APP_ID: "op://vault/app/id" },
				file: { CERT: "./certs/cert.pem" },
				value: { NAME: "static" },
			},
		});
		expect(result.resolve?.op?.APP_ID).toBe("op://vault/app/id");
		expect(result.resolve?.file?.CERT).toBe("./certs/cert.pem");
		expect(result.resolve?.value?.NAME).toBe("static");
	});

	it("accepts profile without resolve section", () => {
		const result = decodeProfile({ github_token: "ghp_abc" });
		expect(result.resolve).toBeUndefined();
	});
});

describe("CredentialsSchema", () => {
	it("accepts single profile", () => {
		const result = decodeCreds({
			profiles: { personal: { github_token: "ghp_abc" } },
		});
		expect(result.profiles.personal.github_token).toBe("ghp_abc");
	});

	it("accepts multiple profiles", () => {
		const result = decodeCreds({
			profiles: {
				personal: { github_token: "ghp_abc" },
				work: { github_token: "ghp_def", op_service_account_token: "ops_ghi" },
			},
		});
		expect(Object.keys(result.profiles)).toEqual(["personal", "work"]);
	});

	it("defaults to empty profiles", () => {
		const result = decodeCreds({});
		expect(result.profiles).toEqual({});
	});
});
