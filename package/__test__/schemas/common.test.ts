import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { CleanupSchema, SecretGroupSchema, VariableGroupSchema } from "../../src/schemas/common.js";

const decodeSecretGroup = Schema.decodeUnknownSync(SecretGroupSchema);
const decodeVariableGroup = Schema.decodeUnknownSync(VariableGroupSchema);
const decodeCleanup = Schema.decodeUnknownSync(CleanupSchema);

describe("SecretGroupSchema", () => {
	it("accepts file kind", () => {
		const result = decodeSecretGroup({
			file: { APP_KEY: "./private/key", CERT: "./private/cert.pem" },
		});
		expect("file" in result && result.file.APP_KEY).toBe("./private/key");
	});

	it("accepts value kind with string", () => {
		const result = decodeSecretGroup({
			value: { API_URL: "https://api.example.com" },
		});
		expect("value" in result && result.value.API_URL).toBe("https://api.example.com");
	});

	it("accepts value kind with object (will be JSON-stringified at sync time)", () => {
		const result = decodeSecretGroup({
			value: { REGISTRIES: { npm: "https://registry.npmjs.org" } },
		});
		expect("value" in result && result.value.REGISTRIES).toEqual({ npm: "https://registry.npmjs.org" });
	});

	it("accepts resolved kind", () => {
		const result = decodeSecretGroup({
			resolved: { APP_ID: "SILK_APP_ID", NPM_TOKEN: "SILK_NPM_TOKEN" },
		});
		expect("resolved" in result && result.resolved.APP_ID).toBe("SILK_APP_ID");
	});

	it("rejects empty object", () => {
		expect(() => decodeSecretGroup({})).toThrow();
	});
});

describe("VariableGroupSchema", () => {
	it("accepts file kind", () => {
		const result = decodeVariableGroup({
			file: { SBOM: "./private/sbom.json" },
		});
		expect("file" in result && result.file.SBOM).toBe("./private/sbom.json");
	});

	it("accepts value kind", () => {
		const result = decodeVariableGroup({
			value: { NODE_ENV: "production", DO_NOT_TRACK: "1" },
		});
		expect("value" in result && result.value.NODE_ENV).toBe("production");
	});

	it("accepts resolved kind", () => {
		const result = decodeVariableGroup({
			resolved: { BOT_NAME: "SILK_BOT_NAME" },
		});
		expect("resolved" in result && result.resolved.BOT_NAME).toBe("SILK_BOT_NAME");
	});
});

describe("CleanupSchema", () => {
	it("accepts full cleanup config", () => {
		const result = decodeCleanup({
			secrets: true,
			variables: false,
			dependabot_secrets: true,
			codespaces_secrets: false,
			rulesets: true,
			preserve: { secrets: ["KEEP_ME"] },
		});
		expect(result.secrets).toBe(true);
		expect(result.preserve.secrets).toEqual(["KEEP_ME"]);
	});

	it("applies defaults for missing fields", () => {
		const result = decodeCleanup({});
		expect(result.secrets).toBe(false);
		expect(result.variables).toBe(false);
		expect(result.preserve).toEqual({
			secrets: [],
			variables: [],
			dependabot_secrets: [],
			codespaces_secrets: [],
			rulesets: [],
		});
	});
});
