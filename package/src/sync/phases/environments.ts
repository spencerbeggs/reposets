import type { Repo } from "@effected/github";
import { DeploymentEnvironment } from "@effected/github";
import { Effect, Option } from "effect";
import { fingerprint } from "../../lib/fingerprint.js";
import { SyncLogger } from "../../services/SyncLogger.js";
import { AppliedState, lookup } from "../../store/AppliedState.js";
import type { ChangeRecord } from "../../store/SyncJournal.js";
import { decide, isDrift, needsApply } from "../decide.js";
import type { Phase, PhaseResult, RepoContext } from "../phase.js";

/**
 * Stands in for live state this phase cannot read.
 *
 * @remarks
 * `decide` needs three fingerprints, and GitHub exposes no read of these
 * resources comparable to what is written — the PATCH surface and the GET
 * surface differ, and some fields are not on the GET at all. So live is taken
 * to be the last applied value, and this sentinel covers the case where there
 * is no last applied value.
 *
 * It must never equal a real fingerprint. Using the desired fingerprint here
 * instead would make `FirstSync` compute `needsApply: desired !== live` as
 * `false` — and the very first sync of a repository would write nothing at all.
 *
 * The consequence, stated plainly: **this phase reports config change, not
 * drift.** A baseline that differs reads as `ConfigChanged`, never as `Drift`,
 * because there is no independent observation to attribute the difference to.
 */
const UNREADABLE = "\u0000unreadable";

const KIND = "environment";

/**
 * Deployment environments.
 *
 * @remarks
 * **Runs before secrets and variables**, because an environment-scoped secret
 * cannot be written to an environment that does not exist yet. That ordering
 * lives in `PHASE_NAMES`; this phase only relies on it.
 *
 * Each environment is its own drift resource, so someone adding a required
 * reviewer to `production` in the UI is reported as `production` changing
 * rather than as "environments changed".
 *
 * An environment named in a group but missing from `[environments.*]` is
 * skipped rather than erroring — cross-reference validation is
 * `danglingReferences`'s job — run by `validate` and by `sync` before it writes
 * anything — and duplicating it here would report the same
 * mistake twice with less context.
 *
 * @public
 */
export const environmentsPhase = Effect.gen(function* () {
	const environments = yield* DeploymentEnvironment;
	const applied = yield* AppliedState;
	const logger = yield* SyncLogger;

	const run = (ctx: RepoContext): Effect.Effect<PhaseResult, never, Repo> =>
		Effect.gen(function* () {
			const refs = ctx.config.groups[ctx.group]?.environments ?? [];
			if (refs.length === 0) {
				return { changes: [], errors: [] };
			}

			const baselines = yield* applied.getMany(ctx.slug).pipe(Effect.orElseSucceed(() => new Map()));
			const changes: ChangeRecord[] = [];
			const errors: Array<{ readonly context: string; readonly message: string }> = [];

			for (const name of refs) {
				const desired = ctx.config.environments[name];
				if (desired === undefined) continue;

				// The create route is a PUT and answers with the environment's server
				// state, but reading it back to compare would double the requests for
				// a resource whose configuration we just supplied. Live is taken to
				// equal the last applied value, so this reports config change rather
				// than drift — the same honest limitation as settings.
				const baseline = Option.map(lookup(baselines, KIND, name), (record) => record.fingerprint);
				const desiredPrint = fingerprint(desired);
				const decision = decide(
					desiredPrint,
					Option.getOrElse(baseline, () => UNREADABLE),
					baseline,
				);

				if (isDrift(decision)) {
					yield* logger.driftDetected(KIND, name, decision);
				}

				if (!needsApply(decision)) continue;

				if (!ctx.dryRun) {
					const failure = yield* environments.upsert(name, desired as unknown as Record<string, unknown>).pipe(
						Effect.as(Option.none<string>()),
						Effect.catch((error: { readonly message?: string }) =>
							Effect.succeed(Option.some(error.message ?? String(error))),
						),
					);

					if (Option.isSome(failure)) {
						errors.push({ context: `environment ${name}`, message: failure.value });
						continue;
					}

					yield* applied.record({ repo: ctx.slug, kind: KIND, name }, desiredPrint, ctx.runId).pipe(Effect.ignore);
				}

				yield* logger.syncOperation("sync", KIND, name);
				changes.push({
					repo: ctx.slug,
					kind: KIND,
					name,
					action: isDrift(decision) ? "drift-overwritten" : "updated",
				});
			}

			return { changes, errors };
		});

	return {
		name: "environments",
		appliesTo: (ctx) => (ctx.config.groups[ctx.group]?.environments?.length ?? 0) > 0,
		run,
	} satisfies Phase;
});
