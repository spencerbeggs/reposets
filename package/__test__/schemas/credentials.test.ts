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
