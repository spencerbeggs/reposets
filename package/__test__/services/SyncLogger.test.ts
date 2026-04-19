import { Effect, Ref } from "effect";
import { describe, expect, it } from "vitest";
import { SyncLogger, SyncLoggerLive } from "../../src/services/SyncLogger.js";

function runWithLogger(
	options: { dryRun: boolean; logLevel: "silent" | "info" | "verbose" | "debug" },
	program: Effect.Effect<void, never, SyncLogger>,
): Promise<string[]> {
	return Effect.gen(function* () {
		const output = yield* Ref.make<string[]>([]);
		const layer = SyncLoggerLive({ ...options, output });
		const lines = yield* Effect.provide(
			Effect.gen(function* () {
				yield* program;
				return yield* Ref.get(output);
			}),
			layer,
		);
		return lines;
	}).pipe(Effect.runPromise);
}

describe("SyncLogger", () => {
	describe("info tier", () => {
		it("logs group header", async () => {
			const lines = await runWithLogger(
				{ dryRun: false, logLevel: "info" },
				Effect.gen(function* () {
					const logger = yield* SyncLogger;
					yield* logger.groupStart("personal", 3);
				}),
			);
			expect(lines).toContain("group: personal (3 repos)");
		});

		it("logs repo header", async () => {
			const lines = await runWithLogger(
				{ dryRun: false, logLevel: "info" },
				Effect.gen(function* () {
					const logger = yield* SyncLogger;
					yield* logger.repoStart("owner", "repo");
				}),
			);
			expect(lines).toContain("  repo: owner/repo");
		});

		it("logs sync summary", async () => {
			const lines = await runWithLogger(
				{ dryRun: false, logLevel: "info" },
				Effect.gen(function* () {
					const logger = yield* SyncLogger;
					yield* logger.syncSummary("secret", 3, "actions: 2, dependabot: 1");
				}),
			);
			expect(lines).toContain("    synced  3 secrets (actions: 2, dependabot: 1)");
		});

		it("logs settings applied", async () => {
			const lines = await runWithLogger(
				{ dryRun: false, logLevel: "info" },
				Effect.gen(function* () {
					const logger = yield* SyncLogger;
					yield* logger.settingsApplied();
				}),
			);
			expect(lines).toContain("    applied settings");
		});

		it("logs cleanup summary with names", async () => {
			const lines = await runWithLogger(
				{ dryRun: false, logLevel: "info" },
				Effect.gen(function* () {
					const logger = yield* SyncLogger;
					yield* logger.cleanupSummary("secret", 2, ["OLD_TOKEN", "STALE_KEY"]);
				}),
			);
			expect(lines).toContain("    deleted 2 secrets (OLD_TOKEN, STALE_KEY)");
		});

		it("logs repo skip", async () => {
			const lines = await runWithLogger(
				{ dryRun: false, logLevel: "info" },
				Effect.gen(function* () {
					const logger = yield* SyncLogger;
					yield* logger.repoSkip("owner", "repo", "no changes configured");
				}),
			);
			expect(lines).toContain("  repo: owner/repo");
			expect(lines).toContain("    skip    no changes configured");
		});

		it("does not include verbose operation lines at info level", async () => {
			const lines = await runWithLogger(
				{ dryRun: false, logLevel: "info" },
				Effect.gen(function* () {
					const logger = yield* SyncLogger;
					yield* logger.syncOperation("sync", "secret", "API_KEY", "(actions)");
				}),
			);
			expect(lines).toHaveLength(0);
		});
	});

	describe("verbose tier", () => {
		it("includes per-operation lines", async () => {
			const lines = await runWithLogger(
				{ dryRun: false, logLevel: "verbose" },
				Effect.gen(function* () {
					const logger = yield* SyncLogger;
					yield* logger.syncOperation("sync", "secret", "API_KEY", "(actions)");
				}),
			);
			expect(lines).toContain("    sync    secret API_KEY (actions)");
		});

		it("does not include source info at verbose level", async () => {
			const lines = await runWithLogger(
				{ dryRun: false, logLevel: "verbose" },
				Effect.gen(function* () {
					const logger = yield* SyncLogger;
					yield* logger.syncOperation("sync", "secret", "API_KEY", "(actions)", "op://vault/item/key");
				}),
			);
			expect(lines).toContain("    sync    secret API_KEY (actions)");
			expect(lines).not.toContainEqual(expect.stringContaining("<-"));
		});
	});

	describe("debug tier", () => {
		it("includes source info on operation line", async () => {
			const lines = await runWithLogger(
				{ dryRun: false, logLevel: "debug" },
				Effect.gen(function* () {
					const logger = yield* SyncLogger;
					yield* logger.syncOperation("sync", "secret", "API_KEY", "(actions)", "op://vault/item/key");
				}),
			);
			expect(lines).toContain("    sync    secret API_KEY (actions) <- op://vault/item/key");
		});
	});

	describe("silent tier", () => {
		it("produces no output", async () => {
			const lines = await runWithLogger(
				{ dryRun: false, logLevel: "silent" },
				Effect.gen(function* () {
					const logger = yield* SyncLogger;
					yield* logger.groupStart("personal", 3);
					yield* logger.repoStart("owner", "repo");
					yield* logger.syncSummary("secret", 1, "actions: 1");
					yield* logger.syncError("secret API_KEY (actions)", "403 Forbidden");
				}),
			);
			expect(lines).toHaveLength(0);
		});
	});

	describe("dry run", () => {
		it("prepends would to sync summary", async () => {
			const lines = await runWithLogger(
				{ dryRun: true, logLevel: "info" },
				Effect.gen(function* () {
					const logger = yield* SyncLogger;
					yield* logger.syncSummary("secret", 3, "actions: 2, dependabot: 1");
				}),
			);
			expect(lines).toContain("    would sync    3 secrets (actions: 2, dependabot: 1)");
		});

		it("prepends would to settings applied", async () => {
			const lines = await runWithLogger(
				{ dryRun: true, logLevel: "info" },
				Effect.gen(function* () {
					const logger = yield* SyncLogger;
					yield* logger.settingsApplied();
				}),
			);
			expect(lines).toContain("    would apply   settings");
		});

		it("prepends would to cleanup summary", async () => {
			const lines = await runWithLogger(
				{ dryRun: true, logLevel: "info" },
				Effect.gen(function* () {
					const logger = yield* SyncLogger;
					yield* logger.cleanupSummary("variable", 1, ["STALE_VAR"]);
				}),
			);
			expect(lines).toContain("    would delete  1 variable (STALE_VAR)");
		});

		it("prepends would to verbose operation lines", async () => {
			const lines = await runWithLogger(
				{ dryRun: true, logLevel: "verbose" },
				Effect.gen(function* () {
					const logger = yield* SyncLogger;
					yield* logger.syncOperation("sync", "secret", "API_KEY", "(actions)");
				}),
			);
			expect(lines).toContain("    would sync    secret API_KEY (actions)");
		});
	});

	describe("error handling", () => {
		it("logs errors inline", async () => {
			const lines = await runWithLogger(
				{ dryRun: false, logLevel: "info" },
				Effect.gen(function* () {
					const logger = yield* SyncLogger;
					yield* logger.syncError("secret DEPLOY_KEY (actions)", "403 Forbidden");
				}),
			);
			expect(lines).toContain("    error   secret DEPLOY_KEY (actions): 403 Forbidden");
		});

		it("finish reports accumulated errors", async () => {
			const lines = await runWithLogger(
				{ dryRun: false, logLevel: "info" },
				Effect.gen(function* () {
					const logger = yield* SyncLogger;
					yield* logger.repoStart("owner", "repo");
					yield* logger.syncError("secret DEPLOY_KEY (actions)", "403 Forbidden");
					yield* logger.finish();
				}),
			);
			expect(lines).toContainEqual(expect.stringContaining("Sync complete with 1 error"));
			expect(lines).toContainEqual(expect.stringContaining("owner/repo: secret DEPLOY_KEY (actions)"));
		});

		it("finish reports clean completion when no errors", async () => {
			const lines = await runWithLogger(
				{ dryRun: false, logLevel: "info" },
				Effect.gen(function* () {
					const logger = yield* SyncLogger;
					yield* logger.finish();
				}),
			);
			expect(lines).toContain("Sync complete!");
		});
	});
});
