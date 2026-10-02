#!/usr/bin/env node
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { AppCache, AppStore } from "@effected/app";
import type { FailureDetails } from "@effected/cli";
import { CliAudience, CliRuntime, ConfigIssueRenderer, Fmt } from "@effected/cli";
import type { ConfigValidationError } from "@effected/config-file";
import { AppDirs, Xdg } from "@effected/xdg";
import { Effect, Layer } from "effect";
import { Command } from "effect/cli";
import { CredentialsFilesLive } from "../services/ConfigFiles.js";
import { Invocation } from "../services/Invocation.js";
import { CACHE_DB_FILENAME, STATE_DB_FILENAME } from "../store/files.js";
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

/**
 * The build's version.
 *
 * @remarks
 * The bundler substitutes `process.env.__PACKAGE_VERSION__` with a literal at
 * build time, so this is not a runtime environment read. Only the exact
 * `process.env.__PACKAGE_VERSION__` spelling is substituted — a destructured
 * `env.__PACKAGE_VERSION__` is not, which is why `doctor` printed
 * `0.0.0 (dev build)` from every build until the version was threaded down
 * from here through {@link Invocation}.
 */
const VERSION: string = process.env.__PACKAGE_VERSION__ ?? "0.0.0";

/**
 * The application's directories: XDG resolution and the `reposets` namespace
 * under it.
 *
 * @remarks
 * Built the way `App.layer` builds its own (`AppDirs.layer` `provideMerge`
 * `Xdg.layer`), but without the two databases `App.layer` always opens. Every
 * command can resolve a path through this; resolving one creates nothing —
 * only an `ensure*` member does, and only the command that writes calls it.
 */
const DirsLive = Layer.provideMerge(AppDirs.layer({ namespace: "reposets" }), Xdg.layer);

/**
 * The state database, `store.db` under the XDG state directory.
 *
 * @remarks
 * Bound once, at module scope: `AppStore.layer` is a layer-returning function,
 * and a second call would open a second connection onto the same file with a
 * second migration ledger.
 *
 * It is attached only to the commands that read or write it
 * ({@link DatabasesLive}, {@link HistoryLive}), not to the platform. When it sat in the
 * platform, every command — `init`, `list`, `validate`, `nuke` — opened (and so
 * created) `store.db` as a side effect, and `nuke` deleted the database while
 * its own process held it open, leaving its `-wal` and `-shm` files behind.
 * Migrations still run during layer construction, so they now run on the first
 * command that uses the database rather than on the first command of any kind.
 */
const StoreLive = AppStore.layer({ migrations, filename: STATE_DB_FILENAME });

/**
 * Both databases, for the commands that run the sync engine.
 *
 * @remarks
 * `sync` and `drift` read and write the applied state and memoize GitHub reads
 * in `cache.db`. The engine builds its own journal over `Store`, so nothing
 * else is needed here.
 */
const DatabasesLive = Layer.mergeAll(StoreLive, AppCache.layer({ filename: CACHE_DB_FILENAME }));

/**
 * The run journal over the state database, for `history` and its subcommands.
 *
 * @remarks
 * `history` reads only the journal, so it opens `store.db` and never
 * `cache.db`.
 */
const HistoryLive = SyncJournalLive.pipe(Layer.provide(StoreLive));

/**
 * Everything this module reads from `process`, handed down as plain values.
 *
 * @remarks
 * This file is the only one under `src/` allowed to read `process`. Commands and
 * services require {@link Invocation} instead, so a test can hand them a
 * different working directory. Two things are deliberately not here: the
 * environment, which every reader takes through Effect's `Config` (the default
 * `ConfigProvider` reads the process environment, so nothing here has to), and
 * whether stdin is a terminal, which `nuke` asks core's `Stdio.stdinIsTerminal`.
 */
const InvocationLive = Invocation.layer({ cwd: process.cwd(), version: VERSION });

/**
 * The root command.
 *
 * @remarks
 * `Command.provide(ConfigLive)` sits here, once, rather than in each subcommand:
 * subcommand requirements bubble into the parent's `R` through
 * `withSubcommands`, so one provide covers all of them.
 *
 * The databases are the deliberate exception. They are provided per command,
 * to `sync`, `drift` and `history` only, because providing them here would
 * open both files for every command again — see {@link StoreLive}. A command
 * that does not name `Store` or `Cache` in its requirements never opens one.
 *
 * `CliAudience.flags()` adds `--audience`, `--human`, `--agent` and `--ci` to
 * every command. `CliAudience.run` resolves them before core parses, so the
 * audience is known to every prompt, report and failure line the run writes.
 */
const cli = Command.make("reposets", {}, () => Effect.void).pipe(
	Command.withDescription("Sync GitHub repository settings across repos from a TOML config"),
	Command.withSubcommands([
		validateCommand,
		syncCommand.pipe(Command.provide(DatabasesLive)),
		listCommand,
		doctorCommand,
		driftCommand.pipe(Command.provide(DatabasesLive)),
		initCommand,
		nukeCommand,
		// Provided after `history`'s own `withSubcommands`, so it wraps the
		// dispatch and covers `show`, `prune` and `clear` as well.
		historyCommand.pipe(Command.provide(HistoryLive)),
		credentialsCommand,
	]),
	Command.provide(ConfigLive),
	Command.provide(CredentialsFilesLive),
	Command.withGlobalFlags([ConfigFlag]),
	Command.withSharedFlags(CliAudience.flags()),
);

/**
 * The platform: Node's services, the application's directories over them, and
 * the invocation facts.
 *
 * @remarks
 * `provideMerge` rather than `provide`, because commands require the platform
 * services (`FileSystem`, `Path`, `Stdio`) directly as well as through
 * `AppDirs`, and the per-command database layers need `FileSystem`, `Path` and
 * `AppDirs` from here. No database is opened at this level.
 * There is no formatter here: under `env`, `CliRuntime.main` installs the
 * colour-aware help formatter itself, closer to the program, and one set here
 * would be shadowed.
 */
const PlatformLive = Layer.mergeAll(DirsLive, InvocationLive).pipe(Layer.provideMerge(NodeServices.layer));

/** Whether a failure is a tagged error of a given tag. */
const isTagged = (error: unknown, tag: string): boolean =>
	typeof error === "object" && error !== null && "_tag" in error && (error as { _tag: unknown })._tag === tag;

/**
 * Render a failure that escaped a command, one line at a time, to stderr.
 *
 * @remarks
 * `CliRuntime.main` hands this every failure it does not already know how to
 * skip — a usage error `Command.runWith` printed itself never reaches it, and a
 * cancelled prompt is drawn by the kit — and logs each returned line before
 * exiting `1`.
 *
 * A config that fails to decode arrives here as a `ConfigValidationError`.
 * The kit's default report already draws its issue as a tree of rejected keys,
 * so the failure describes itself rather than telling a CI log to go run
 * another command; this adds only the `doctor` pointer, and only when
 * something was misspelled (`ConfigIssueRenderer` names it an `unknown key`).
 * A missing key has no near-match to suggest, and pointing a confused user at
 * a command that cannot help them is worse than saying nothing.
 *
 * Any other typed failure that carries a `cause` gets it printed under the
 * kit's own status line. A TOML syntax error is a `ConfigCodecError` whose own
 * message is the bare "toml parse failed" — the line and column live on the
 * cause, and printing it is the difference between "your config is broken
 * somewhere" and a position plus what the parser expected there. The cause
 * reports a 0-based `line:column`: an unclosed `[groups` header on the first
 * line reads "ExpectedTableHeaderClose at 0:7 expected ] to close the table
 * header".
 *
 * Everything else, defects included, is the kit's default report. Lines built
 * here from data are sanitised: the kit keeps a person's escapes, so it cannot
 * strip an injected one from a `render`'s output.
 */
const render = (error: unknown, details: FailureDetails): ReadonlyArray<string> => {
	if (details.isDefect) return details.defaultLines;
	if (isTagged(error, "ConfigValidationError")) {
		const misspelled = ConfigIssueRenderer.render(error as ConfigValidationError).some((line) =>
			line.startsWith("unknown key"),
		);
		return misspelled
			? [...details.defaultLines, "Run 'reposets doctor' for suggested spellings."]
			: details.defaultLines;
	}
	if (typeof error === "object" && error !== null && "cause" in error && error.cause !== undefined) {
		return [...details.defaultLines, `  ${Fmt.sanitize(String(error.cause))}`];
	}
	return details.defaultLines;
};

NodeRuntime.runMain(
	CliRuntime.main(CliAudience.run(cli, { version: VERSION }), {
		platform: PlatformLive,
		env: {
			// `--audience` and its shorthands win; this variable overrides detection.
			audienceEnvVar: "REPOSETS_AUDIENCE",
			// Opt-in diagnostics: pretty for a person, NDJSON for an agent or CI.
			log: { envVar: "REPOSETS_LOG_LEVEL" },
			// Core's `Stdio` reports stdout only; stderr is painted by its own answer.
			stderrIsTerminal: Effect.sync(() => process.stderr.isTTY === true),
		},
		render,
		helpOnUsageError: "stderr",
	}),
);
