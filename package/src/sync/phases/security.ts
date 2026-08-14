import type { Repo } from "@effected/github";
import { RepositorySecurity } from "@effected/github";
import { Effect, Option } from "effect";
import { fingerprint } from "../../lib/fingerprint.js";
import { SyncLogger } from "../../services/SyncLogger.js";
import { AppliedState, lookup } from "../../store/AppliedState.js";
import type { ChangeRecord } from "../../store/SyncJournal.js";
import { decide, isDrift, needsApply } from "../decide.js";
import type { Phase, PhaseResult, RepoContext } from "../phase.js";

const KIND = "security";

/** The three toggles, and the merged config field each reads. */
const TOGGLES = ["vulnerability_alerts", "automated_security_fixes", "private_vulnerability_reporting"] as const;

type Toggle = (typeof TOGGLES)[number];

/**
 * Merge the security groups a repository's group references.
 *
 * @remarks
 * Later groups win, matching how every other `[settings.*]`-style section
 * composes. An absent field is not `false` — it means "leave alone", which is
 * why this returns a partial record rather than defaulting.
 */
const mergeSecurity = (ctx: RepoContext): Partial<Record<Toggle, boolean>> => {
	const refs = ctx.config.groups[ctx.group]?.security ?? [];
	const merged: Partial<Record<Toggle, boolean>> = {};

	for (const ref of refs) {
		const group = ctx.config.security[ref];
		if (group === undefined) continue;
		for (const toggle of TOGGLES) {
			const value = group[toggle];
			if (value !== undefined) merged[toggle] = value;
		}
	}

	return merged;
};

/**
 * GitHub rejects automated fixes without alerts.
 *
 * @remarks
 * Caught before any write rather than after the first one fails: applying
 * `automated_security_fixes` first would leave the repository half-configured
 * and the error attributed to the wrong toggle.
 */
const contradicts = (merged: Partial<Record<Toggle, boolean>>): boolean =>
	merged.automated_security_fixes === true && merged.vulnerability_alerts === false;

/**
 * Repository security toggles: vulnerability alerts, automated fixes, private
 * vulnerability reporting.
 *
 * @remarks
 * Each toggle is a separate resource for drift purposes, so someone flipping
 * private vulnerability reporting in the UI is reported as that, not as
 * "security changed".
 *
 * @public
 */
export const securityPhase = Effect.gen(function* () {
	const security = yield* RepositorySecurity;
	const applied = yield* AppliedState;
	const logger = yield* SyncLogger;

	const read = (toggle: Toggle): Effect.Effect<Option.Option<boolean>, never, Repo> => {
		const call =
			toggle === "vulnerability_alerts"
				? security.vulnerabilityAlerts()
				: toggle === "automated_security_fixes"
					? security.automatedSecurityFixes()
					: security.privateVulnerabilityReporting();

		return call.pipe(
			Effect.map(Option.some),
			Effect.orElseSucceed(() => Option.none<boolean>()),
		);
	};

	const write = (toggle: Toggle, value: boolean): Effect.Effect<Option.Option<string>, never, Repo> => {
		const call =
			toggle === "vulnerability_alerts"
				? security.setVulnerabilityAlerts(value)
				: toggle === "automated_security_fixes"
					? security.setAutomatedSecurityFixes(value)
					: security.setPrivateVulnerabilityReporting(value);

		return call.pipe(
			Effect.as(Option.none<string>()),
			Effect.catch((error: { readonly message?: string }) =>
				Effect.succeed(Option.some(error.message ?? String(error))),
			),
		);
	};

	const run = (ctx: RepoContext): Effect.Effect<PhaseResult, never, Repo> =>
		Effect.gen(function* () {
			const merged = mergeSecurity(ctx);

			if (contradicts(merged)) {
				return {
					changes: [],
					errors: [
						{
							context: "security merge",
							message:
								"automated_security_fixes = true requires vulnerability_alerts to be enabled (or omitted); skipping security sync",
						},
					],
				};
			}

			const baselines = yield* applied.getMany(ctx.slug).pipe(Effect.orElseSucceed(() => new Map()));
			const changes: ChangeRecord[] = [];
			const errors: Array<{ readonly context: string; readonly message: string }> = [];

			for (const toggle of TOGGLES) {
				const desired = merged[toggle];
				if (desired === undefined) continue;

				const live = yield* read(toggle);
				if (Option.isNone(live)) {
					errors.push({ context: `get ${toggle}`, message: "could not read current state" });
					continue;
				}

				const decision = decide(
					fingerprint(desired),
					fingerprint(live.value),
					Option.map(lookup(baselines, KIND, toggle), (record) => record.fingerprint),
				);

				if (isDrift(decision)) {
					yield* logger.driftDetected(KIND, toggle, decision);
				}

				if (!needsApply(decision)) continue;

				if (!ctx.dryRun) {
					const failure = yield* write(toggle, desired);
					if (Option.isSome(failure)) {
						errors.push({ context: toggle, message: failure.value });
						continue;
					}

					// Recorded only after a successful write: a fingerprint claiming we
					// applied something we did not would make the next run report drift
					// against our own failure.
					yield* applied
						.record({ repo: ctx.slug, kind: KIND, name: toggle }, fingerprint(desired), ctx.runId)
						.pipe(Effect.ignore);
				}

				yield* logger.syncOperation("sync", KIND, toggle, desired ? "enable" : "disable");
				changes.push({
					repo: ctx.slug,
					kind: KIND,
					name: toggle,
					action: isDrift(decision) ? "drift-overwritten" : "updated",
				});
			}

			return { changes, errors };
		});

	return {
		name: "security",
		appliesTo: (ctx) => (ctx.config.groups[ctx.group]?.security?.length ?? 0) > 0,
		run,
	} satisfies Phase;
});
