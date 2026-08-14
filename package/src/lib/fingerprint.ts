// blakejs is CommonJS, and Node detects only PART of its export surface:
// `blake2b` resolves as a named import; the other nine — `blake2bHex` included —
// do not, and throw "does not provide an export named" at runtime after a clean
// build. The first function you reach for working is what makes the second one
// surprising. The default import is interop-safe for all ten.
import blakejs from "blakejs";

const { blake2bHex } = blakejs;

/**
 * Serializes a value to JSON with object keys sorted at every depth.
 *
 * @remarks
 * Two values that differ only in key order must hash identically, or every
 * config reordering would read as drift. `JSON.stringify` preserves insertion
 * order, so the sort has to be explicit.
 *
 * Arrays keep their order — element order is meaningful in this config (a
 * ruleset's `rules`, an environment's reviewers), so reordering one is a real
 * change and should register as drift.
 *
 * `undefined` is dropped from objects, matching `JSON.stringify`, so an absent
 * key and an explicitly-undefined key fingerprint the same. That is correct
 * here: both mean "not configured".
 */
const canonical = (value: unknown): string => {
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value) ?? "null";
	}

	if (Array.isArray(value)) {
		return `[${value.map(canonical).join(",")}]`;
	}

	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([, v]) => v !== undefined)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`);

	return `{${entries.join(",")}}`;
};

/**
 * The digest length, in bytes. 32 gives a 64-character hex string.
 */
const DIGEST_BYTES = 32;

/**
 * Fingerprints the resolved desired state of one resource.
 *
 * @remarks
 * Pure, and deliberately not an `Effect` — it performs no I/O and cannot fail
 * for any input reposets produces. The argument is always already-decoded config
 * data, which by construction is acyclic (it came from TOML).
 *
 * The fingerprint records what reposets last *pushed*, so a later run can tell
 * "the config changed" from "someone changed this in the GitHub UI".
 *
 * @example
 * ```ts
 * fingerprint({ b: 1, a: 2 }) === fingerprint({ a: 2, b: 1 })  // key order is not drift
 * fingerprint([1, 2]) !== fingerprint([2, 1])                  // element order is
 * ```
 *
 * @public
 */
export const fingerprint = (value: unknown): string => blake2bHex(canonical(value), undefined, DIGEST_BYTES);
