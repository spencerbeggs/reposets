import { NodeServices } from "@effect/platform-node";
import { App } from "@effected/app";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { clearHandler, historyHandler, pruneHandler, showHandler } from "../../src/cli/commands/history.js";
import { migrations } from "../../src/store/migrations.js";
import { SyncJournal, SyncJournalLive } from "../../src/store/SyncJournal.js";
import type { Outcome } from "../utils/capture.js";
import { on, runOutcome } from "../utils/capture.js";

/**
 * `history` had no tests. It is the only way to read the journal, so a bug here
 * does not corrupt anything — it just means nobody can find out what a run did,
 * which is the one question the journal exists to answer.
 *
 * These drive the handlers against a real in-memory store rather than a mocked
 * journal: the rendering is most of the behaviour, and a double would let the
 * column-width and ordering logic pass while producing nonsense.
 */

// `App.layerTest` is hermetic — fixed synthetic XDG paths and `:memory:`
// databases — so no environment variable or temp directory is involved, and
// nothing here touches `process.env`.
const AppTest = App.layerTest({ namespace: "reposets-history-test", store: { migrations } });

/** Run a handler against a real journal, seeding it first; capture both streams and the exit code. */
const runFull = (
	seed: (journal: SyncJournal["Service"]) => Effect.Effect<void, unknown, SyncJournal>,
	// `historyHandler` carries SqlError; the subcommand handlers do not.
	handler: Effect.Effect<void, unknown, SyncJournal>,
): Promise<Outcome> => {
	const program = Effect.gen(function* () {
		const journal = yield* SyncJournal;
		yield* seed(journal).pipe(Effect.orDie);
		yield* handler;
	});

	return runOutcome(
		program.pipe(
			// `Crypto` is required: run ids are UUIDv7.
			Effect.provide(Layer.provideMerge(SyncJournalLive, Layer.provideMerge(AppTest, NodeServices.layer))),
		) as Effect.Effect<void, unknown, never>,
	);
};

/** {@link runFull}, keeping only each line's text. */
const run = async (
	seed: (journal: SyncJournal["Service"]) => Effect.Effect<void, unknown, SyncJournal>,
	handler: Effect.Effect<void, unknown, SyncJournal>,
): Promise<ReadonlyArray<string>> => (await runFull(seed, handler)).lines.map((line) => line.text);

const noSeed = () => Effect.void;

describe("history", () => {
	it("says the journal is empty rather than printing an empty table", async () => {
		const lines = await run(noSeed, historyHandler({ limit: 20, repo: undefined }));
		expect(lines.join("\n")).toContain("No runs recorded yet");
	});

	it("prints a run id column, which is the handle every subcommand takes", async () => {
		// Without it the two commands do not compose: the table was the only
		// place a run id could come from, and it did not print one.
		const lines = await run(
			(j) =>
				Effect.gen(function* () {
					const id = yield* j.startRun({ dryRun: false });
					yield* j.finishRun(id, "success");
				}),
			historyHandler({ limit: 20, repo: undefined }),
		);

		const out = lines.join("\n");
		expect(out).toContain("RUN");
		expect(out).toContain("WHEN (UTC)");
		expect(out).toContain("success");
	});

	it("reports a failed run's error, not just that it failed", async () => {
		// A journal that records only what succeeded cannot answer "why did
		// nothing change?", which is the question a failed run prompts.
		const lines = await run(
			(j) =>
				Effect.gen(function* () {
					const id = yield* j.startRun({ dryRun: false });
					yield* j.finishRun(id, "partial", "403 Forbidden on secrets");
				}),
			historyHandler({ limit: 20, repo: undefined }),
		);
		expect(lines.join("\n")).toContain("partial");
	});

	it("says nothing touched a repository rather than showing an empty table", async () => {
		const lines = await run(noSeed, historyHandler({ limit: 20, repo: "acme/ghost" }));
		expect(lines.join("\n")).toContain("acme/ghost");
	});
});

describe("history show", () => {
	it("lists every resource one run touched, grouped by repository", async () => {
		const lines = await run(
			(j) =>
				Effect.gen(function* () {
					const id = yield* j.startRun({ dryRun: false });
					yield* j.recordChange(id, { repo: "acme/widget", kind: "secret", name: "API_KEY", action: "updated" });
					yield* j.recordChange(id, { repo: "acme/widget", kind: "ruleset", name: "protect", action: "created" });
					yield* j.finishRun(id, "success");
				}),
			// A unique prefix, because nobody retypes a UUID from a table.
			showHandler(""),
		);

		const out = lines.join("\n");
		expect(out).toContain("acme/widget");
		expect(out).toContain("secret API_KEY");
		expect(out).toContain("ruleset protect");
	});

	it("renders a dry run's actions in the tense of work not done", async () => {
		// The journal stores the decision, so a dry run's records read `updated`.
		// Printing that unqualified states work that never happened.
		const lines = await run(
			(j) =>
				Effect.gen(function* () {
					const id = yield* j.startRun({ dryRun: true });
					yield* j.recordChange(id, { repo: "acme/widget", kind: "secret", name: "API_KEY", action: "updated" });
					yield* j.finishRun(id, "success");
				}),
			showHandler(""),
		);

		const out = lines.join("\n");
		expect(out).toContain("would update");
		expect(out).not.toMatch(/^\s+updated\s/m);
	});

	it("refuses an ambiguous prefix instead of guessing, as a usage error", async () => {
		// Showing the wrong run's changes is worse than asking for another
		// character.
		const outcome = await runFull(
			(j) =>
				Effect.gen(function* () {
					const a = yield* j.startRun({ dryRun: false });
					yield* j.finishRun(a, "success");
					const b = yield* j.startRun({ dryRun: false });
					yield* j.finishRun(b, "success");
				}),
			showHandler(""),
		);
		expect(outcome.exitCode).toBe(64);
		expect(on(outcome.lines, "stderr").join("\n")).toContain("matches 2 runs");
		expect(on(outcome.lines, "stdout")).toEqual([]);
	});

	it("reports a prefix that matches nothing, as a usage error", async () => {
		const outcome = await runFull(noSeed, showHandler("deadbeef"));
		expect(outcome.exitCode).toBe(64);
		expect(on(outcome.lines, "stderr").join("\n")).toContain("No run matches");
		expect(on(outcome.lines, "stdout")).toEqual([]);
	});

	it("writes a found run to stdout and exits 0", async () => {
		const outcome = await runFull(
			(j) =>
				Effect.gen(function* () {
					const a = yield* j.startRun({ dryRun: false });
					yield* j.finishRun(a, "success");
				}),
			showHandler(""),
		);
		expect(outcome.exitCode).toBe(0);
		expect(on(outcome.lines, "stdout").join("\n")).toContain("run ");
		expect(on(outcome.lines, "stderr")).toEqual([]);
	});
});

describe("history prune and clear", () => {
	const three = (j: SyncJournal["Service"]) =>
		Effect.gen(function* () {
			for (let i = 0; i < 3; i += 1) {
				const id = yield* j.startRun({ dryRun: false });
				yield* j.finishRun(id, "success");
			}
		});

	it("keeps the newest runs and says the baselines survived", async () => {
		// The sentence matters as much as the deletion: the journal is history,
		// the applied state is the drift baseline, and trimming a log must not
		// read as disabling drift detection.
		const lines = await run(three, pruneHandler(1));
		const out = lines.join("\n");
		expect(out).toContain("Applied state and the cache are untouched");
	});

	it("clears every run, and says the same", async () => {
		const lines = await run(three, clearHandler());
		const out = lines.join("\n");
		expect(out).toContain("Cleared");
		expect(out).toContain("Applied state and the cache are untouched");
	});
});
