import type { Repo } from "@effected/github";
import { Ruleset as RulesetService } from "@effected/github";
import { Effect, Option, Redacted } from "effect";
import { fingerprint } from "../../lib/fingerprint.js";
import type { Ruleset } from "../../schemas/ruleset.js";
import { buildRulesetPayload } from "../../schemas/ruleset.js";
import { SyncLogger } from "../../services/SyncLogger.js";
import { AppliedState, lookup } from "../../store/AppliedState.js";
import { RepoCache } from "../../store/RepoCache.js";
import type { ChangeRecord } from "../../store/SyncJournal.js";
import { decide, isDrift, needsApply } from "../decide.js";
import type { Phase, PhaseResult, RepoContext } from "../phase.js";
import { capture, read } from "./resource.js";

const KIND = "ruleset";

/** Stands in for a ruleset that is not on the repository at all. */
const ABSENT = " absent";

/**
 * Substitute `{ resolved }` references with credential values, in place.
 *
 * @remarks
 * A ruleset can carry `{ resolved: "LABEL" }` wherever a numeric id is wanted —
 * an integration id on a status check, a repository id on a required workflow.
 * The substitution walks the decoded ruleset because the references can appear
 * at any depth, and the shape is a discriminated union rather than a flat
 * record.
 *
 * Values come from `ctx.credentials` and are numeric ids, not secrets. They are
 * unwrapped here because they end up in the API payload as numbers; nothing
 * secret should be reachable this way, and a config that puts one there has
 * mis-declared it.
 */
const substituteResolved = (node: unknown, ctx: RepoContext, missing: Set<string>): unknown => {
	if (Array.isArray(node)) {
		return node.map((item) => substituteResolved(item, ctx, missing));
	}
	if (typeof node !== "object" || node === null) {
		return node;
	}

	const record = node as Record<string, unknown>;
	const label = record.resolved;

	// A `{ resolved }` node is exactly that one key — anything else is an
	// ordinary object that happens to contain the word.
	if (typeof label === "string" && Object.keys(record).length === 1) {
		const value = ctx.credentials.get(label);
		if (value === undefined) {
			missing.add(label);
			return node;
		}
		// The single unwrap in this file. These references resolve to numeric
		// ids — an integration id, a repository id — never to a secret; a config
		// that puts a secret here has mis-declared it.
		const text = Redacted.value(value);
		const asNumber = Number(text);
		return text.trim() === "" || Number.isNaN(asNumber) ? text : asNumber;
	}

	const out: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(record)) {
		out[key] = substituteResolved(child, ctx, missing);
	}
	return out;
};

/**
 * Repository rulesets.
 *
 * @remarks
 * Drift here is **presence-level**, not value-level, and the reason is worth
 * stating because it differs from both neighbours. `GET /rulesets` returns
 * *summaries* — name, id, source type — not the rules themselves; the full
 * configuration needs `GET /rulesets/{id}`, one request per ruleset per
 * repository. So a deleted ruleset is detected and restored, and one edited in
 * the UI is not.
 *
 * That is a cost decision rather than an API limit, unlike `secrets` where no
 * value exists to read. Lifting it means a read per ruleset; worth doing if
 * ruleset drift turns out to matter in practice, and cheap to change here since
 * only `livePrint` would move.
 *
 * **A renamed ruleset creates a second one rather than renaming the first.**
 * GitHub identifies a ruleset by a numeric id assigned at creation, and the
 * config has only a name — so `syncRuleset` matches on name and cannot tell a
 * rename from a new ruleset. That is v3's behaviour, ported deliberately; the
 * `cleanup` phase is what removes the orphan. Fixing it properly needs the
 * applied-state table to remember the id, which is a design change rather than
 * a port.
 *
 * @public
 */
export const rulesetsPhase = Effect.gen(function* () {
	const rulesets = yield* RulesetService;
	const cache = yield* RepoCache;
	const applied = yield* AppliedState;
	const logger = yield* SyncLogger;

	/** Resolve `{ team }` bypass actors to numeric ids, through the cache. */
	const resolveBypassActors = (
		ctx: RepoContext,
		ruleset: Ruleset,
	): Effect.Effect<
		{
			readonly ruleset: Ruleset;
			readonly errors: ReadonlyArray<{ context: string; message: string }>;
		},
		never,
		Repo
	> =>
		Effect.gen(function* () {
			const actors = ruleset.bypass_actors;
			if (actors === undefined) return { ruleset, errors: [] };

			const errors: Array<{ context: string; message: string }> = [];
			const resolved: Array<Record<string, unknown>> = [];

			for (const actor of actors as ReadonlyArray<Record<string, unknown>>) {
				const id = actor.actor_id;
				if (typeof id === "object" && id !== null && "resolved" in id) {
					const slug = String((id as { resolved: unknown }).resolved);
					const outcome = yield* read(cache.teamId(ctx.owner, slug, rulesets.teamId(slug)));
					if ("failed" in outcome) {
						errors.push({ context: `resolve team '${slug}'`, message: outcome.failed });
						continue;
					}
					resolved.push({ ...actor, actor_id: outcome.value });
					continue;
				}
				resolved.push(actor);
			}

			return { ruleset: { ...ruleset, bypass_actors: resolved } as unknown as Ruleset, errors };
		});

	const run = (ctx: RepoContext): Effect.Effect<PhaseResult, never, Repo> =>
		Effect.gen(function* () {
			const refs = ctx.config.groups[ctx.group]?.rulesets ?? [];
			if (refs.length === 0) {
				return { changes: [], errors: [] };
			}

			const changes: ChangeRecord[] = [];
			const errors: Array<{ readonly context: string; readonly message: string }> = [];

			const listing = yield* read(rulesets.list());
			if ("failed" in listing) {
				return { changes, errors: [{ context: "list rulesets", message: listing.failed }] };
			}

			// Only the repository's own rulesets are comparable; an inherited one
			// is the organization's and is not ours to reconcile.
			const live = new Map(
				listing.value.filter((entry) => entry.source_type !== "Organization").map((entry) => [entry.name, entry]),
			);

			const baselines = yield* applied.getMany(ctx.slug).pipe(Effect.orElseSucceed(() => new Map()));

			for (const ref of refs) {
				const configured = ctx.config.rulesets[ref];
				if (configured === undefined) continue;

				const missing = new Set<string>();
				const substituted = substituteResolved(configured, ctx, missing) as Ruleset;
				for (const label of missing) {
					errors.push({
						context: `ruleset ${configured.name}`,
						message: `credential label '${label}' is not defined in the active profile's [resolve] section`,
					});
				}

				const withActors = yield* resolveBypassActors(ctx, substituted);
				errors.push(...withActors.errors);

				const payload = buildRulesetPayload(withActors.ruleset);
				const desiredPrint = fingerprint(payload);
				const baseline = Option.map(lookup(baselines, KIND, payload.name), (record) => record.fingerprint);

				// The listing carries the ruleset's own shape rather than the payload
				// we send, so a present ruleset is taken to match the baseline and an
				// absent one is not — the same presence-level comparison `secrets`
				// uses, for the same reason: the two shapes are not comparable.
				const livePrint = live.has(payload.name)
					? Option.getOrElse(baseline, () => fingerprint(ABSENT))
					: fingerprint(ABSENT);

				const decision = decide(desiredPrint, livePrint, baseline);

				if (isDrift(decision)) {
					yield* logger.driftDetected(KIND, payload.name, decision);
				}

				if (!needsApply(decision)) continue;

				if (!ctx.dryRun) {
					const failure = yield* capture(`ruleset ${payload.name}`, rulesets.upsert(payload));
					if (failure !== undefined) {
						errors.push(failure);
						continue;
					}

					yield* applied
						.record({ repo: ctx.slug, kind: KIND, name: payload.name }, desiredPrint, ctx.runId)
						.pipe(Effect.ignore);
				}

				yield* logger.syncOperation("sync", KIND, payload.name);
				changes.push({
					repo: ctx.slug,
					kind: KIND,
					name: payload.name,
					action: isDrift(decision) ? "drift-overwritten" : "updated",
				});
			}

			return { changes, errors };
		});

	return {
		name: "rulesets",
		appliesTo: (ctx) => (ctx.config.groups[ctx.group]?.rulesets?.length ?? 0) > 0,
		run,
	} satisfies Phase;
});
