import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { CleanupSchema, ValueSourceSchema } from "../../src/schemas/common.js";

const decode = Schema.decodeUnknownSync(ValueSourceSchema);
const decodeCleanup = Schema.decodeUnknownSync(CleanupSchema);

describe("ValueSourceSchema", () => {
	it("accepts file source", () => {
		const result = decode({ file: "./private/key" });
		expect(result).toEqual({ file: "./private/key" });
	});

	it("accepts value source", () => {
		const result = decode({ value: "my-secret" });
		expect(result).toEqual({ value: "my-secret" });
	});

	it("accepts json source", () => {
		const result = decode({ json: { foo: "bar", baz: 123 } });
		expect(result).toEqual({ json: { foo: "bar", baz: 123 } });
	});

	it("accepts op source", () => {
		const result = decode({ op: "op://vault/item/field" });
		expect(result).toEqual({ op: "op://vault/item/field" });
	});

	it("rejects empty object", () => {
		expect(() => decode({})).toThrow();
	});

	it("rejects unknown source key", () => {
		expect(() => decode({ env: "MY_VAR" })).toThrow();
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
		expect(result.dependabot_secrets).toBe(false);
		expect(result.codespaces_secrets).toBe(false);
		expect(result.rulesets).toBe(false);
		expect(result.preserve).toEqual({
			secrets: [],
			variables: [],
			dependabot_secrets: [],
			codespaces_secrets: [],
			rulesets: [],
		});
	});

	it("accepts partial cleanup", () => {
		const result = decodeCleanup({ secrets: true });
		expect(result.secrets).toBe(true);
		expect(result.variables).toBe(false);
	});
});
