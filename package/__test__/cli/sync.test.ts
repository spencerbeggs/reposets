import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { App } from "@effected/app";
import type { CliTheme } from "@effected/cli";
import { CliExit, CliLogger } from "@effected/cli";
import { CliUiTest } from "@effected/cli/ui/testing";
import { Cause, ConfigProvider, Console, Effect, Exit, Layer, MutableRef, PubSub } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runUnderSyncView, selectedRepoCount, syncHandler } from "../../src/cli/commands/sync.js";
import { syncProgressView } from "../../src/cli/views/sync-progress-view.js";
import { CredentialsFilesLive, makeConfigFilesLive } from "../../src/services/ConfigFiles.js";
import { Invocation } from "../../src/services/Invocation.js";
import { migrations } from "../../src/store/migrations.js";
import { on, presentation, runOutcome } from "../utils/capture.js";

/**
 * `sync` end to end through its handler, on the one failure that needs no
 * GitHub at all: every selected group names a credential profile the
 * credentials file does not have. The run still starts, reports the error,
 * finishes and summarises — which is every path a summary can take.
 */

let dir: string;
let home: string;

beforeEach(() => {
	dir = join(tmpdir(), `reposets-sync-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	home = join(dir, "home");
	mkdirSync(home, { recursive: true });
	writeFileSync(
		join(dir, "reposets.config.toml"),
		`[settings.defaults]
has_issues = true

[groups.mine]
repos = ["one", "two"]
credentials = "missing"
settings = ["defaults"]
`,
	);
	writeFileSync(
		join(dir, "reposets.credentials.toml"),
		`[profiles.default]\nusername = "acme"\ngithub_token = { env = "GH" }\n`,
	);
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

const services = (): Layer.Layer<never, unknown, never> =>
	Layer.mergeAll(
		makeConfigFilesLive(join(dir, "reposets.config.toml")),
		CredentialsFilesLive,
		Invocation.layer({ cwd: dir, version: "0.0.0-test" }),
	).pipe(
		Layer.provideMerge(App.layer({ namespace: "reposets-sync-test", store: { migrations } })),
		Layer.provideMerge(NodeServices.layer),
		Layer.provideMerge(
			ConfigProvider.layer(
				ConfigProvider.fromEnv({
					env: {
						HOME: home,
						XDG_CONFIG_HOME: join(home, ".config"),
						XDG_STATE_HOME: join(home, ".local/state"),
						XDG_CACHE_HOME: join(home, ".cache"),
					},
				}),
			),
		),
	) as unknown as Layer.Layer<never, unknown, never>;

const sync = (dryRun: boolean) =>
	syncHandler({
		dryRun,
		noCleanup: true,
		failOnDrift: false,
		group: undefined,
		repo: undefined,
		only: [],
		skip: [],
		debug: false,
	}).pipe(Effect.provide(services())) as Effect.Effect<void, unknown, never>;

describe("selectedRepoCount", () => {
	const groups = { a: { repos: ["x", "y"] }, b: { repos: ["y", "z", "w"] } };

	it("counts every repository of every selected group", () => {
		expect(selectedRepoCount(groups, new Map([["p", ["a", "b"]]]), undefined)).toBe(5);
	});

	it("narrows by --repo in every group, as the engine does", () => {
		expect(selectedRepoCount(groups, new Map([["p", ["a", "b"]]]), "y")).toBe(2);
	});

	it("counts only the groups the partitions selected", () => {
		expect(selectedRepoCount(groups, new Map([["p", ["b"]]]), undefined)).toBe(3);
	});
});

describe("sync, not interactive", () => {
	it("prints the summary once, statically, on stdout, and exits 1 for the error", async () => {
		const outcome = await runOutcome(sync(true) as never);

		expect(outcome.exitCode).toBe(1);
		const stdout = on(outcome.lines, "stdout");
		// The selected repositories are the denominator even though none ran.
		expect(stdout.at(-1)).toBe("Dry run: 0/2 repos, 0 changes, 0 drifted, 1 error");
		expect(stdout.filter((line) => line.includes("repos,"))).toHaveLength(1);
		const stderr = on(outcome.lines, "stderr").join("\n");
		expect(stderr).toContain("✗ error   profile missing: credential profile 'missing' does not exist");
		expect(stderr).toContain("✗ Sync complete with 1 error:");
	});

	it("labels a real run Sync, not Dry run", async () => {
		const outcome = await runOutcome(sync(false) as never);
		expect(on(outcome.lines, "stdout").at(-1)).toBe("Sync: 0/2 repos, 0 changes, 0 drifted, 1 error");
	});

	it("writes no escape for an agent", async () => {
		const outcome = await runOutcome(sync(true) as never);
		for (const line of outcome.lines) expect(line.text).not.toContain("\u001b");
	});
});

describe("sync, interactive", () => {
	/**
	 * The handler's own live view on the kit's in-memory terminal.
	 *
	 * @remarks
	 * `transcript` is what stays on the terminal once Ink's erases are applied:
	 * the lines the view's `logConsole` wrote above its frame (stdout and stderr
	 * are one stream there, as on a real terminal, so a `logError` lands in
	 * order with the report), and each run's committed frame. The session's
	 * layer goes inside the human presentation layer so its interactive,
	 * in-memory terminal wins.
	 */
	const onTerminal = <A, E>(program: Effect.Effect<A, E, CliTheme>, outer: Layer.Layer<never> = Layer.empty) =>
		Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const session = yield* CliUiTest.session({ columns: 120, rows: 30 });
					const result = yield* program.pipe(Effect.provide(session.layer), Effect.provide(outer));
					return {
						result,
						transcript: yield* session.transcript,
						stdoutTranscript: yield* session.stdoutTranscript,
						stderrTranscript: yield* session.stderrTranscript,
					};
				}),
			),
		);

	/** Run the handler as a person at a terminal would. */
	const interactively = (handler: Effect.Effect<void, unknown, never>) =>
		onTerminal(
			Effect.gen(function* () {
				const cell = yield* CliExit;
				const exit = yield* Effect.exit(handler);
				return { exit, code: MutableRef.get(cell.code) };
			}).pipe(Effect.provide(CliExit.layer), Effect.provide(CliLogger.layer())) as Effect.Effect<
				{ exit: Exit.Exit<void, unknown>; code: number },
				never,
				never
			>,
			presentation({ audience: "human", tty: true }) as unknown as Layer.Layer<never>,
		);

	it("writes every report line above the frame, and commits the summary last", async () => {
		const { result, transcript, stdoutTranscript, stderrTranscript } = await interactively(sync(true));

		expect(Exit.isSuccess(result.exit)).toBe(true);
		expect(result.code).toBe(1);
		const summary = transcript.lastIndexOf("Dry run: 0/2 repos, 0 changes, 0 drifted, 1 error");
		const errorLine = transcript.indexOf("✗ error   profile missing: credential profile 'missing' does not exist");
		const closing = transcript.indexOf("✗ Sync complete with 1 error:");
		// Lost entirely, or written anywhere but through the view, these are -1.
		expect(errorLine).toBeGreaterThanOrEqual(0);
		expect(closing).toBeGreaterThan(errorLine);
		expect(summary).toBeGreaterThan(closing);
		// The committed frame is the summary alone: nothing follows it.
		expect(transcript.slice(summary).trim()).toBe("Dry run: 0/2 repos, 0 changes, 0 drifted, 1 error");
		// Above the frame the streams stay apart: failures on stderr, the
		// summary frame on stdout.
		for (const failure of ["error   profile missing", "Sync complete with 1 error:"]) {
			expect(stderrTranscript).toContain(failure);
			expect(stdoutTranscript).not.toContain(failure);
		}
		expect(stdoutTranscript).toContain("Dry run: 0/2 repos, 0 changes, 0 drifted, 1 error");
		expect(stderrTranscript).not.toContain("0/2 repos");
	});

	it("still ends the view, with a summary frame, when the run dies mid-way — and the failure propagates", async () => {
		const { result: exit, transcript } = await onTerminal(
			Effect.exit(
				runUnderSyncView(syncProgressView, (events) =>
					Effect.gen(function* () {
						yield* PubSub.publish(events, { _tag: "RunStarted", total: 3, dryRun: false });
						yield* PubSub.publish(events, { _tag: "RepoStarted", slug: "acme/one" });
						yield* PubSub.publish(events, { _tag: "Operation", verb: "sync", resource: "secret", count: 1 });
						yield* Console.log("  repo: acme/one");
						return yield* Effect.die("boom");
					}),
				),
			),
		);

		expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBe("boom");
		const logged = transcript.indexOf("  repo: acme/one");
		const summary = transcript.lastIndexOf("Sync: 0/3 repos, 1 change, 0 drifted, 0 errors");
		expect(logged).toBeGreaterThanOrEqual(0);
		expect(summary).toBeGreaterThan(logged);
		// No spinner frame is left as the last thing on the terminal: the run
		// was ended, and its final frame is the summary of what got done.
		expect(transcript.slice(summary).trim()).toBe("Sync: 0/3 repos, 1 change, 0 drifted, 0 errors");
		// A frame is the spinner line over the counts, so a frozen spinner frame
		// ends in the same summary text; what tells them apart is the line just
		// above it.
		expect(transcript.slice(0, summary).trimEnd().split("\n").at(-1)).not.toContain("syncing acme/one");
	});

	it("propagates a typed failure unchanged after ending the view", async () => {
		const { result: exit, transcript } = await onTerminal(
			Effect.exit(
				runUnderSyncView(syncProgressView, (events) =>
					PubSub.publish(events, { _tag: "RunStarted", total: 1, dryRun: true }).pipe(
						Effect.andThen(Effect.fail("config went away" as const)),
					),
				),
			),
		);

		expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBe("config went away");
		expect(transcript.trim().split("\n").at(-1)).toBe("Dry run: 0/1 repo, 0 changes, 0 drifted, 0 errors");
	});
});
