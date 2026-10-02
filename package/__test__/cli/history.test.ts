import { NodeServices } from "@effect/platform-node";
import { App } from "@effected/app";
import type { CliEnvTestOptions } from "@effected/cli";
import { CliLogger } from "@effected/cli";
import { Console, Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { clearHandler, historyHandler, pruneHandler, showHandler } from "../../src/cli/commands/history.js";
import { migrations } from "../../src/store/migrations.js";
import { SyncJournal, SyncJournalLive } from "../../src/store/SyncJournal.js";
import type { Outcome, PresentationServices } from "../utils/capture.js";
import { capturingConsole, on, presentation, runOutcome } from "../utils/capture.js";

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
	// `historyHandler` carries SqlError; the subcommand handlers do not. Every
	// handler prints through `Doc.print` / `CliMessage`, so it also reads the
	// presentation services `runOutcome` provides (an agent audience: plain).
	handler: Effect.Effect<void, unknown, SyncJournal | PresentationServices>,
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
		) as Effect.Effect<void, unknown, PresentationServices>,
	);
};

/** {@link runFull}, keeping only each line's text. */
const run = async (
	seed: (journal: SyncJournal["Service"]) => Effect.Effect<void, unknown, SyncJournal>,
	handler: Effect.Effect<void, unknown, SyncJournal | PresentationServices>,
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
		// A row: the eight-character id, the UTC minute, then the outcome with
		// its status glyph — plain text for the agent audience.
		expect(out).toMatch(/^[0-9a-f]{8}\s+\d{4}-\d{2}-\d{2} \d{2}:\d{2}\s+✓ success\s+applied\s+\(all\)\s+0\s/m);
		expect(out).not.toContain("\u001b[");
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

	it("puts a failed run's error before its changes", async () => {
		// On a failed run the error is the answer someone came for.
		const out = (
			await run(
				(j) =>
					Effect.gen(function* () {
						const id = yield* j.startRun({ dryRun: false });
						yield* j.finishRun(id, "failed", "403 Forbidden on secrets");
					}),
				showHandler(""),
			)
		).join("\n");
		expect(out).toContain("error: 403 Forbidden on secrets");
		expect(out).toContain("No resources changed.");
		expect(out.indexOf("error: 403")).toBeLessThan(out.indexOf("No resources changed."));
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

	it("without --run and nobody to ask, refuses as a usage error naming the flag", async () => {
		// The agent audience is not interactive: nothing may prompt, so a missing
		// `--run` is what it was before the picker — exit 64 — and the message
		// says which flag to pass.
		const outcome = await runFull(
			(j) =>
				Effect.gen(function* () {
					const a = yield* j.startRun({ dryRun: false });
					yield* j.finishRun(a, "success");
				}),
			showHandler(undefined),
		);
		expect(outcome.exitCode).toBe(64);
		expect(on(outcome.lines, "stderr").join("\n")).toContain("--run");
		expect(on(outcome.lines, "stdout")).toEqual([]);
	});

	it("without --run and nobody to ask, refuses even on an empty journal", async () => {
		// The same invocation must exit the same way whatever the journal holds:
		// a script that omits --run is wrong whether or not a run is recorded.
		const outcome = await runFull(noSeed, showHandler(undefined));
		expect(outcome.exitCode).toBe(64);
		expect(on(outcome.lines, "stderr").join("\n")).toContain("--run");
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
		expect(on(outcome.lines, "stdout").join("\n")).toContain("No resources changed (nothing to do).");
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
		expect(out).toContain("✓ Pruned 2 runs, keeping the newest 1.");
		expect(out).toContain("Applied state and the cache are untouched");
	});

	it("says there was nothing to prune, and still that the baselines survived", async () => {
		const outcome = await runFull(three, pruneHandler(5));
		expect(on(outcome.lines, "stdout")).toEqual([
			"ℹ Nothing to prune; 5 or fewer runs are recorded.",
			"ℹ Applied state and the cache are untouched — drift detection still works.",
		]);
	});

	it("clears every run, and says the same", async () => {
		const lines = await run(three, clearHandler());
		const out = lines.join("\n");
		expect(out).toContain("Cleared");
		expect(out).toContain("Applied state and the cache are untouched");
	});
});

describe("history output by audience", () => {
	// A person at a colour terminal gets the same report as an agent, painted:
	// the layout, the words and the glyphs are one document either way. Wide
	// enough columns that the human render does not wrap.
	const human: CliEnvTestOptions = { audience: "human", tty: true, color: "truecolor", columns: 400 };
	// biome-ignore lint/suspicious/noControlCharactersInRegex: matching SGR escapes is the point.
	const stripSgr = (value: string): string => value.replace(/\u001b\[[0-9;]*m/g, "");

	const seed = (j: SyncJournal["Service"]) =>
		Effect.gen(function* () {
			const id = yield* j.startRun({ dryRun: false, group: "g" });
			yield* j.recordChange(id, { repo: "acme/widget", kind: "secret", name: "API_KEY", action: "created" });
			yield* j.finishRun(id, "partial", "403 Forbidden on secrets");
		});

	/** Seed once, then render the same journal for each audience, capturing what each wrote. */
	const both = (handler: Effect.Effect<void, unknown, SyncJournal | PresentationServices>) =>
		Effect.gen(function* () {
			yield* seed(yield* SyncJournal).pipe(Effect.orDie);
			const render = (env: CliEnvTestOptions) => {
				const { console: double, lines } = capturingConsole();
				return handler.pipe(
					Effect.provide(presentation(env)),
					Effect.provide(CliLogger.layer()),
					Effect.provideService(Console.Console, double),
					Effect.as(lines),
				);
			};
			return { agent: yield* render({ audience: "agent" }), person: yield* render(human) };
		}).pipe(
			Effect.provide(Layer.provideMerge(SyncJournalLive, Layer.provideMerge(AppTest, NodeServices.layer))),
			Effect.runPromise,
		);

	for (const [name, handler] of [
		["the run table", historyHandler({ limit: 20, repo: undefined })],
		["a run report", showHandler("")],
		["a prune message", pruneHandler(5)],
	] as const) {
		it(`${name} differs for a person only by colour escapes`, async () => {
			const { agent, person } = await both(handler);
			const painted = person.map((line) => line.text).join("\n");

			// The control: the human run really was painted, so the equality
			// below is not two identical plain renders.
			expect(painted).toContain("\u001b[");
			expect(stripSgr(painted)).toBe(agent.map((line) => line.text).join("\n"));
			expect(person.map((line) => line.stream)).toEqual(agent.map((line) => line.stream));
		});
	}
});
