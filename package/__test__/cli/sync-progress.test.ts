import { assert, describe, it } from "@effect/vitest";
import { CliEnv, CliLogger, Render } from "@effected/cli";
import { CliUiTest } from "@effected/cli/ui/testing";
import { Console, Effect, Layer, PubSub } from "effect";
import { syncProgressView } from "../../src/cli/views/sync-progress.js";
import type { SyncProgressState } from "../../src/cli/views/sync-progress-model.js";
import { initialSyncProgress, reduceSyncProgress, syncSummaryBlock } from "../../src/cli/views/sync-progress-model.js";
import type { SyncEvent, SyncLoggerShape } from "../../src/services/SyncLogger.js";
import { SyncLogger, SyncLoggerLive } from "../../src/services/SyncLogger.js";
import { capturingConsole } from "../utils/capture.js";

const fold = (events: ReadonlyArray<SyncEvent>): SyncProgressState =>
	events.reduce(reduceSyncProgress, initialSyncProgress);

const agentPlain = (state: Omit<SyncProgressState, "current" | "finished">): string =>
	Render.plain([syncSummaryBlock(state)], Render.contextOf({ audience: "agent" }));

describe("reduceSyncProgress", () => {
	it("counts a repository done when the next one starts, and not the one in flight when a run aborts", () => {
		const running = fold([
			{ _tag: "RunStarted", total: 3, dryRun: false },
			{ _tag: "RepoStarted", slug: "acme/one" },
			{ _tag: "RepoStarted", slug: "acme/two" },
		]);
		assert.strictEqual(running.repos, 1);
		assert.strictEqual(running.current, "acme/two");

		// No totals: the run failed or was interrupted mid-way.
		const ended = reduceSyncProgress(running, { _tag: "RunEnded" });
		assert.strictEqual(ended.repos, 1);
		assert.strictEqual(ended.current, undefined);
		assert.isTrue(ended.finished);
	});

	it("counts operations by what they cover, and never a skip", () => {
		const state = fold([
			{ _tag: "RunStarted", total: 1, dryRun: true },
			{ _tag: "Operation", verb: "sync", resource: "secret", count: 1 },
			{ _tag: "Operation", verb: "delete", resource: "variable", count: 3 },
			{ _tag: "Operation", verb: "skip", resource: "ruleset", count: 1 },
			{ _tag: "Drift", resource: "secret", name: "A", needsApply: true },
			{ _tag: "Error", repo: "acme/one", context: "x", message: "y" },
		]);
		assert.strictEqual(state.changes, 4);
		assert.strictEqual(state.drifted, 1);
		assert.strictEqual(state.errors, 1);
		assert.isTrue(state.dryRun);
	});

	it("takes the engine's totals from RunEnded over its own approximation", () => {
		const state = fold([
			{ _tag: "RunStarted", total: 2, dryRun: false },
			{ _tag: "RepoStarted", slug: "acme/one" },
			{ _tag: "Operation", verb: "apply", resource: "settings", count: 1 },
			{ _tag: "RunEnded", repos: 2, changes: 7, drifted: 0, errors: 0 },
		]);
		assert.deepInclude(state, { repos: 2, changes: 7, drifted: 0, errors: 0, finished: true });
	});

	it("starts a fresh run from scratch, since the kit never resets state", () => {
		const state = fold([
			{ _tag: "RunStarted", total: 2, dryRun: false },
			{ _tag: "Error", repo: "", context: "x", message: "y" },
			{ _tag: "RunStarted", total: 5, dryRun: true },
		]);
		assert.deepInclude(state, { total: 5, errors: 0, dryRun: true });
	});
});

describe("syncSummaryBlock", () => {
	it("reads as one line for an agent, every counter shown at zero", () => {
		assert.strictEqual(
			agentPlain({ dryRun: true, total: 2, repos: 2, changes: 0, drifted: 0, errors: 0 }),
			"Dry run: 2/2 repos, 0 changes, 0 drifted, 0 errors",
		);
	});

	it("agrees each noun with its number", () => {
		assert.strictEqual(
			agentPlain({ dryRun: false, total: 1, repos: 1, changes: 1, drifted: 1, errors: 1 }),
			"Sync: 1/1 repo, 1 change, 1 drifted, 1 error",
		);
	});
});

describe("the live view", () => {
	it.effect("draws a spinner, the current repository and the counts so far", () =>
		Effect.gen(function* () {
			const view = yield* CliUiTest.live({ ...syncProgressView, columns: 100 });
			yield* view.publish({ _tag: "RunStarted", total: 2, dryRun: false });
			yield* view.publish({ _tag: "RepoStarted", slug: "acme/one" });
			yield* view.publish({ _tag: "Operation", verb: "sync", resource: "secret", count: 1 });
			const frame = yield* view.plainFrame;
			assert.include(frame, "syncing acme/one");
			assert.include(frame, "Sync: 0/2 repos, 1 change, 0 drifted, 0 errors");
		}).pipe(Effect.scoped),
	);

	it.effect("labels a dry run as checking, not syncing", () =>
		Effect.gen(function* () {
			const view = yield* CliUiTest.live({ ...syncProgressView, columns: 100 });
			yield* view.publish({ _tag: "RunStarted", total: 1, dryRun: true });
			yield* view.publish({ _tag: "RepoStarted", slug: "acme/one" });
			const frame = yield* view.plainFrame;
			assert.include(frame, "checking acme/one");
			// The noun agrees with the total it is read against: `0/1 repo`.
			assert.include(frame, "Dry run: 0/1 repo,");
		}).pipe(Effect.scoped),
	);

	it.effect("writes logged lines above the frame and commits the summary as the last thing on screen", () =>
		Effect.gen(function* () {
			const view = yield* CliUiTest.live({ ...syncProgressView, columns: 100 });
			yield* view.publish({ _tag: "RunStarted", total: 2, dryRun: false });
			yield* view.publish({ _tag: "RepoStarted", slug: "acme/one" });
			yield* Console.log("  repo: acme/one").pipe(Effect.provideService(Console.Console, view.handle.logConsole));
			yield* view.publish({ _tag: "RunEnded", repos: 2, changes: 3, drifted: 1, errors: 0 });
			yield* view.handle.close;

			const lines = (yield* view.transcript).split("\n");
			const logged = lines.indexOf("  repo: acme/one");
			const summary = lines.findIndex((line) => line.includes("Sync: 2/2 repos, 3 changes, 1 drifted, 0 errors"));
			assert.isAtLeast(logged, 0);
			assert.isAbove(summary, logged);
			assert.strictEqual(summary, lines.length - 1);
			// The spinner line is gone from the committed frame: it is the summary alone.
			assert.notInclude(lines.join("\n"), "syncing acme/one\nSync");
		}).pipe(Effect.scoped),
	);

	it.effect("draws nothing at all when it is not interactive, being hosted", () =>
		Effect.gen(function* () {
			const view = yield* CliUiTest.live({ ...syncProgressView, interactive: false });
			yield* view.publish({ _tag: "RunStarted", total: 1, dryRun: false });
			yield* view.publish({ _tag: "RunEnded", repos: 1, changes: 0, drifted: 0, errors: 0 });
			yield* view.handle.close;
			assert.strictEqual(yield* view.written, "");
		}).pipe(Effect.scoped),
	);
});

describe("SyncLogger events", () => {
	/** Run logger calls with an event sink, returning every event and line. */
	const withEvents = (dryRun: boolean, use: (logger: SyncLoggerShape) => Effect.Effect<void>) =>
		Effect.gen(function* () {
			const { console: double, lines } = capturingConsole();
			const pubsub = yield* PubSub.unbounded<SyncEvent>();
			const subscription = yield* PubSub.subscribe(pubsub);
			yield* Effect.gen(function* () {
				yield* use(yield* SyncLogger);
			}).pipe(
				Effect.provide(SyncLoggerLive({ dryRun, debug: false, events: pubsub })),
				Effect.provide(CliEnv.layerTest({ audience: "agent" })),
				Effect.provide(CliLogger.layer()),
				Effect.provideService(Console.Console, double),
			);
			const events = yield* PubSub.takeAll(subscription);
			return { events: [...events], lines };
		}).pipe(Effect.scoped);

	it.effect("publishes an event for every hook, after the line it prints", () =>
		Effect.gen(function* () {
			const { events, lines } = yield* withEvents(false, (l) =>
				Effect.gen(function* () {
					yield* l.runStart(4);
					yield* l.groupStart("g", 1, 2);
					yield* l.repoStart("acme", "one");
					yield* l.settingsApplied(["has_issues"]);
					yield* l.syncOperation("sync", "secret", "A");
					yield* l.cleanupSummary("variable", 2, ["X", "Y"]);
					yield* l.driftDetected("secret", "A", {
						_tag: "Drift",
						applied: "a",
						live: "b",
						needsApply: true,
					});
					yield* l.syncError("secret A", "403");
					yield* l.finish({ repos: 1, changes: 3, drifted: 1, errors: 1 });
				}),
			);
			assert.deepStrictEqual(
				events.map((e) => e._tag),
				[
					"RunStarted",
					"GroupStarted",
					"RepoStarted",
					"Operation",
					"Operation",
					"Operation",
					"Drift",
					"Error",
					"RunEnded",
				],
			);
			assert.deepStrictEqual(events[0], { _tag: "RunStarted", total: 4, dryRun: false });
			assert.deepStrictEqual(events[5], { _tag: "Operation", verb: "delete", resource: "variable", count: 2 });
			assert.deepStrictEqual(events[7], { _tag: "Error", repo: "acme/one", context: "secret A", message: "403" });
			assert.deepStrictEqual(events[8], { _tag: "RunEnded", repos: 1, changes: 3, drifted: 1, errors: 1 });
			// runStart prints nothing; every other hook still prints.
			assert.isAbove(lines.length, 7);
		}),
	);

	it.effect("publishes nothing, and still prints, with no sink", () =>
		Effect.gen(function* () {
			const { console: double, lines } = capturingConsole();
			yield* Effect.gen(function* () {
				const l = yield* SyncLogger;
				yield* l.runStart(1);
				yield* l.repoStart("acme", "one");
			}).pipe(
				Effect.provide(SyncLoggerLive({ dryRun: false, debug: false })),
				Effect.provide(CliEnv.layerTest({ audience: "agent" })),
				Effect.provideService(Console.Console, double),
			);
			assert.deepStrictEqual(
				lines.map((l) => l.text),
				["  repo: acme/one"],
			);
		}),
	);
});

/** An SGR colour sequence, built from its code so the pattern holds no control character. */
const SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

describe("SyncLogger theming", () => {
	const linesFor = (audience: "agent" | "human", dryRun: boolean) =>
		Effect.gen(function* () {
			const { console: double, lines } = capturingConsole();
			yield* Effect.gen(function* () {
				const l = yield* SyncLogger;
				yield* l.syncOperation("sync", "secret", "A");
				yield* l.syncOperation("delete", "secret", "B");
				yield* l.driftDetected("secret", "A", { _tag: "Drift", applied: "a", live: "b", needsApply: true });
				yield* l.syncError("secret A", "403");
			}).pipe(
				Effect.provide(SyncLoggerLive({ dryRun, debug: false })),
				Effect.provide(
					Layer.mergeAll(CliEnv.layerTest({ audience, tty: true, color: "truecolor" }), CliLogger.layer()),
				),
				Effect.provideService(Console.Console, double),
			);
			return lines.map((l) => l.text);
		});

	it.effect("gives an agent the glyph and plain text, even on a colour terminal", () =>
		Effect.gen(function* () {
			const lines = yield* linesFor("agent", false);
			assert.deepStrictEqual(lines, [
				"    ✓ sync    secret A",
				"    ⚠ delete  secret B",
				"    ⚠ drift   secret A changed outside reposets — overwritten",
				"    ✗ error   secret A: 403",
			]);
		}),
	);

	it.effect("marks a dry run's would-lines as information", () =>
		Effect.gen(function* () {
			const lines = yield* linesFor("agent", true);
			assert.strictEqual(lines[0], "    ℹ would sync    secret A");
			assert.strictEqual(lines[1], "    ⚠ would delete  secret B");
		}),
	);

	it.effect("paints the glyph, and only the glyph, for a person — except on a logged failure", () =>
		Effect.gen(function* () {
			const lines = yield* linesFor("human", false);
			for (const line of lines.slice(0, 3)) assert.include(line, "\u001b[");
			// The logger sanitises what a program logs, so a painted failure glyph
			// could never survive it; the line is the agent's line exactly.
			assert.notInclude(lines[3], "\u001b[");
			// The text after the glyph stays plain: strip escapes and it is the agent's line.
			const plain = lines.map((line) => line.replace(SGR, ""));
			assert.deepStrictEqual(plain, yield* linesFor("agent", false));
			assert.isTrue(lines[0]?.endsWith("sync    secret A"));
		}),
	);

	it.effect("sanitises an escape smuggled in through a value", () =>
		Effect.gen(function* () {
			const { console: double, lines } = capturingConsole();
			yield* Effect.gen(function* () {
				const l = yield* SyncLogger;
				yield* l.syncOperation("sync", "secret", "EVIL\u001b[2J");
			}).pipe(
				Effect.provide(SyncLoggerLive({ dryRun: false, debug: false })),
				Effect.provide(CliEnv.layerTest({ audience: "agent" })),
				Effect.provideService(Console.Console, double),
			);
			assert.strictEqual(lines[0]?.text, "    ✓ sync    secret EVIL");
		}),
	);
});
