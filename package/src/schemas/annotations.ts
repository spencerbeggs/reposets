/**
 * Options {@link taplo} understands.
 *
 * @public
 */
export interface TaploOptions {
	/** Hide the node from completion and hover. */
	readonly hidden?: boolean;
	/** Documentation strings keyed by position (`main`, `key`, ...). */
	readonly docs?: Record<string, string>;
	/** Documentation links keyed by position (`main`, `key`, ...). */
	readonly links?: Record<string, string>;
	/** Keys to insert when the editor scaffolds this table. */
	readonly initKeys?: ReadonlyArray<string>;
	/** Any other `x-taplo` member, passed through untouched. */
	readonly custom?: Record<string, unknown>;
}

/**
 * Options {@link tombi} understands.
 *
 * @public
 */
export interface TombiOptions {
	/** Label shown for an open-ended table's key, e.g. `group_name`. */
	readonly additionalKeyLabel?: string;
	/** How the language server sorts a table's keys. */
	readonly tableKeysOrder?: "schema" | "ascending" | "descending";
	/** How the language server sorts an array's values. */
	readonly arrayValuesOrder?: "ascending" | "descending";
	/** The key to sort an array of tables by. */
	readonly arrayValuesOrderBy?: string;
	/** String formats the language server should recognize. */
	readonly stringFormats?: ReadonlyArray<string>;
	/** The TOML version the document targets. */
	readonly tomlVersion?: string;
	/** Any other `x-tombi-*` key, passed through untouched. */
	readonly custom?: Record<string, unknown>;
}

/**
 * Build the `x-taplo` annotation key from typed options.
 *
 * @remarks
 * The v3 tree imported this from `xdg-effect`, which re-exported it from
 * `json-schema-effect`. Both are gone and `@effected/schemastore` ships no
 * replacement builder — what it ships is the other half: `KeywordFamilies`
 * declares `x-taplo*` and `x-tombi-*` as carried families, and
 * `StoreDocument.fromSchema` wires them into core's `includeAnnotationKey`
 * predicate so they survive the Draft-07 lowering. So the mechanism is intact
 * and only the two constructors needed rebuilding; they live here rather than
 * being inlined at ~30 call sites, which is where the exact key spellings would
 * otherwise drift.
 *
 * The other half of the change is where the result goes. v3 nested it under a
 * `jsonSchema` annotation; v4 has no such annotation, and non-standard keys are
 * written at the top level of `.annotate({ ... })` instead. Spread the result
 * in: `.annotate({ ...taplo({ ... }), title: "..." })`.
 *
 * Taplo ignores `x-taplo` on a node that also carries `$ref`. That is a Taplo
 * limitation and the helper does not work around it — the v3 helper did not
 * either.
 *
 * @public
 */
export const taplo = (options: TaploOptions): Record<string, unknown> => {
	const out: Record<string, unknown> = {};
	if (options.hidden !== undefined) {
		out.hidden = options.hidden;
	}
	if (options.docs !== undefined) {
		out.docs = options.docs;
	}
	if (options.links !== undefined) {
		out.links = options.links;
	}
	if (options.initKeys !== undefined) {
		out.initKeys = options.initKeys;
	}
	for (const [key, value] of Object.entries(options.custom ?? {})) {
		out[key] = value;
	}
	return { "x-taplo": out };
};

/** The `TombiOptions` field → `x-tombi-*` key mapping, in the v3 helper's order. */
const tombiKeys: ReadonlyArray<readonly [keyof TombiOptions, string]> = [
	["additionalKeyLabel", "x-tombi-additional-key-label"],
	["tableKeysOrder", "x-tombi-table-keys-order"],
	["arrayValuesOrder", "x-tombi-array-values-order"],
	["arrayValuesOrderBy", "x-tombi-array-values-order-by"],
	["stringFormats", "x-tombi-string-formats"],
	["tomlVersion", "x-tombi-toml-version"],
];

/**
 * Build the `x-tombi-*` annotation keys from typed options.
 *
 * @remarks
 * See {@link taplo} for why these helpers are local. Unlike `x-taplo`, tombi's
 * options are separate top-level keys rather than members of one object, so the
 * result usually spreads alongside other annotations:
 * `.annotate({ ...tombi({ tableKeysOrder: "schema" }), title: "..." })`.
 *
 * @public
 */
export const tombi = (options: TombiOptions): Record<string, unknown> => {
	const out: Record<string, unknown> = {};
	for (const [field, key] of tombiKeys) {
		const value = options[field];
		if (value !== undefined) {
			out[key] = value;
		}
	}
	for (const [key, value] of Object.entries(options.custom ?? {})) {
		out[key] = value;
	}
	return out;
};

/**
 * The URL of a page under the repository's `docs/`, for a `links.key`
 * annotation.
 *
 * @remarks
 * Every v3 call site spelled the same prefix by hand. Collapsing it here keeps
 * the annotations from drifting apart when the docs move. It returns the URL
 * rather than a finished `x-taplo` object on purpose: several call sites pass
 * `initKeys` in the same `taplo()` call, and two separate `taplo()` results
 * spread into one `annotate` would silently overwrite each other's `x-taplo`.
 *
 * @public
 */
export const docs = (page: string): string => `https://github.com/spencerbeggs/reposets/blob/main/docs/${page}`;
