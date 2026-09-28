#!/usr/bin/env node
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { App } from "@effected/app";
import { CliColor, CliRuntime, ConfigIssueRenderer } from "@effected/cli";
import type { ConfigValidationError } from "@effected/config-file";
import { Effect, Layer } from "effect";
import { Command } from "effect/cli";
import { CredentialsFilesLive } from "../services/ConfigFiles.js";
import { Invocation } from "../services/Invocation.js";
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

/**
 * The platform: Node's services, the application control plane over them, the
 * invocation facts, and one colour-aware help/error formatter.
 *
 * @remarks
 * `provideMerge` rather than `provide` at each step, because commands require
 * the platform services (`FileSystem`, `Path`, `Stdio`) directly as well as
 * through `App`. `CliColor.formatterLayer()` needs `Stdio` to decide whether
 * colour is on, so it sits above `NodeServices.layer` rather than beside it.
 */
const PlatformLive = Layer.mergeAll(AppLive, CliColor.formatterLayer(), InvocationLive).pipe(
	Layer.provideMerge(NodeServices.layer),
);

/** Whether a failure is a tagged error of a given tag. */
const isTagged = (error: unknown, tag: string): boolean =>
	typeof error === "object" && error !== null && "_tag" in error && (error as { _tag: unknown })._tag === tag;

/**
 * Render a failure that escaped a command, one line at a time, to stderr.
 *
 * @remarks
 * `CliRuntime.main` hands this every failure it does not already know how to
 * skip — a usage error `Command.runWith` printed itself never reaches it — and
 * logs each returned line through `CliLogger` before exiting `1`.
 *
 * A config that fails to decode arrives here as a `ConfigValidationError`,
 * whose message names the file and stops there. The structured cause is on its
 * `issue`, which `ConfigIssueRenderer` turns into `unknown key at …` lines, so
 * the failure describes itself rather than telling a CI log to go run another
 * command. The `doctor` pointer stays only when something was misspelled — a
 * missing key has no near-match to suggest, and pointing a confused user at a
 * command that cannot help them is worse than saying nothing.
 *
 * Any other failure that carries a `cause` gets it printed on a second line. A
 * TOML syntax error is a `ConfigCodecError` whose own message is the bare
 * "toml parse failed" — the line and column live on the cause, and printing it
 * is the difference between "your config is broken somewhere" and "1:9,
 * expected ] to close the table header".
 */
const render = (error: unknown): ReadonlyArray<string> => {
	const lines = [String(error)];
	if (isTagged(error, "ConfigValidationError")) {
		const issues = ConfigIssueRenderer.render(error as ConfigValidationError);
		lines.push(...issues.map((line) => `  ${line}`));
		if (issues.some((line) => line.startsWith("unknown key"))) {
			lines.push("  Run 'reposets doctor' for suggested spellings.");
		}
	} else if (typeof error === "object" && error !== null && "cause" in error && error.cause !== undefined) {
		lines.push(`  ${String(error.cause)}`);
	}
	return lines;
};

NodeRuntime.runMain(
	CliRuntime.main(Command.run(cli, { version: VERSION }), {
		platform: PlatformLive,
		render,
		helpOnUsageError: "stderr",
	}),
);
