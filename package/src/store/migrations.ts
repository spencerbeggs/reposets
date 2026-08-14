import type { StoreMigration } from "@effected/store";
import { Effect } from "effect";

/**
 * The sync journal: one row per run, plus one row per resource the run changed.
 *
 * @remarks
 * Both tables are one migration because they are one unit — rolling back a
 * journal that kept its child table would leave `sync_change` orphaned with a
 * dangling foreign key.
 *
 * `group_name`, not `group` — `GROUP` is a SQL reserved word.
 *
 * `sync_run.id` is an application-generated identifier rather than an
 * autoincrementing integer, so a run's child rows can be written without a round
 * trip to read back the parent's rowid.
 */
const journal: StoreMigration = {
	id: 1,
	name: "journal",
	up: (sql) =>
		Effect.gen(function* () {
			yield* sql`
				CREATE TABLE sync_run (
					id           TEXT    PRIMARY KEY,
					started_at   TEXT    NOT NULL,
					finished_at  TEXT,
					group_name   TEXT,
					dry_run      INTEGER NOT NULL DEFAULT 0,
					outcome      TEXT,
					error        TEXT
				)
			`;
			yield* sql`
				CREATE TABLE sync_change (
					run_id  TEXT NOT NULL REFERENCES sync_run(id) ON DELETE CASCADE,
					repo    TEXT NOT NULL,
					kind    TEXT NOT NULL,
					name    TEXT NOT NULL,
					action  TEXT NOT NULL,
					detail  TEXT
				)
			`;
			yield* sql`CREATE INDEX sync_change_run ON sync_change(run_id)`;
		}),
	down: (sql) =>
		Effect.gen(function* () {
			yield* sql`DROP TABLE sync_change`;
			yield* sql`DROP TABLE sync_run`;
		}),
};

/**
 * Last-applied fingerprints, the basis of drift detection.
 *
 * @remarks
 * Keyed `(repo, kind, name)` so drift is tracked per resource per repo — two
 * repos in one group drift independently, which is the whole reason to record it.
 */
const drift: StoreMigration = {
	id: 2,
	name: "drift",
	up: (sql) => sql`
		CREATE TABLE applied_state (
			repo         TEXT NOT NULL,
			kind         TEXT NOT NULL,
			name         TEXT NOT NULL,
			fingerprint  TEXT NOT NULL,
			applied_at   TEXT NOT NULL,
			run_id       TEXT NOT NULL,
			PRIMARY KEY (repo, kind, name)
		)
	`,
	down: (sql) => sql`DROP TABLE applied_state`,
};

/**
 * Every migration reposets applies, in ascending `id` order.
 *
 * @remarks
 * **Every migration defines `down`.** `rollback` skips a migration that has none
 * while still removing its ledger row, which would leave the schema change in
 * place and let a later `migrate` re-run its `up` against an existing table.
 *
 * @public
 */
export const migrations: ReadonlyArray<StoreMigration> = [journal, drift];
