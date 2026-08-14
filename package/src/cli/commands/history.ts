import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import type { ChangeAction, ChangeRecord, RunSummary } from "../../store/SyncJournal.js";
import { SyncJournal } from "../../store/SyncJournal.js";

const limitFlag = Flag.integer("limit").pipe(
	Flag.withDescription("How many runs to show, newest first"),
	Flag.withDefault(20),
);

const repoFlag = Flag.string("repo").pipe(
	Flag.withDescription('Only runs that touched this repository, as "owner/name"'),
	Flag.optional,
);

/**
 * `2026-08-12 22:14` — enough to tell two runs apart, short enough to align.
 *
 * @remarks
 * The journal stores ISO-8601 UTC. Seconds are dropped because the column
 * exists to answer "which run was this", not to time anything; the run id is
 * the exact handle.
 */
const formatWhen = (iso: string): string => iso.replace("T", " ").slice(0, 16);

/** How long a run took, when it finished. */
const formatDuration = (summary: RunSummary): string => {
	if (summary.finishedAt === null) return "—";
	const millis = Date.parse(summary.finishedAt) - Date.parse(summary.startedAt);
	if (Number.isNaN(millis) || millis < 0) return "—";
	if (millis < 1000) return `${millis}ms`;
	const seconds = millis / 1000;
	return seconds < 60
		? `${seconds.toFixed(1)}s`
		: `${Math.floor(seconds / 60)}m${String(Math.round(seconds % 60)).padStart(2, "0")}s`;
};

/**
 * What became of a run.
 *
 * @remarks
 * A run with no `outcome` never reached `finishRun` — the process died mid-run
 * — which is a different and more alarming thing than a recorded failure, so it
 * gets its own word rather than being folded into "failed" or shown as blank.
 */
const formatOutcome = (summary: RunSummary): string => {
	if (summary.outcome !== null) return summary.outcome;
	return summary.finishedAt === null ? "interrupted" : "unknown";
};

/** Pad, but never truncate — a long group name is worth more than the alignment. */
const pad = (value: string, width: number): string => value.padEnd(width);

/**
 * Render the table, sizing each column to its widest cell.
 *
 * @remarks
 * Computed rather than fixed because group names and repository names are
 * user-supplied and unbounded. The `CliLogger` emits each line verbatim, so
 * alignment computed here survives to the terminal.
 */
const renderRows = (summaries: ReadonlyArray<RunSummary>): ReadonlyArray<string> => {
	const rows = summaries.map((summary) => ({
		// The handle `history show` takes. Without it the two commands do not
		// compose: the table was the only place a run id could come from, and it
		// did not print one, so there was no way to name a run.
		//
		// Eight characters, because that is what a person retypes and it is
		// comfortably unique across any realistic journal — `show` accepts any
		// unique prefix and refuses an ambiguous one, so a collision costs a
		// second attempt rather than the wrong run.
		id: summary.id.slice(0, 8),
		when: formatWhen(summary.startedAt),
		outcome: formatOutcome(summary),
		// SQLite has no boolean; `dry_run` comes back as 0 or 1 and nobody wants
		// to read that. An applied run says nothing — the absence is the signal.
		mode: summary.dryRun === 1 ? "dry-run" : "applied",
		group: summary.group ?? "(all)",
		changes: String(summary.changes),
		took: formatDuration(summary),
	}));

	// "UTC" in the header, because the journal stores UTC and these are printed
	// unconverted — a bare local-looking timestamp that is actually UTC is worse
	// than one that says so.
	const header = {
		id: "RUN",
		when: "WHEN (UTC)",
		outcome: "OUTCOME",
		mode: "MODE",
		group: "GROUP",
		changes: "CHANGES",
		took: "TOOK",
	};
	const all = [header, ...rows];
	const width = (key: keyof typeof header): number => Math.max(...all.map((row) => row[key].length));

	return all.map(
		(row) =>
			`${pad(row.id, width("id"))}  ${pad(row.when, width("when"))}  ${pad(row.outcome, width("outcome"))}  ${pad(row.mode, width("mode"))}  ` +
			`${pad(row.group, width("group"))}  ${row.changes.padStart(width("changes"))}  ${row.took}`,
	);
};

/**
 * `reposets history` — what previous runs did.
 *
 * @remarks
 * New with the journal; there is no v3 equivalent. Newest first, because the
 * question is almost always "what happened just now".
 *
 * `--repo` filters to runs that **touched** that repository, which is what the
 * journal's query does — it joins through the recorded changes rather than
 * asking which group the repository belonged to. A run that was configured for
 * a repository but changed nothing in it does not appear, and that is the
 * useful reading: this is a record of what happened, not of what was intended.
 *
 * @public
 */
export const historyHandler = (input: { readonly limit: number; readonly repo: string | undefined }) =>
	Effect.gen(function* () {
		const journal = yield* SyncJournal;
		const summaries = yield* journal.history({
			limit: input.limit,
			...(input.repo === undefined ? {} : { repo: input.repo }),
		});

		if (summaries.length === 0) {
			yield* Effect.log(
				input.repo === undefined
					? "No runs recorded yet. The journal fills in as you sync."
					: `No recorded run has touched ${input.repo}.`,
			);
			return;
		}

		for (const line of renderRows(summaries)) {
			yield* Effect.log(line);
		}

		// Only worth saying when the limit is what stopped the list.
		if (summaries.length === input.limit) {
			yield* Effect.log("");
			yield* Effect.log(`Showing the most recent ${input.limit}. Pass --limit for more.`);
		}
	});

/**
 * The present-tense form of a stored action, for a dry run.
 *
 * @remarks
 * `unchanged` and `drift-overwritten` are **observations, not operations** — a
 * dry run observed them just as truly as a real one would, so neither takes a
 * `would `. Only the three verbs that describe a write are rewritten.
 */
const wouldForm = (action: ChangeAction): string =>
	action === "created" ? "create" : action === "updated" ? "update" : action === "deleted" ? "delete" : action;

/**
 * `reposets history show <run>` — every resource one run touched.
 *
 * @remarks
 * The journal has recorded these from the start and nothing surfaced them, so
 * `12 changes` was a number with no way to ask *which twelve*.
 *
 * The id may be given in full or as a unique prefix, because nobody is going to
 * retype a UUID from a table.
 */
export const showHandler = (prefix: string): Effect.Effect<void, never, SyncJournal> =>
	Effect.gen(function* () {
		const journal = yield* SyncJournal;

		const runs = yield* journal.history({ limit: 1000 }).pipe(Effect.orElseSucceed(() => []));
		const matches = runs.filter((run) => run.id.startsWith(prefix));

		if (matches.length === 0) {
			yield* Effect.logError(`No run matches '${prefix}'.`);
			yield* Effect.sync(() => {
				process.exitCode = 1;
			});
			return;
		}
		if (matches.length > 1) {
			// Refusing beats guessing: showing the wrong run's changes is worse
			// than asking for another character.
			yield* Effect.logError(`'${prefix}' matches ${matches.length} runs. Use more of the id:`);
			for (const run of matches.slice(0, 5)) {
				yield* Effect.logError(`  ${run.id}  ${formatWhen(run.startedAt)}`);
			}
			yield* Effect.sync(() => {
				process.exitCode = 1;
			});
			return;
		}

		const run = matches[0] as RunSummary;
		const changes = yield* journal.changesFor(run.id).pipe(Effect.orElseSucceed(() => []));

		yield* Effect.log(`run ${run.id}`);
		yield* Effect.log(
			`  ${formatWhen(run.startedAt)} · ${run.dryRun === 1 ? "dry-run" : "applied"} · ${run.outcome ?? "unfinished"} · ${formatDuration(run)}`,
		);
		yield* Effect.log("");

		// Before the changes, because on a failed run this is the answer someone
		// came for.
		if (run.error !== null && run.error !== "") {
			yield* Effect.log(`  error: ${run.error}`);
			yield* Effect.log("");
		}

		if (changes.length === 0) {
			yield* Effect.log(
				run.error !== null && run.error !== "" ? "  No resources changed." : "  No resources changed (nothing to do).",
			);
			return;
		}

		// Grouped by repository, because that is how a reader scans it: "what
		// happened to this repo" rather than "what happened to secrets".
		const byRepo = new Map<string, ChangeRecord[]>();
		for (const change of changes) {
			const existing = byRepo.get(change.repo);
			if (existing === undefined) byRepo.set(change.repo, [change]);
			else existing.push(change);
		}

		for (const [repo, records] of byRepo) {
			yield* Effect.log(`  ${repo}`);
			for (const record of records) {
				const detail = record.detail === undefined || record.detail === null ? "" : ` — ${record.detail}`;
				// The settings phase is one resource whose kind and name are both
				// "settings", so naming both reads as a rendering bug.
				const what = record.kind === record.name ? record.kind : `${record.kind} ${record.name}`;
				// A dry run stores its actions in the past tense, because the
				// journal records the decision rather than the write. Rendering
				// them unqualified states work that never happened — the run header
				// says `dry-run`, but a reader scanning resource lines is past it.
				const action = run.dryRun === 1 ? `would ${wouldForm(record.action)}` : record.action;
				yield* Effect.log(`    ${action.padEnd(18)} ${what}${detail}`);
			}
		}
	});

/**
 * `reposets history prune|clear` — the journal, and only the journal.
 *
 * @remarks
 * **These do not touch applied state or the cache**, and that is the whole
 * design. The same database holds the fingerprints drift detection compares
 * against; deleting those does not tidy anything, it disarms the check, so the
 * next run reports a first sync where an out-of-band edit actually happened.
 * A command that quietly did both would be the most dangerous thing in this CLI.
 */
export const pruneHandler = (keep: number): Effect.Effect<void, never, SyncJournal> =>
	Effect.gen(function* () {
		const journal = yield* SyncJournal;
		const removed = yield* journal.prune(keep).pipe(Effect.orElseSucceed(() => 0));
		yield* Effect.log(
			removed === 0
				? `Nothing to prune; ${keep} or fewer runs are recorded.`
				: `Pruned ${removed} run${removed === 1 ? "" : "s"}, keeping the newest ${keep}.`,
		);
		yield* Effect.log("Applied state and the cache are untouched — drift detection still works.");
	});

export const clearHandler = (): Effect.Effect<void, never, SyncJournal> =>
	Effect.gen(function* () {
		const journal = yield* SyncJournal;
		const removed = yield* journal.clear().pipe(Effect.orElseSucceed(() => 0));
		yield* Effect.log(`Cleared ${removed} run${removed === 1 ? "" : "s"} from the journal.`);
		yield* Effect.log("Applied state and the cache are untouched — drift detection still works.");
	});

/**
 * `reposets history`.
 *
 * @public
 */
export const historyCommand = Command.make("history", { limit: limitFlag, repo: repoFlag }, ({ limit, repo }) =>
	historyHandler({ limit, repo: repo._tag === "Some" ? repo.value : undefined }),
).pipe(
	Command.withDescription("Show what previous sync runs did, newest first"),
	Command.withSubcommands([
		Command.make(
			"show",
			{ run: Flag.string("run").pipe(Flag.withDescription("A run id, or a unique prefix")) },
			({ run }) => showHandler(run),
		).pipe(Command.withDescription("Show every resource one run touched")),

		Command.make(
			"prune",
			{
				keep: Flag.integer("keep").pipe(
					Flag.withDescription("How many of the newest runs to keep"),
					Flag.withDefault(50),
				),
			},
			({ keep }) => pruneHandler(keep),
		).pipe(Command.withDescription("Delete all but the newest runs from the journal")),

		Command.make("clear", {}, () => clearHandler()).pipe(Command.withDescription("Delete every run from the journal")),
	]),
);
