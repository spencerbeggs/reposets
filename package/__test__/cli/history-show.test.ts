import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { App } from "@effected/app";
import { CliLogger } from "@effected/cli";
import type { CliUiTestSession } from "@effected/cli/ui/testing";
import { CliUiTest } from "@effected/cli/ui/testing";
import { Effect, Exit, Fiber, Layer, Option } from "effect";
import { CliError } from "effect/cli";
import { showHandler } from "../../src/cli/commands/history.js";
import { migrations } from "../../src/store/migrations.js";
import type { RunSummary } from "../../src/store/SyncJournal.js";
import { SyncJournal, SyncJournalLive } from "../../src/store/SyncJournal.js";
import { presentation } from "../utils/capture.js";

/**
 * `history show` without `--run`: the picker a person gets, and the refusal
 * everyone else gets.
 *
 * @remarks
 * Driven against a real in-memory journal (as `history.test.ts` is) and a
 * `CliUiTest.session`, whose layer is provided **inside** a human presentation
 * layer: the session's `CliInteractive` and in-memory terminal win, while the
 * presentation layer still supplies `Audience`, `TerminalEnv` and `CliLinks`
 * for the report `Doc.print` writes once a run is chosen.
 */

const AppTest = App.layerTest({ namespace: "reposets-history-show-test", store: { migrations } });
const Journal = Layer.provideMerge(SyncJournalLive, Layer.provideMerge(AppTest, NodeServices.layer));

/** Two finished runs, each touching its own repository, so the report says which one was picked. */
const seedTwo = Effect.gen(function* () {
	const journal = yield* SyncJournal;
	for (const repo of ["acme/first", "acme/second"]) {
		const id = yield* journal.startRun({ dryRun: false, group: "g" });
		yield* journal.recordChange(id, { repo, kind: "secret", name: "TOKEN", action: "updated" });
		yield* journal.finishRun(id, "success");
	}
	// The order the picker lists them in — the journal's newest-first — read
	// back rather than assumed, since two runs can share a millisecond.
	return yield* journal.history({ limit: 1000 });
}).pipe(Effect.orDie);

/** Seed (unless `empty`), then run `show` with no `--run` on the session's terminal. */
const program = (
	session: CliUiTestSession,
	seeded: (runs: ReadonlyArray<RunSummary>) => void,
	options: { readonly empty?: boolean } = {},
) =>
	Effect.gen(function* () {
		if (options.empty !== true) seeded(yield* seedTwo);
		yield* showHandler(undefined);
	}).pipe(
		Effect.provide(Journal),
		Effect.provide(CliLogger.layer()),
		Effect.provide(session.layer),
		Effect.provide(presentation({ audience: "human" })),
	);

describe("history show without --run", () => {
	it.effect("lets a person pick a recent run, and shows that one", () =>
		Effect.gen(function* () {
			let runs: ReadonlyArray<RunSummary> = [];
			const session = yield* CliUiTest.session();
			const fiber = yield* Effect.forkScoped(
				program(session, (seeded) => {
					runs = seeded;
				}),
			);

			const picker = yield* session.next({ contains: "Which run?" });
			const frame = yield* picker.plainFrame;
			// Each choice names the run the way the table does.
			const second = runs[1] as RunSummary;
			assert.include(frame, `${second.id.slice(0, 8)} · `);
			assert.include(frame, "· success · g");
			assert.include(frame, "applied · 1 change · ");

			yield* picker.press("down", "enter");
			yield* Fiber.join(fiber);

			const stdout = yield* session.stdout;
			assert.include(stdout, `run ${second.id}`);
			assert.notInclude(stdout, `run ${(runs[0] as RunSummary).id}`);
			assert.strictEqual(yield* session.mounts, 1);
		}).pipe(Effect.scoped),
	);

	it.effect("Esc cancels with the kit's Cancelled rather than succeeding", () =>
		Effect.gen(function* () {
			const session = yield* CliUiTest.session();
			const fiber = yield* Effect.forkScoped(program(session, () => {}));
			yield* (yield* session.next({ contains: "Which run?" })).press("escape");
			const exit = yield* Fiber.await(fiber);

			// `CliRuntime.main` renders this as one line and exits 130.
			assert.deepStrictEqual(CliUiTest.cancelReason(exit), Option.some("escape"));
			assert.notInclude(yield* session.stdout, "run ");
		}).pipe(Effect.scoped),
	);

	it.effect("a person with an empty journal is told so, nothing mounts, and it succeeds", () =>
		Effect.gen(function* () {
			const session = yield* CliUiTest.session();
			const exit = yield* Effect.exit(program(session, () => {}, { empty: true }));

			assert.isTrue(Exit.isSuccess(exit));
			assert.include(yield* session.stdout, "No runs recorded yet");
			assert.strictEqual(yield* session.mounts, 0);
		}).pipe(Effect.scoped),
	);

	it.effect("not interactive, an empty journal is still the usage error — the exit code never depends on it", () =>
		Effect.gen(function* () {
			const session = yield* CliUiTest.session({ interactive: false });
			const exit = yield* Effect.exit(program(session, () => {}, { empty: true }));

			const error = Exit.isFailure(exit) ? Option.getOrUndefined(Exit.findErrorOption(exit)) : undefined;
			assert.isTrue(CliError.isCliError(error) && error._tag === "UserError");
			assert.include(String((error as CliError.UserError).message), "--run");
			assert.notInclude(yield* session.stdout, "No runs recorded yet");
		}).pipe(Effect.scoped),
	);

	it.effect("not interactive, it refuses with a usage error naming --run and mounts nothing", () =>
		Effect.gen(function* () {
			const session = yield* CliUiTest.session({ interactive: false });
			const exit = yield* Effect.exit(program(session, () => {}));

			assert.isTrue(Exit.isFailure(exit));
			const error = Exit.isFailure(exit) ? Option.getOrUndefined(Exit.findErrorOption(exit)) : undefined;
			assert.isTrue(CliError.isCliError(error) && error._tag === "UserError");
			assert.include(String((error as CliError.UserError).message), "--run");
			assert.strictEqual(yield* session.mounts, 0);
		}).pipe(Effect.scoped),
	);
});
