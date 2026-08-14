import { Effect, Logger } from "effect";
import { describe, expect, it } from "vitest";
import type { SyncLoggerShape } from "../../src/services/SyncLogger.js";
import { SyncLogger, SyncLoggerLive } from "../../src/services/SyncLogger.js";

/**
 * Capture what a run actually prints.
 *
 * @remarks
 * v3 tested this by handing the logger a `Ref<string[]>` to write into instead
 * of stdout. That seam is gone: the service now emits with `Effect.log`, and a
 * test that bypassed it would assert the formatting while proving nothing about
 * the path the CLI uses.
 *
 * So this installs a real `Logger` and reads what Effect hands it. Same
 * assertions as v3, one layer lower. `Logger.layer` replaces the default logger
 * rather than merging, so nothing reaches the console during a test run.
 *
 * The trap worth naming: a capture wired to the wrong sink returns `[]` forever,
 * and almost every assertion here is a `toContain` or a `toHaveLength(0)` that
 * an empty array satisfies or that never fails loudly. `it("captures anything at
 * all")` below is the canary — if the wiring breaks, that test fails first and
 * unambiguously.
 */
const capture = async (
	config: { dryRun: boolean; debug: boolean },
	program: Effect.Effect<void, never, SyncLogger>,
): Promise<ReadonlyArray<string>> => {
	const lines: string[] = [];
	const collector = Logger.make<unknown, void>((options) => {
		lines.push(Array.isArray(options.message) ? options.message.join(" ") : String(options.message));
	});

	await Effect.runPromise(
		program.pipe(Effect.provide(SyncLoggerLive(config)), Effect.provide(Logger.layer([collector]))),
	);

	return lines;
};

/**
 * Capture lines with the level each was emitted at.
 *
 * @remarks
 * The plain {@link capture} discards `logLevel`, so it cannot see which stream a
 * line lands on — the CLI entrypoint routes by level, sending `Error` to stderr
 * and everything else to stdout. Changing `Effect.log` to `Effect.logError`
 * leaves every message-only assertion green while changing what a user piping
 * stdout actually sees, so the routing needs its own assertions.
 */
const captureLevels = async (
	config: { dryRun: boolean; debug: boolean },
	program: Effect.Effect<void, never, SyncLogger>,
): Promise<ReadonlyArray<{ readonly level: string; readonly line: string }>> => {
	const entries: Array<{ level: string; line: string }> = [];
	const collector = Logger.make<unknown, void>((options) => {
		entries.push({
			level: String(options.logLevel),
			line: Array.isArray(options.message) ? options.message.join(" ") : String(options.message),
		});
	});

	await Effect.runPromise(
		program.pipe(Effect.provide(SyncLoggerLive(config)), Effect.provide(Logger.layer([collector]))),
	);

	return entries;
};

/**
 * Run one logger call.
 *
 * @remarks
 * `SyncLogger` is declared without a default `make` — the tier and dry-run flag
 * are per-run — so the tag's success type is `SyncLoggerShape`, not the class.
 * Annotating the callback with the class instead compiles the tests into
 * nonsense that still *runs*, which is worth knowing: vitest transpiles without
 * type checking, so that mistake passed 215 tests before `tsc` caught it.
 */
const withLogger = (use: (logger: SyncLoggerShape) => Effect.Effect<void>): Effect.Effect<void, never, SyncLogger> =>
	Effect.gen(function* () {
		const logger = yield* SyncLogger;
		yield* use(logger);
	});

describe("SyncLogger capture harness", () => {
	it("captures anything at all", async () => {
		const lines = await capture(
			{ dryRun: false, debug: false },
			withLogger((l) => l.groupStart("canary", 1, 1)),
		);
		// If this is empty the harness is broken and every `toHaveLength(0)`
		// assertion below is vacuously true.
		expect(lines.length).toBeGreaterThan(0);
	});
});

describe("output", () => {
	it("logs group header", async () => {
		const lines = await capture(
			{ dryRun: false, debug: false },
			withLogger((l) => l.groupStart("personal", 3, 3)),
		);
		expect(lines).toContain("group: personal (3 repos)");
	});

	it("singularises a one-repo group", async () => {
		const lines = await capture(
			{ dryRun: false, debug: false },
			withLogger((l) => l.groupStart("solo", 1, 1)),
		);
		expect(lines).toContain("group: solo (1 repo)");
	});

	it("logs repo header", async () => {
		const lines = await capture(
			{ dryRun: false, debug: false },
			withLogger((l) => l.repoStart("owner", "repo")),
		);
		expect(lines).toContain("  repo: owner/repo");
	});

	it("logs settings applied", async () => {
		const lines = await capture(
			{ dryRun: false, debug: false },
			withLogger((l) => l.settingsApplied(["has_issues"])),
		);
		expect(lines).toContain("    applied settings (has_issues)");
	});

	it("logs cleanup summary with names", async () => {
		const lines = await capture(
			{ dryRun: false, debug: false },
			withLogger((l) => l.cleanupSummary("secret", 2, ["OLD_TOKEN", "STALE_KEY"])),
		);
		expect(lines).toContain("    deleted 2 secrets (OLD_TOKEN, STALE_KEY)");
	});

	it("prints per-resource operations, which used to need a raised tier", async () => {
		// The defect that retired the tiers: this line is the entire content of a
		// sync, and it was suppressed by default — so a dry run reported a change
		// count with the list of changes missing.
		const lines = await capture(
			{ dryRun: false, debug: false },
			withLogger((l) => l.syncOperation("sync", "secret", "API_KEY", "(actions)")),
		);
		expect(lines).toContain("    sync    secret API_KEY (actions)");
	});
});

describe("per-resource operations", () => {
	it("prints the operation line", async () => {
		const lines = await capture(
			{ dryRun: false, debug: false },
			withLogger((l) => l.syncOperation("sync", "secret", "API_KEY", "(actions)")),
		);
		expect(lines).toContain("    sync    secret API_KEY (actions)");
	});

	it("omits the source annotation unless --debug", async () => {
		const lines = await capture(
			{ dryRun: false, debug: false },
			withLogger((l) => l.syncOperation("sync", "secret", "API_KEY", "(actions)", "op://vault/item/key")),
		);
		expect(lines).toContain("    sync    secret API_KEY (actions)");
		expect(lines).not.toContainEqual(expect.stringContaining("<-"));
	});
});

describe("--debug annotations", () => {
	it("adds the source annotation to the operation line", async () => {
		const lines = await capture(
			{ dryRun: false, debug: true },
			withLogger((l) => l.syncOperation("sync", "secret", "API_KEY", "(actions)", "op://vault/item/key")),
		);
		expect(lines).toContain("    sync    secret API_KEY (actions) <- op://vault/item/key");
	});
});

describe("errors are not suppressible", () => {
	it("prints an error and the closing summary with no tier to hide behind", async () => {
		// `silent` used to suppress these, so a failing run printed nothing at all
		// and the exit code was the only signal. A config file that can silence
		// errors is worse than redirecting stdout, which leaves them on stderr.
		const lines = await capture(
			{ dryRun: false, debug: false },
			withLogger((l) =>
				Effect.gen(function* () {
					yield* l.syncError("secret API_KEY (actions)", "403 Forbidden");
					yield* l.finish();
				}),
			),
		);
		expect(lines).toContainEqual(expect.stringContaining("403 Forbidden"));
		expect(lines.length).toBeGreaterThan(1);
	});
});

describe("dry run", () => {
	it("prepends would to an operation line", async () => {
		const lines = await capture(
			{ dryRun: true, debug: false },
			withLogger((l) => l.syncOperation("sync", "secret", "API_KEY", "(actions)")),
		);
		expect(lines).toContain("    would sync    secret API_KEY (actions)");
	});

	it("prepends would to settings applied", async () => {
		const lines = await capture(
			{ dryRun: true, debug: false },
			withLogger((l) => l.settingsApplied(["has_issues"])),
		);
		expect(lines).toContain("    would apply   settings (has_issues)");
	});

	it("prepends would to cleanup summary", async () => {
		const lines = await capture(
			{ dryRun: true, debug: false },
			withLogger((l) => l.cleanupSummary("variable", 1, ["STALE_VAR"])),
		);
		expect(lines).toContain("    would delete  1 variable (STALE_VAR)");
	});

	it("prepends would to verbose operation lines", async () => {
		const lines = await capture(
			{ dryRun: true, debug: false },
			withLogger((l) => l.syncOperation("sync", "secret", "API_KEY", "(actions)")),
		);
		expect(lines).toContain("    would sync    secret API_KEY (actions)");
	});
});

describe("drift", () => {
	const drift = { _tag: "Drift", applied: "aaa111", live: "bbb222", needsApply: true } as const;
	const harmlessDrift = { _tag: "Drift", applied: "aaa111", live: "bbb222", needsApply: false } as const;

	it("stays distinguishable from the operation beside it", async () => {
		// This used to assert that the operation line was dropped and the drift
		// line survived — the tier contrast WAS the test. With one output level
		// both print, so what has to hold now is that they still read
		// differently: drift names a person's change, the operation names ours.
		const lines = await capture(
			{ dryRun: false, debug: false },
			withLogger((l) =>
				Effect.gen(function* () {
					yield* l.syncOperation("sync", "secret", "API_KEY", "(actions)");
					yield* l.driftDetected("secret", "API_KEY", drift);
				}),
			),
		);
		expect(lines).toHaveLength(2);
		expect(lines[0]).toBe("    sync    secret API_KEY (actions)");
		expect(lines[1]).toBe("    drift   secret API_KEY changed outside reposets — overwritten");
	});

	it("reads differently from an ordinary change", async () => {
		const lines = await capture(
			{ dryRun: false, debug: false },
			withLogger((l) =>
				Effect.gen(function* () {
					yield* l.syncOperation("sync", "secret", "API_KEY", "(actions)");
					yield* l.driftDetected("secret", "API_KEY", drift);
				}),
			),
		);
		// The point is the contrast: one line says what reposets did, the other
		// says what somebody else did. A drift line must never read as our own
		// operation, or the thing a human most needs to notice looks routine.
		const [operation, driftLine] = lines;
		expect(operation).toContain("sync");
		expect(driftLine).toContain("changed outside reposets");
		expect(driftLine).not.toContain("    sync ");
	});

	it("reports drift that needed no write", async () => {
		const lines = await capture(
			{ dryRun: false, debug: false },
			withLogger((l) => l.driftDetected("variable", "NODE_ENV", harmlessDrift)),
		);
		expect(lines).toEqual([
			"    drift   variable NODE_ENV changed outside reposets — already matches config, nothing written",
		]);
	});

	it("says would overwrite on a dry run", async () => {
		const lines = await capture(
			{ dryRun: true, debug: false },
			withLogger((l) => l.driftDetected("secret", "API_KEY", drift)),
		);
		expect(lines).toEqual(["    drift   secret API_KEY changed outside reposets — would overwrite"]);
	});

	it("never takes the dry-run would prefix on the verb itself", async () => {
		const lines = await capture(
			{ dryRun: true, debug: false },
			withLogger((l) => l.driftDetected("secret", "API_KEY", drift)),
		);
		// "would drift" would be nonsense: the drift already happened.
		expect(lines[0]).not.toContain("would drift");
		expect(lines[0]).toMatch(/^ {4}drift {3}/);
	});

	it("a harmless drift on a dry run still says nothing was written", async () => {
		const lines = await capture(
			{ dryRun: true, debug: false },
			withLogger((l) => l.driftDetected("variable", "NODE_ENV", harmlessDrift)),
		);
		expect(lines[0]).toContain("already matches config, nothing written");
		expect(lines[0]).not.toContain("would overwrite");
	});

	it("withholds fingerprints until debug", async () => {
		const atInfo = await capture(
			{ dryRun: false, debug: false },
			withLogger((l) => l.driftDetected("secret", "API_KEY", drift)),
		);
		expect(atInfo[0]).not.toContain("aaa111");

		const atVerbose = await capture(
			{ dryRun: false, debug: false },
			withLogger((l) => l.driftDetected("secret", "API_KEY", drift)),
		);
		expect(atVerbose[0]).not.toContain("aaa111");

		const atDebug = await capture(
			{ dryRun: false, debug: true },
			withLogger((l) => l.driftDetected("secret", "API_KEY", drift)),
		);
		expect(atDebug[0]).toContain("<- applied aaa111 live bbb222");
	});
});

describe("error handling", () => {
	it("logs errors inline", async () => {
		const lines = await capture(
			{ dryRun: false, debug: false },
			withLogger((l) => l.syncError("secret DEPLOY_KEY (actions)", "403 Forbidden")),
		);
		expect(lines).toContain("    error   secret DEPLOY_KEY (actions): 403 Forbidden");
	});

	it("finish reports accumulated errors", async () => {
		const lines = await capture(
			{ dryRun: false, debug: false },
			withLogger((l) =>
				Effect.gen(function* () {
					yield* l.repoStart("owner", "repo");
					yield* l.syncError("secret DEPLOY_KEY (actions)", "403 Forbidden");
					yield* l.finish();
				}),
			),
		);
		expect(lines).toContainEqual(expect.stringContaining("Sync complete with 1 error"));
		expect(lines).toContainEqual(expect.stringContaining("owner/repo: secret DEPLOY_KEY (actions)"));
	});

	it("pluralises the error count", async () => {
		const lines = await capture(
			{ dryRun: false, debug: false },
			withLogger((l) =>
				Effect.gen(function* () {
					yield* l.repoStart("owner", "repo");
					yield* l.syncError("a", "boom");
					yield* l.syncError("b", "boom");
					yield* l.finish();
				}),
			),
		);
		expect(lines).toContainEqual(expect.stringContaining("Sync complete with 2 errors"));
	});

	it("finish reports clean completion when no errors", async () => {
		const lines = await capture(
			{ dryRun: false, debug: false },
			withLogger((l) => l.finish()),
		);
		expect(lines).toContain("Sync complete!");
	});

	it("attributes an error to the repo that was current when it happened", async () => {
		const lines = await capture(
			{ dryRun: false, debug: false },
			withLogger((l) =>
				Effect.gen(function* () {
					yield* l.repoStart("owner", "first");
					yield* l.repoStart("owner", "second");
					yield* l.syncError("ruleset main", "422");
					yield* l.finish();
				}),
			),
		);
		expect(lines).toContainEqual(expect.stringContaining("owner/second: ruleset main"));
		expect(lines).not.toContainEqual(expect.stringContaining("owner/first: ruleset main"));
	});
});

describe("stream routing", () => {
	// The CLI entrypoint routes by log level: Error to stderr, everything else to
	// stdout. These assertions exist because every message-only test above stays
	// green when a line moves between streams — invisible to `toContain`, and
	// very visible to anyone running `reposets sync > log.txt`.

	it("emits failures at Error level", async () => {
		const entries = await captureLevels(
			{ dryRun: false, debug: false },
			withLogger((l) => l.syncError("settings", "403 Forbidden")),
		);

		expect(entries).toHaveLength(1);
		expect(entries[0]?.level).toBe("Error");
	});

	it("emits ordinary progress below Error", async () => {
		const entries = await captureLevels(
			{ dryRun: false, debug: false },
			withLogger((l) => l.groupStart("personal", 2, 2)),
		);

		expect(entries.length).toBeGreaterThan(0);
		for (const entry of entries) {
			expect(entry.level).not.toBe("Error");
		}
	});

	it("keeps a clean finish out of the error stream", async () => {
		const entries = await captureLevels(
			{ dryRun: false, debug: false },
			withLogger((l) => l.finish()),
		);

		expect(entries.length).toBeGreaterThan(0);
		expect(entries.every((e) => e.level !== "Error")).toBe(true);
	});

	it("puts the whole failing finish block on the error stream", async () => {
		const entries = await captureLevels(
			{ dryRun: false, debug: false },
			withLogger((l) =>
				Effect.gen(function* () {
					yield* l.repoStart("owner", "repo");
					yield* l.syncError("settings", "403 Forbidden");
					yield* l.finish();
				}),
			),
		);

		const block = entries.filter((e) => e.line.includes("Sync complete with") || e.line.includes("403"));
		expect(block.length).toBeGreaterThan(1);
		// Header and the list it introduces must not straddle two streams.
		expect(block.every((e) => e.level === "Error")).toBe(true);
	});
});

describe("groupStart, when a filter narrows the run", () => {
	it("says selected of declared, so the header and the summary agree", async () => {
		const lines = await capture(
			{ dryRun: false, debug: false },
			withLogger((l) => l.groupStart("sandbox", 1, 3)),
		);

		// Printing only the declared count made a filtered run read as
		// "(3 repos)" above a "1 repo(s)" summary for the same operation.
		expect(lines).toEqual(["group: sandbox (1 of 3 repos)"]);
	});

	it("says one number when nothing was filtered", async () => {
		const lines = await capture(
			{ dryRun: false, debug: false },
			withLogger((l) => l.groupStart("sandbox", 3, 3)),
		);

		expect(lines).toEqual(["group: sandbox (3 repos)"]);
	});
});

describe("settingsApplied names what it sent", () => {
	it("lists the fields, sorted", async () => {
		const lines = await capture(
			{ dryRun: true, debug: false },
			withLogger((l) => l.settingsApplied(["has_wiki", "allow_merge_commit", "has_issues"])),
		);

		// The point of reading a dry run is to see whether a conditional field
		// survived the gate — which "would apply settings" could never show.
		expect(lines).toEqual(["    would apply   settings (allow_merge_commit, has_issues, has_wiki)"]);
	});

	it("summarises a long group rather than wrapping a wall of keys", async () => {
		const many = ["a", "b", "c", "d", "e", "f", "g"];
		const lines = await capture(
			{ dryRun: false, debug: false },
			withLogger((l) => l.settingsApplied(many)),
		);

		expect(lines[0]).toContain("7 fields: a, b, c, d, e, …");
	});
});
