import { Effect, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { formatSchemaIssue } from "../../src/lib/schema-issues.js";

/**
 * Decode strictly and hand back the raw issue tree, the same value
 * `ConfigValidationError` carries on its `issue` field.
 */
const issueFrom = <A, I>(schema: Schema.Codec<A, I>, input: unknown): unknown => {
	const result = Effect.runSync(
		Schema.decodeUnknownEffect(schema)(input, { onExcessProperty: "error", errors: "all" }).pipe(Effect.result),
	);
	if (Result.isSuccess(result)) throw new Error("expected the decode to fail");
	return (result.failure as { readonly issue: unknown }).issue;
};

const Nested = Schema.Struct({
	groups: Schema.Record(
		Schema.String,
		Schema.Struct({
			repos: Schema.Array(Schema.String),
			cleanup: Schema.optional(Schema.Struct({ rulesets: Schema.optional(Schema.Boolean) })),
		}),
	),
	owner: Schema.optional(Schema.String),
	log_level: Schema.optional(Schema.String),
});

describe("formatSchemaIssue", () => {
	it("names an unknown top-level key with its path", () => {
		const lines = formatSchemaIssue(issueFrom(Nested, { owner: "acme", log_levl: "info", groups: {} }));
		expect(lines).toEqual(["unknown key at log_levl"]);
	});

	it("reports every rejected key, not only the first", () => {
		// The reason `errors: "all"` is on the loader: one run should tell a user
		// everything that is wrong, not send them round the loop once per typo.
		const lines = formatSchemaIssue(
			issueFrom(Nested, {
				log_levl: "info",
				groups: { g: { repos: ["r"], cleanup: { rulesetz: true } } },
			}),
		);

		expect(lines).toContain("unknown key at log_levl");
		expect(lines).toContain("unknown key at groups.g.cleanup.rulesetz");
		expect(lines).toHaveLength(2);
	});

	it("carries the full path for a deeply nested key", () => {
		const lines = formatSchemaIssue(
			issueFrom(Nested, { groups: { my_group: { repos: ["r"], cleanup: { nope: 1 } } } }),
		);
		expect(lines).toEqual(["unknown key at groups.my_group.cleanup.nope"]);
	});

	/**
	 * The case a walker written only against the excess-property shape gets
	 * wrong: a cause that is not an unknown key at all.
	 */
	it("renders a wrong type sensibly rather than emptily", () => {
		const lines = formatSchemaIssue(issueFrom(Nested, { groups: { g: { repos: "not-an-array" } } }));

		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain("groups.g.repos");
		expect(lines[0]).not.toBe("");
		expect(lines[0]).not.toContain("unknown key");
	});

	it("renders a missing required key", () => {
		const lines = formatSchemaIssue(issueFrom(Nested, {}));
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain("groups");
	});

	it("renders a mix of causes in one failure", () => {
		const lines = formatSchemaIssue(issueFrom(Nested, { log_levl: "info", groups: { g: { repos: 42 } } }));

		expect(lines).toContain("unknown key at log_levl");
		expect(lines.some((line) => line.includes("groups.g.repos"))).toBe(true);
	});

	it("never stringifies a node — no AST or annotations leak into the output", () => {
		// Every issue node inlines the whole AST, annotations included. A
		// `String(node)` anywhere in the walker would dump the schema instead of
		// describing the failure, and this config's annotations carry x-taplo /
		// x-tombi keys that would be very visible.
		const lines = formatSchemaIssue(issueFrom(Nested, { log_levl: "info", groups: {} }));
		const joined = lines.join("\n");

		expect(joined).not.toContain("[object Object]");
		expect(joined).not.toContain("x-taplo");
		expect(joined).not.toContain("annotations");
		expect(joined).not.toContain("ast");
		expect(joined.length).toBeLessThan(200);
	});
});

describe("formatSchemaIssue on things that are not issue trees", () => {
	/**
	 * This runs on the error path, where a crash would replace a useful message
	 * with a stack trace. Anything unrecognised yields no lines and the caller's
	 * own message still prints.
	 */
	it.each([
		["undefined", undefined],
		["null", null],
		["a string", "boom"],
		["a number", 42],
		["a plain object", { _tag: "NotAnIssue" }],
		["an Error", new Error("nope")],
		["an array", [1, 2, 3]],
	])("returns no lines for %s", (_label, value) => {
		expect(formatSchemaIssue(value)).toEqual([]);
	});
});

describe("formatSchemaIssue, on a union", () => {
	/** The shape every secret and variable group has: exactly one of three keys. */
	const Group = Schema.Union([
		Schema.Struct({ file: Schema.Record(Schema.String, Schema.String) }),
		Schema.Struct({ value: Schema.Record(Schema.String, Schema.String) }),
		Schema.Struct({ resolved: Schema.Record(Schema.String, Schema.String) }),
	]);

	it("reports each allowed shape once, and the wrong key once rather than per branch", () => {
		// The mistake a TOML author actually makes: `[variables.keep]` with the
		// names inline, instead of nested under `value`.
		const lines = formatSchemaIssue(issueFrom(Group, { KEEP_ME: "yes" }));

		expect(lines).toEqual([
			"unknown key at KEEP_ME",
			"Missing key at file",
			"Missing key at value",
			"Missing key at resolved",
		]);
		// Without deduplication the union repeats the same unknown-key line once
		// per branch, burying the three lines that say what was allowed.
		expect(lines.filter((line) => line.startsWith("unknown key"))).toHaveLength(1);
	});
});
