#!/usr/bin/env node
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { App } from "@effected/app";
import { Effect, Layer } from "effect";
import { Command } from "effect/unstable/cli";
import { formatSchemaIssue } from "../lib/schema-issues.js";
import { CredentialsFilesLive } from "../services/ConfigFiles.js";
import { migrations } from "../store/migrations.js";
import { SyncJournalLive } from "../store/SyncJournal.js";
import { credentialsCommand } from "./commands/credentials.js";
import { doctorCommand } from "./commands/doctor.js";
import { driftCommand } from "./commands/drift.js";
import { historyCommand } from "./commands/history.js";
import { initCommand } from "./commands/init.js";
import { listCommand } from "./commands/list.js";
import { nukeCommand } from "./commands/nuke.js";
import { syncCommand } from "./commands/sync.js";
import { validateCommand } from "./commands/validate.js";
import { ConfigFlag, ConfigLive } from "./flags.js";
import { CliLoggerLive } from "./logger.js";

/**
 * The application control plane.
 *
 * @remarks
 * Bound once, at module scope. `App.layer` opens both SQLite databases, so a
 * second call would open a second pair with split event streams.
 *
 * Migrations run during layer construction, so a fresh checkout gets its schema
 * on the first command rather than on first write.
 */
const AppLive = App.layer({
	namespace: "reposets",
	store: { migrations },
});

/**
 * The root command.
 *
 * @remarks
 * `Command.provide(ConfigLive)` sits here, once, rather than in each subcommand:
 * subcommand requirements bubble into the parent's `R` through
 * `withSubcommands`, so one provide covers all of them.
 */
const cli = Command.make("reposets", {}, () => Effect.void).pipe(
	Command.withDescription("Sync GitHub repository settings across repos from a TOML config"),
	Command.withSubcommands([
		validateCommand,
		syncCommand,
		listCommand,
		doctorCommand,
		driftCommand,
		initCommand,
		nukeCommand,
		historyCommand,
		credentialsCommand,
	]),
	Command.provide(ConfigLive),
	Command.provide(CredentialsFilesLive),
	Command.provide(SyncJournalLive),
	Command.withGlobalFlags([ConfigFlag]),
);

// The CLI logger is merged rather than provided beneath: it replaces Effect's
// default logger for every line the program emits, including those from layer
// construction.
const MainLive = Layer.mergeAll(Layer.provideMerge(AppLive, NodeServices.layer), CliLoggerLive);

/**
 * Report a failure through the CLI logger and exit non-zero.
 *
 * @remarks
 * `NodeRuntime.runMain` reports an unhandled failure with Effect's *default*
 * logger, which sits outside the layers the program was provided — so a failure
 * escaping to it prints `[23:05:56] ERROR (#2): …` **on stdout**, in the format
 * {@link CliLoggerLive} exists to replace, on the stream errors must not use.
 *
 * Catching here keeps the failure inside the logger's scope. The exit code is
 * then ours to set, since the effect now succeeds.
 */
const reportAndExit = (error: unknown): Effect.Effect<void> =>
	Effect.gen(function* () {
		yield* Effect.logError(String(error));

		// A validation failure's own message names the file and stops there. The
		// structured cause is on its `issue` field, and core's
		// `makeFormatterStandardSchemaV1` renders it — so the failure describes
		// itself here rather than telling a CI log to go run another command.
		// The `doctor` pointer stays, because doctor adds nearest-match
		// suggestions this cannot.
		if (isTagged(error, "ConfigValidationError")) {
			const lines = formatSchemaIssue((error as { readonly issue?: unknown }).issue);
			for (const line of lines) {
				yield* Effect.logError(`  ${line}`);
			}
			// Only offer spellings when something was actually misspelled. A
			// missing key has no near-match to suggest, and pointing a confused
			// user at a command that cannot help them is worse than saying
			// nothing.
			if (lines.some((line) => line.startsWith("unknown key"))) {
				yield* Effect.logError("  Run 'reposets doctor' for suggested spellings.");
			}
		}

		yield* Effect.sync(() => {
			process.exitCode = 1;
		});
	});

/** Whether a caught value is a tagged error of a given tag. */
const isTagged = (error: unknown, tag: string): boolean =>
	typeof error === "object" && error !== null && "_tag" in error && (error as { _tag: unknown })._tag === tag;

cli.pipe(
	Command.run({ version: process.env.__PACKAGE_VERSION__ ?? "0.0.0" }),
	Effect.catch(reportAndExit),
	Effect.provide(MainLive),
	NodeRuntime.runMain,
);
