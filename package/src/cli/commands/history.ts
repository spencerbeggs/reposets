import type { Block, TokenName } from "@effected/cli";
import { CliInteractive, CliMessage, Doc, Fmt, Status } from "@effected/cli";
import { CliUi, Select } from "@effected/cli/ui";
import { Effect, Option } from "effect";
import { CliError, Command, Flag } from "effect/cli";
import type { ChangeAction, ChangeRecord, RunSummary } from "../../store/SyncJournal.js";
import { SyncJournal } from "../../store/SyncJournal.js";

const limitFlag = Flag.Int("limit").pipe(
	Flag.withDefault(20),
	Flag.withDescription("How many runs to show, newest first"),
);

const repoFlag = Flag.String("repo").pipe(
	Flag.optional,
	Flag.withDescription('Only runs that touched this repository, as "owner/name"'),
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

/**
 * The status glyph an outcome is drawn with.
 *
 * @remarks
 * `interrupted` is a failure, not a skip: the process died mid-run, which is
 * more alarming than a recorded failure, and must not read as benign. Only an
 * outcome this code does not recognise is drawn as `skip`.
 */
const outcomeStatus = (outcome: string): "success" | "warning" | "failure" | "skip" =>
	outcome === "success"
		? "success"
		: outcome === "partial"
			? "warning"
			: outcome === "failed" || outcome === "interrupted"
				? "failure"
				: "skip";

// SQLite has no boolean; `dry_run` comes back as 0 or 1 and nobody wants to
// read that.
const formatMode = (summary: RunSummary): string => (summary.dryRun === 1 ? "dry-run" : "applied");

/** The fewest characters a displayed run id is cut to. */
const MIN_ID_LENGTH = 8;

/** How many leading characters two strings share. */
const commonPrefixLength = (a: string, b: string): number => {
	let i = 0;
	while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
	return i;
};

/**
 * The handle `history show` takes: each run id cut to the shortest prefix no
 * other run in the journal shares, and never shorter than eight characters.
 *
 * @remarks
 * Without a printed id the two commands do not compose: the table was the only
 * place a run id could come from, so there was no way to name a run.
 *
 * A fixed eight characters was the first answer and it was wrong. Run ids are
 * UUIDv7, whose leading 48 bits are a millisecond timestamp, so the first eight
 * hex digits only change about every 65 seconds — two runs a minute apart
 * printed the same id, and `show --run` with it was refused as ambiguous. The
 * advertised handle did not work for exactly the runs someone just made.
 *
 * So this is git's abbreviated-hash rule: eight characters while that is
 * enough, longer where it is not. In sorted order the id sharing the longest
 * prefix with any id is one of its two neighbours, so one sort and one pass
 * give every id its length. `ids` must be **every** run in the journal, not the
 * page being printed: a prefix unique within twenty rows can still match a
 * twenty-first run, and `show` matches against the journal, not the page.
 * A hyphen never ends an abbreviation — UUID hyphens sit at fixed positions,
 * so they are always shared and the first differing character is a digit.
 */
const abbreviator = (ids: Iterable<string>): ((id: string) => string) => {
	const sorted = [...new Set(ids)].sort();
	const lengths = new Map<string, number>();
	sorted.forEach((id, i) => {
		const before = i > 0 ? commonPrefixLength(sorted[i - 1] as string, id) : 0;
		const after = i < sorted.length - 1 ? commonPrefixLength(id, sorted[i + 1] as string) : 0;
		lengths.set(id, Math.max(MIN_ID_LENGTH, Math.max(before, after) + 1));
	});
	return (id) => id.slice(0, lengths.get(id) ?? MIN_ID_LENGTH);
};

/**
 * The {@link abbreviator} for this journal.
 *
 * @remarks
 * The runs about to be printed are folded in alongside the journal's ids, so a
 * run that lands between the two reads still gets a length rather than the
 * eight-character fallback.
 */
const journalAbbreviator = (journal: SyncJournal["Service"], shown: ReadonlyArray<RunSummary>) =>
	journal.runIds().pipe(Effect.map((ids) => abbreviator([...ids, ...shown.map((run) => run.id)])));

/**
 * The run table, as a document.
 *
 * @remarks
 * A `Doc.table` sizes each column to its widest cell, which matters because
 * group and repository names are user-supplied and unbounded; it pads but never
 * truncates, so a long group name is worth more than the alignment. Plain for
 * an agent, painted for a person.
 */
const runTable = (summaries: ReadonlyArray<RunSummary>, abbreviate: (id: string) => string): Block =>
	Doc.table(
		[
			{ header: "RUN" },
			// "UTC" in the header, because the journal stores UTC and these are
			// printed unconverted — a bare local-looking timestamp that is actually
			// UTC is worse than one that says so.
			{ header: "WHEN (UTC)" },
			{ header: "OUTCOME" },
			{ header: "MODE" },
			{ header: "GROUP" },
			{ header: "CHANGES", align: "right" },
			{ header: "TOOK" },
		],
		summaries.map((summary) => {
			const outcome = formatOutcome(summary);
			return [
				abbreviate(summary.id),
				formatWhen(summary.startedAt),
				[Doc.status(Status.core, outcomeStatus(outcome)), " ", outcome],
				formatMode(summary),
				summary.group ?? "(all)",
				String(summary.changes),
				formatDuration(summary),
			];
		}),
	);

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

		// A query that matches nothing succeeds: an empty journal is a fact to
		// report, not an error.
		if (summaries.length === 0) {
			yield* CliMessage.info(
				input.repo === undefined
					? "No runs recorded yet. The journal fills in as you sync."
					: `No recorded run has touched ${input.repo}.`,
			);
			return;
		}

		const abbreviate = yield* journalAbbreviator(journal, summaries);
		yield* Doc.print([runTable(summaries, abbreviate)]);

		// Only worth saying when the limit is what stopped the list. Narration
		// about the table rather than part of it, so it goes to stderr and a
		// piped table stays a table.
		if (summaries.length === input.limit) {
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

/** The token an action is painted with: what it did to the resource, at a glance. */
const actionToken = (action: ChangeAction, dryRun: boolean): TokenName =>
	dryRun
		? "info"
		: action === "created"
			? "success"
			: action === "deleted"
				? "failure"
				: action === "drift-overwritten"
					? "warning"
					: action === "unchanged"
						? "muted"
						: "info";

/**
 * The refusal for a missing `--run` where nobody can be asked.
 *
 * @remarks
 * A usage error (exit 64) naming the flag, and the command that lists the ids
 * to pass to it — the same answer a person gets from the picker, spelled out
 * for a script.
 */
const runRequired = (): CliError.UserError =>
	new CliError.UserError({
		cause: "Pass --run <id> (a run id or a unique prefix); `reposets history` lists them.",
	});

/**
 * How many recent runs the picker offers.
 *
 * @remarks
 * The question it answers is "what did that run just now do", so the newest
 * runs are the ones worth scrolling; an older run is still reachable by
 * `--run` with its id from `reposets history --limit`.
 */
const PICKER_RUNS = 50;

/**
 * Which run to show, when `--run` was not given.
 *
 * @remarks
 * Interactive, a `Select` over the recent runs, each labelled the way the
 * table names it — short id, when, outcome, group — with mode, change count and
 * duration as detail. Esc is the kit's `Cancelled`, left to propagate so
 * `CliRuntime.main` prints its one line and exits 130; a cancelled question is
 * not a successful answer.
 *
 * Called only for an interactive run: `showHandler` refuses a
 * non-interactive one (an agent, CI, a pipe) before reaching here, exactly as a
 * missing required flag would — exit 64, naming `--run`.
 */
const pickRun = (runs: ReadonlyArray<RunSummary>, abbreviate: (id: string) => string) =>
	Effect.gen(function* () {
		return yield* CliUi.prompt(
			Select.screen({
				message: "Which run?",
				choices: runs.slice(0, PICKER_RUNS).map((run) => {
					const outcome = formatOutcome(run);
					return {
						// Group names are user-supplied and land in a line this code
						// builds, not in a document that sanitises itself.
						label: `${abbreviate(run.id)} · ${formatWhen(run.startedAt)} · ${outcome} · ${Fmt.sanitize(run.group ?? "(all)")}`,
						detail: `${formatMode(run)} · ${run.changes} change${run.changes === 1 ? "" : "s"} · ${formatDuration(run)}`,
						value: run,
					};
				}),
			}),
		).pipe(
			// Unreachable while `showHandler` checks `CliInteractive` first, but
			// `CliUi.prompt` with no default can fail this way, and the honest
			// answer is the same refusal.
			Effect.catchTag("NotInteractive", () => Effect.fail(runRequired())),
		);
	});

/**
 * Resolve a prefix to exactly one run, or refuse.
 *
 * @remarks
 * Both refusals are usage errors — the user named a run that is not there, or
 * not uniquely — so they fail with `UserError` and exit 64. `Command.runWith`
 * prints the message once, on stderr.
 */
const matchRun = (runs: ReadonlyArray<RunSummary>, prefix: string): Effect.Effect<RunSummary, CliError.UserError> => {
	const matches = runs.filter((run) => run.id.startsWith(prefix));
	if (matches.length === 0) {
		return Effect.fail(new CliError.UserError({ cause: `No run matches '${prefix}'.` }));
	}
	if (matches.length > 1) {
		// Refusing beats guessing: showing the wrong run's changes is worse
		// than asking for another character.
		const candidates = matches.slice(0, 5).map((run) => `  ${run.id}  ${formatWhen(run.startedAt)}`);
		return Effect.fail(
			new CliError.UserError({
				cause: [`'${prefix}' matches ${matches.length} runs. Use more of the id:`, ...candidates].join("\n"),
			}),
		);
	}
	return Effect.succeed(matches[0] as RunSummary);
};

/**
 * `reposets history show [--run <id>]` — every resource one run touched.
 *
 * @remarks
 * The journal has recorded these from the start and nothing surfaced them, so
 * `12 changes` was a number with no way to ask *which twelve*.
 *
 * The id may be given in full or as a unique prefix, because nobody is going to
 * retype a UUID from a table. Without `--run`, a person at a terminal picks
 * from the recent runs and anyone else is refused with exit 64 (see
 * {@link pickRun}). The refusal comes first and does not look at the journal,
 * so a script's `history show` without `--run` is exit 64 whether or not any
 * run is recorded. Only a person with an empty journal is told "No runs
 * recorded yet" and exits 0 — there is nothing to pick, as `reposets history`
 * says.
 *
 * The report is a `Doc` — the run header, its error, then the changes grouped
 * by repository — printed for whoever is reading.
 */
export const showHandler = (prefix: string | undefined) =>
	Effect.gen(function* () {
		const journal = yield* SyncJournal;

		const runs = yield* journal.history({ limit: 1000 }).pipe(Effect.orElseSucceed(() => []));

		let run: RunSummary;
		if (prefix === undefined) {
			// Refused before the journal is consulted, so the exit code of a
			// non-interactive invocation never depends on what the journal holds.
			if (!(yield* CliInteractive)) return yield* Effect.fail(runRequired());
			// Interactive with nothing to pick: say so and succeed.
			if (runs.length === 0) {
				yield* CliMessage.info("No runs recorded yet. The journal fills in as you sync.");
				return;
			}
			const abbreviate = yield* journalAbbreviator(journal, runs).pipe(
				// Best-effort like the run list above: without the journal's ids the
				// picker still works, labelled with the runs it can see.
				Effect.orElseSucceed(() => abbreviator(runs.map((r) => r.id))),
			);
			run = yield* pickRun(runs, abbreviate);
		} else {
			run = yield* matchRun(runs, prefix);
		}

		const changes = yield* journal.changesFor(run.id).pipe(Effect.orElseSucceed(() => []));
		const outcome = run.outcome ?? "unfinished";
		const failed = run.error !== null && run.error !== "";

		const body: Array<Block> = [
			Doc.paragraph(
				Doc.status(Status.core, outcomeStatus(run.outcome ?? "interrupted")),
				" ",
				`${formatWhen(run.startedAt)} · ${formatMode(run)} · ${outcome} · ${formatDuration(run)}`,
			),
		];

		// Before the changes, because on a failed run this is the answer someone
		// came for.
		if (failed) {
			body.push(Doc.paragraph(Doc.text("error: ", "failure"), run.error ?? ""));
		}

		if (changes.length === 0) {
			body.push(Doc.paragraph(failed ? "No resources changed." : "No resources changed (nothing to do)."));
		} else {
			// Grouped by repository, because that is how a reader scans it: "what
			// happened to this repo" rather than "what happened to secrets".
			const byRepo = new Map<string, ChangeRecord[]>();
			for (const change of changes) {
				const existing = byRepo.get(change.repo);
				if (existing === undefined) byRepo.set(change.repo, [change]);
				else existing.push(change);
			}

			const dryRun = run.dryRun === 1;
			body.push(
				Doc.list(
					[...byRepo].map(([repo, records]) =>
						Doc.section(repo, [
							Doc.lines(
								records.map((record) => {
									const detail = record.detail === undefined || record.detail === null ? "" : ` — ${record.detail}`;
									// The settings phase is one resource whose kind and name are
									// both "settings", so naming both reads as a rendering bug.
									const what = record.kind === record.name ? record.kind : `${record.kind} ${record.name}`;
									// A dry run stores its actions in the past tense, because the
									// journal records the decision rather than the write. Rendering
									// them unqualified states work that never happened — the run
									// header says `dry-run`, but a reader scanning resource lines is
									// past it.
									const action = dryRun ? `would ${wouldForm(record.action)}` : record.action;
									return [Doc.text(action.padEnd(18), actionToken(record.action, dryRun)), " ", what, detail];
								}),
							),
						]),
					),
					{ compact: true },
				),
			);
		}

		yield* Doc.print([Doc.section(`run ${run.id}`, body)]);
	});

const UNTOUCHED = "Applied state and the cache are untouched — drift detection still works.";

/**
 * `reposets history prune|clear` — the journal, and only the journal.
 *
 * @remarks
 * **These do not touch applied state or the cache**, and that is the whole
 * design. The same database holds the fingerprints drift detection compares
 * against; deleting those does not tidy anything, it disarms the check, so the
 * next run reports a first sync where an out-of-band edit actually happened.
 * A command that quietly did both would be the most dangerous thing in this CLI.
 *
 * The result is a `CliMessage` line, and so is the statement that the
 * baselines survived: said every time, because the sentence matters as much as
 * the deletion.
 */
export const pruneHandler = (keep: number) =>
	Effect.gen(function* () {
		const journal = yield* SyncJournal;
		const removed = yield* journal.prune(keep).pipe(Effect.orElseSucceed(() => 0));
		yield* removed === 0
			? CliMessage.info(`Nothing to prune; ${keep} or fewer runs are recorded.`)
			: CliMessage.success(`Pruned ${removed} run${removed === 1 ? "" : "s"}, keeping the newest ${keep}.`);
		yield* CliMessage.info(UNTOUCHED);
	});

/**
 * `reposets history clear` — every run, and nothing else; see {@link pruneHandler}.
 */
export const clearHandler = () =>
	Effect.gen(function* () {
		const journal = yield* SyncJournal;
		const removed = yield* journal.clear().pipe(Effect.orElseSucceed(() => 0));
		yield* CliMessage.success(`Cleared ${removed} run${removed === 1 ? "" : "s"} from the journal.`);
		yield* CliMessage.info(UNTOUCHED);
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
			{
				run: Flag.String("run").pipe(
					Flag.optional,
					Flag.withDescription("A run id, or a unique prefix; omitted, a terminal picks from recent runs"),
				),
			},
			({ run }) => showHandler(Option.getOrUndefined(run)),
		).pipe(Command.withDescription("Show every resource one run touched")),

		Command.make(
			"prune",
			{
				keep: Flag.Int("keep").pipe(Flag.withDefault(50), Flag.withDescription("How many of the newest runs to keep")),
			},
			({ keep }) => pruneHandler(keep),
		).pipe(Command.withDescription("Delete all but the newest runs from the journal")),

		Command.make("clear", {}, () => clearHandler()).pipe(Command.withDescription("Delete every run from the journal")),
	]),
);
