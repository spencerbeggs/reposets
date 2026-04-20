import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { CleanupSchema, CleanupScopeSchema, SecretGroupSchema, VariableGroupSchema } from "../../src/schemas/common.js";

const decodeSecretGroup = Schema.decodeUnknownSync(SecretGroupSchema);
const decodeVariableGroup = Schema.decodeUnknownSync(VariableGroupSchema);
const decodeCleanup = Schema.decodeUnknownSync(CleanupSchema);
const decodeCleanupScope = Schema.decodeUnknownSync(CleanupScopeSchema);

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

describe("CleanupScopeSchema", () => {
	it("accepts false (no cleanup)", () => {
		const result = decodeCleanupScope(false);
		expect(result).toBe(false);
	});

	it("accepts true (full cleanup)", () => {
		const result = decodeCleanupScope(true);
		expect(result).toBe(true);
	});

	it("accepts { preserve: [] } (cleanup with empty exceptions)", () => {
		const result = decodeCleanupScope({ preserve: [] });
		expect(result).toEqual({ preserve: [] });
	});

	it("accepts { preserve: ['name'] } (cleanup with exceptions)", () => {
		const result = decodeCleanupScope({ preserve: ["KEEP_ME", "ANOTHER"] });
		expect(result).toEqual({ preserve: ["KEEP_ME", "ANOTHER"] });
	});

	it("rejects non-boolean, non-object values", () => {
		expect(() => decodeCleanupScope("yes")).toThrow();
		expect(() => decodeCleanupScope(42)).toThrow();
	});

	it("rejects object without preserve key", () => {
		expect(() => decodeCleanupScope({ delete: true })).toThrow();
	});
});

describe("CleanupSchema", () => {
	it("accepts full cleanup config with all fields specified", () => {
		const result = decodeCleanup({
			secrets: {
				actions: true,
				dependabot: { preserve: ["DEP_SECRET"] },
				codespaces: false,
				environments: true,
			},
			variables: {
				actions: { preserve: ["MY_VAR"] },
				environments: false,
			},
			rulesets: true,
			environments: false,
		});
		expect(result.secrets.actions).toBe(true);
		expect(result.secrets.dependabot).toEqual({ preserve: ["DEP_SECRET"] });
		expect(result.secrets.codespaces).toBe(false);
		expect(result.secrets.environments).toBe(true);
		expect(result.variables.actions).toEqual({ preserve: ["MY_VAR"] });
		expect(result.variables.environments).toBe(false);
		expect(result.rulesets).toBe(true);
		expect(result.environments).toBe(false);
	});

	it("applies defaults for missing fields (all false)", () => {
		const result = decodeCleanup({});
		expect(result.secrets.actions).toBe(false);
		expect(result.secrets.dependabot).toBe(false);
		expect(result.secrets.codespaces).toBe(false);
		expect(result.secrets.environments).toBe(false);
		expect(result.variables.actions).toBe(false);
		expect(result.variables.environments).toBe(false);
		expect(result.rulesets).toBe(false);
		expect(result.environments).toBe(false);
	});

	it("applies nested defaults when only secrets object is provided", () => {
		const result = decodeCleanup({ secrets: { actions: true } });
		expect(result.secrets.actions).toBe(true);
		expect(result.secrets.dependabot).toBe(false);
		expect(result.secrets.codespaces).toBe(false);
		expect(result.secrets.environments).toBe(false);
	});

	it("applies nested defaults when only variables object is provided", () => {
		const result = decodeCleanup({ variables: { environments: true } });
		expect(result.variables.actions).toBe(false);
		expect(result.variables.environments).toBe(true);
	});

	it("accepts preserve objects within nested scopes", () => {
		const result = decodeCleanup({
			secrets: { actions: { preserve: ["TOKEN_A", "TOKEN_B"] } },
		});
		expect(result.secrets.actions).toEqual({ preserve: ["TOKEN_A", "TOKEN_B"] });
	});
});
