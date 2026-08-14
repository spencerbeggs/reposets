import { Store } from "@effected/store";
import { Context, Crypto, DateTime, Effect, Layer } from "effect";
import type { PlatformError } from "effect/PlatformError";
import type { SqlError } from "effect/unstable/sql";

/**
 * What a run did to one resource.
 *
 * @public
 */
export type ChangeAction = "created" | "updated" | "deleted" | "unchanged" | "drift-overwritten";

/**
 * How a run ended.
 *
 * @public
 */
export type RunOutcome = "success" | "failed" | "partial";

/**
 * One resource a run touched.
 *
 * @public
 */
export interface ChangeRecord {
	readonly repo: string;
	readonly kind: string;
	readonly name: string;
	readonly action: ChangeAction;
	readonly detail?: string | undefined;
}

/**
 * One recorded run, as {@link SyncJournalShape.history} returns it.
 *
 * @public
 */
export interface RunSummary {
	readonly id: string;
	readonly startedAt: string;
	readonly finishedAt: string | null;
	readonly group: string | null;
	readonly dryRun: number;
	readonly outcome: string | null;
	/**
	 * Why the run ended as it did, when it ended badly.
	 *
	 * @remarks
	 * `finishRun` has always stored this and nothing read it, so a `partial` run
	 * could be listed but never explained — the most useful thing about a failed
	 * run being the one thing the journal would not tell you.
	 */
	readonly error: string | null;
	readonly changes: number;
}

/**
 * The journal's operations.
 *
 * @public
 */
export interface SyncJournalShape {
	readonly startRun: (options: {
		readonly group?: string | undefined;
		readonly dryRun: boolean;
	}) => Effect.Effect<string, SqlError.SqlError | PlatformError>;
	readonly recordChange: (runId: string, change: ChangeRecord) => Effect.Effect<void, SqlError.SqlError>;
	readonly finishRun: (runId: string, outcome: RunOutcome, error?: string) => Effect.Effect<void, SqlError.SqlError>;
	/**
	 * Every resource one run touched.
	 *
	 * @remarks
	 * The journal has always recorded these; nothing surfaced them, so a run
	 * reporting `12 changes` gave no way to ask which twelve without opening the
	 * SQLite file by hand.
	 */
	readonly changesFor: (runId: string) => Effect.Effect<ReadonlyArray<ChangeRecord>, SqlError.SqlError>;

	/**
	 * Delete all but the newest `keep` runs.
	 *
	 * @remarks
	 * Journal only. Applied-state fingerprints and the cache are **not** touched:
	 * deleting a baseline does not tidy anything, it disarms drift detection, so
	 * the next run reports a first sync where it should have reported an
	 * out-of-band edit. `sync_change` rows follow their run by cascade.
	 *
	 * @returns how many runs were removed.
	 */
	readonly prune: (keep: number) => Effect.Effect<number, SqlError.SqlError>;

	/**
	 * Delete every run and its changes.
	 *
	 * @remarks
	 * Journal only, for the same reason as {@link SyncJournalShape.prune}.
	 *
	 * @returns how many runs were removed.
	 */
	readonly clear: () => Effect.Effect<number, SqlError.SqlError>;

	readonly history: (options: {
		readonly limit: number;
		readonly repo?: string | undefined;
	}) => Effect.Effect<ReadonlyArray<RunSummary>, SqlError.SqlError>;
}

/**
 * Append-only record of what each sync run did.
 *
 * @remarks
 * The journal answers "what did that last sync actually do", after the fact and
 * after the process has exited. It is written on every run, including dry runs —
 * a dry run's record is the useful one when someone asks what *would* have
 * happened.
 *
 * @public
 */
export class SyncJournal extends Context.Service<SyncJournal, SyncJournalShape>()("reposets/SyncJournal", {
	make: Effect.gen(function* () {
		const store = yield* Store;
		const crypto = yield* Crypto.Crypto;
		const sql = store.client;

		return {
			startRun: (options) =>
				Effect.gen(function* () {
					// UUIDv7 rather than v4 for a roughly time-ordered, globally
					// unique id. It is NOT a sort key: v7's timestamp has
					// millisecond precision, so ids minted within the same
					// millisecond order by their random suffix, not by time. Two
					// runs in one millisecond is a test-loop shape rather than a
					// real one, but `history` must be deterministic regardless —
					// it orders by rowid, which is insertion order and exact.
					const id = yield* crypto.randomUUIDv7;
					const startedAt = yield* DateTime.now;

					yield* sql`
						INSERT INTO sync_run (id, started_at, group_name, dry_run)
						VALUES (${id}, ${DateTime.formatIso(startedAt)}, ${options.group ?? null}, ${options.dryRun ? 1 : 0})
					`;

					return id;
				}),

			recordChange: (runId, change) =>
				sql`
					INSERT INTO sync_change (run_id, repo, kind, name, action, detail)
					VALUES (${runId}, ${change.repo}, ${change.kind}, ${change.name}, ${change.action}, ${change.detail ?? null})
				`.pipe(Effect.asVoid),

			finishRun: (runId, outcome, error) =>
				Effect.gen(function* () {
					const finishedAt = yield* DateTime.now;

					yield* sql`
						UPDATE sync_run
						SET finished_at = ${DateTime.formatIso(finishedAt)}, outcome = ${outcome}, error = ${error ?? null}
						WHERE id = ${runId}
					`;
				}).pipe(Effect.asVoid),

			history: (options) =>
				// `repo` filters to runs that TOUCHED that repository — the question
				// actually asked — not runs whose group happened to contain it.
				options.repo === undefined
					? sql<RunSummary>`
							SELECT r.id, r.started_at AS startedAt, r.finished_at AS finishedAt,
							       r.group_name AS "group", r.dry_run AS dryRun, r.outcome, r.error,
							       COUNT(c.run_id) AS changes
							FROM sync_run r
							LEFT JOIN sync_change c ON c.run_id = r.id
							GROUP BY r.id
							ORDER BY r.rowid DESC
							LIMIT ${options.limit}
						`
					: sql<RunSummary>`
							SELECT r.id, r.started_at AS startedAt, r.finished_at AS finishedAt,
							       r.group_name AS "group", r.dry_run AS dryRun, r.outcome, r.error,
							       COUNT(c.run_id) AS changes
							FROM sync_run r
							JOIN sync_change c ON c.run_id = r.id
							WHERE c.repo = ${options.repo}
							GROUP BY r.id
							ORDER BY r.rowid DESC
							LIMIT ${options.limit}
						`,
			changesFor: (runId) =>
				sql<ChangeRecord>`
					SELECT repo, kind, name, action, detail
					FROM sync_change
					WHERE run_id = ${runId}
					ORDER BY rowid
				`,

			// `rowid` rather than the UUIDv7 primary key, for the same reason
			// `history` orders by it: v7 is millisecond-precision, so ids minted in
			// the same millisecond sort by their random suffix rather than by time.
			prune: (keep) =>
				Effect.gen(function* () {
					const doomed = yield* sql<{ readonly id: string }>`
						SELECT id FROM sync_run
						WHERE rowid NOT IN (SELECT rowid FROM sync_run ORDER BY rowid DESC LIMIT ${keep})
					`;
					if (doomed.length === 0) return 0;
					// `sync_change` cascades on the foreign key, so the changes go with
					// their run rather than being orphaned.
					yield* sql`DELETE FROM sync_run WHERE id IN ${sql.in(doomed.map((row) => row.id))}`;
					return doomed.length;
				}),

			clear: () =>
				Effect.gen(function* () {
					const counted = yield* sql<{ readonly n: number }>`SELECT COUNT(*) AS n FROM sync_run`;
					yield* sql`DELETE FROM sync_run`;
					return counted[0]?.n ?? 0;
				}),
		} satisfies SyncJournalShape;
	}),
}) {}

/**
 * Live journal, over the ambient {@link Store}.
 *
 * @public
 */
export const SyncJournalLive: Layer.Layer<SyncJournal, never, Store | Crypto.Crypto> = Layer.effect(
	SyncJournal,
	SyncJournal.make,
);
