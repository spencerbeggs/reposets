import type { Option } from "effect";

/**
 * What a sync run should do about one resource, and what it should say about it.
 *
 * @remarks
 * Two facts are being reported at once and callers need them independently:
 * whether the resource must be written, and whether someone changed it outside
 * reposets since the last run. `sync` acts on both; `drift` reports only the
 * second and never writes.
 *
 * @public
 */
export type Decision =
	/** No record of ever having synced this resource. No drift claim is possible. */
	| { readonly _tag: "FirstSync"; readonly needsApply: boolean }
	/** Config, live state and last-applied all agree. Nothing to do. */
	| { readonly _tag: "InSync" }
	/** Live state still matches what we last applied; the config moved. */
	| { readonly _tag: "ConfigChanged" }
	/**
	 * Live state no longer matches what we last applied — someone changed it
	 * outside reposets.
	 */
	| {
			readonly _tag: "Drift";
			readonly applied: string;
			readonly live: string;
			/** `false` when the out-of-band change happens to match the config. */
			readonly needsApply: boolean;
	  };

/**
 * Decides what to do about one resource from three fingerprints.
 *
 * @remarks
 * Pure and total — no I/O, no failure mode. All three inputs are
 * {@link fingerprint} outputs over the same resource.
 *
 * The distinction that justifies persisting anything: **`desired` vs `live`
 * tells you something is wrong; `live` vs `applied` tells you who did it.**
 * Without the stored `applied` fingerprint the two are indistinguishable, and
 * every divergence looks like a config change.
 *
 * `Drift` is reported even when `needsApply` is `false` — that is the case where
 * someone edited the repository in the GitHub UI to a value that happens to
 * match the config. Nothing needs writing, but a human still changed something
 * out of band and the journal should say so.
 *
 * A missing `applied` row yields `FirstSync` rather than `Drift`: with no
 * baseline there is no evidence anyone changed anything, and claiming drift on
 * first contact would flag every pre-existing repository.
 *
 * @param desired - fingerprint of the resolved config for this resource
 * @param live - fingerprint of what GitHub currently reports
 * @param applied - fingerprint reposets last wrote, if it has ever written one
 *
 * @public
 */
export const decide = (desired: string, live: string, applied: Option.Option<string>): Decision => {
	if (applied._tag === "None") {
		return { _tag: "FirstSync", needsApply: desired !== live };
	}

	if (applied.value === live) {
		return desired === live ? { _tag: "InSync" } : { _tag: "ConfigChanged" };
	}

	return {
		_tag: "Drift",
		applied: applied.value,
		live,
		needsApply: desired !== live,
	};
};

/**
 * Whether a decision requires writing to GitHub.
 *
 * @public
 */
export const needsApply = (decision: Decision): boolean =>
	decision._tag === "ConfigChanged" ||
	((decision._tag === "FirstSync" || decision._tag === "Drift") && decision.needsApply);

/**
 * Whether a decision represents an out-of-band change worth reporting.
 *
 * @public
 */
export const isDrift = (decision: Decision): decision is Extract<Decision, { _tag: "Drift" }> =>
	decision._tag === "Drift";
