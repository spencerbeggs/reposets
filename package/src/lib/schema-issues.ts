import { SchemaIssue } from "effect";

/**
 * Core's structured formatter: one entry per leaf, each with its property path.
 *
 * @remarks
 * Built once. It is a pure function of the issue tree, and `Formatter` carries
 * no state.
 */
const formatter = SchemaIssue.makeFormatterStandardSchemaV1({
	// Core renders an excess property as "Expected no excess property", which
	// describes the schema's rule rather than the user's mistake. The path
	// already names the key, so "unknown key at groups.g.cleanup.rulesetz" says
	// the same thing in the words someone editing a TOML file would use. Every
	// other leaf keeps core's phrasing.
	leafHook: (issue) => (issue._tag === "UnexpectedKey" ? "unknown key" : SchemaIssue.defaultLeafHook(issue)),
});

/**
 * Render a `ConfigValidationError`'s `issue` as one line per rejected value.
 *
 * @remarks
 * **No walker of our own.** Core already ships one:
 * `SchemaIssue.makeFormatterStandardSchemaV1()` flattens the tree to
 * `{ message, path }` entries, which is exactly the shape this needs.
 * `defaultLeafHook` handles every leaf variant — `UnexpectedKey`,
 * `InvalidType`, `MissingKey`, `Forbidden`, `OneOf` — so a wrong *type* renders
 * as sensibly as an unknown key, and a variant added upstream is covered
 * without a change here. Hand-rolling this against the excess-property shape
 * alone would have got every other cause wrong.
 *
 * `issue` is declared `Schema.Defect`, so it arrives as `unknown`; the
 * `isIssue` guard is what makes reading it safe. Anything that is not an issue
 * tree yields no lines rather than a crash — a rendering helper on an error
 * path must never become the reason a command dies.
 *
 * Nodes are never stringified. Each carries the entire AST inline, annotations
 * included, so `String(node)` would dump the schema rather than describe the
 * failure. Only `message` and `path` are read.
 *
 * @param issue - the `issue` field of a `ConfigValidationError`, or any value
 * @returns one line per rejected value, deepest path last; empty if `issue` is
 * not an issue tree
 *
 * @public
 */
export const formatSchemaIssue = (issue: unknown): ReadonlyArray<string> => {
	if (!SchemaIssue.isIssue(issue)) {
		return [];
	}

	const lines = formatter(issue).issues.map((entry) => {
		const path = (entry.path ?? []).map(String).join(".");
		return path === "" ? entry.message : `${entry.message} at ${path}`;
	});

	// A union reports every branch it tried, so one wrong key in a three-member
	// union prints the same "unknown key" line three times. The per-branch
	// "Missing key" lines differ and are worth keeping — they say which shapes
	// were allowed — but the repeat is pure noise in front of them.
	return [...new Set(lines)];
};
