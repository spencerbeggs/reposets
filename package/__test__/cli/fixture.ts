import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { CliExit, CliLogger } from "@effected/cli";
import type { CliUiTestScreen, CliUiTestSession, CliUiTestSessionOptions } from "@effected/cli/ui/testing";
import { CliUiTest } from "@effected/cli/ui/testing";
import { AppDirs, Xdg } from "@effected/xdg";
import type { Exit, Scope } from "effect";
import { ConfigProvider, Effect, Fiber, Layer, MutableRef } from "effect";
import { afterEach, beforeEach } from "vitest";
import { CredentialsFilesLive, makeConfigFilesLive } from "../../src/services/ConfigFiles.js";
import { Invocation } from "../../src/services/Invocation.js";
import type { PresentationServices } from "../utils/capture.js";
import { presentation } from "../utils/capture.js";

/**
 * A temp project directory and XDG home per test, with the working directory
 * moved into it.
 *
 * @remarks
 * The config and credentials files resolve by walking up from the working
 * directory, so a test left at the repo root would read this repository's own
 * files. Registered as hooks by the caller's module, as `commands.test.ts`
 * does inline.
 */
export const useTempDirs = (): { readonly dir: () => string; readonly home: () => string } => {
	let dir = "";
	let home = "";
	let previous = "";
	beforeEach(() => {
		previous = process.cwd();
		dir = join(tmpdir(), `reposets-ui-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		home = join(dir, "home");
		mkdirSync(home, { recursive: true });
		process.chdir(dir);
	});
	afterEach(() => {
		process.chdir(previous);
		rmSync(dir, { recursive: true, force: true });
	});
	return { dir: () => dir, home: () => home };
};

/**
 * The directories only, as the production platform provides them.
 *
 * @remarks
 * No database: `init`, `nuke` and `credentials` never open one in production,
 * and a fixture that opened `store.db` would hand `nuke` a target it can never
 * have and make "Nothing to remove" unreachable.
 */
const DirsLive = Layer.provideMerge(AppDirs.layer({ namespace: "reposets-ui-test" }), Xdg.layer);

/** Every service the init / nuke / credentials handlers read, over the temp XDG root. */
export const services = (dir: string, home: string): Layer.Layer<never, unknown, never> => {
	const env: Record<string, string> = {
		HOME: home,
		XDG_CONFIG_HOME: join(home, ".config"),
		XDG_STATE_HOME: join(home, ".local/state"),
		XDG_CACHE_HOME: join(home, ".cache"),
		XDG_DATA_HOME: join(home, ".local/share"),
	};
	return Layer.mergeAll(
		makeConfigFilesLive(undefined),
		CredentialsFilesLive,
		Invocation.layer({ cwd: dir, version: "0.0.0-test" }),
	).pipe(
		Layer.provideMerge(DirsLive),
		Layer.provideMerge(NodeServices.layer),
		Layer.provideMerge(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
	) as unknown as Layer.Layer<never, unknown, never>;
};

/** What a handler still needs once {@link withServices} has run: what `runOutcome` and {@link interactive} provide. */
export type Handler = Effect.Effect<void, unknown, CliExit | PresentationServices>;

/**
 * Provide a handler's file, directory and invocation services.
 *
 * @remarks
 * The cast narrows what is left to the presentation and exit services;
 * {@link services} is typed as providing nothing because `makeConfigFilesLive`
 * and the directory layers do not name their outputs precisely enough to subtract.
 */
export const withServices = <E, R>(handler: Effect.Effect<void, E, R>, dir: string, home: string): Handler =>
	handler.pipe(Effect.provide(services(dir, home))) as unknown as Handler;

/** A forked interactive run: its session, and how to join it. */
export interface InteractiveRun {
	readonly session: CliUiTestSession;
	/** The next screen to mount, once it shows `contains`. */
	readonly next: (contains: string) => Effect.Effect<CliUiTestScreen>;
	/** The run's exit, with the exit code `CliExit` recorded on success. */
	readonly done: Effect.Effect<Exit.Exit<number, unknown>>;
}

/**
 * Fork a handler as a person at a terminal would run it.
 *
 * @remarks
 * The session's layer is provided **inside** the human presentation layer, so
 * its `CliInteractive` (true) and in-memory terminal win over `CliEnv.layerTest`,
 * whose own rule says a pipe is not interactive; the presentation layer still
 * supplies `Audience`, `TerminalEnv` and `CliLinks` for `Doc.print` and
 * `CliMessage`. `CliLogger` writes `Effect.log*` through the session's
 * `Console`, so diagnostics land in `session.stderr`.
 */
export const interactive = (
	handler: Handler,
	// Wide by default: temp-directory paths are long, and a widget truncates a
	// row to the terminal, so at 80 columns a path assertion would test the
	// truncation rather than the handler.
	options: CliUiTestSessionOptions = { columns: 400 },
): Effect.Effect<InteractiveRun, never, Scope.Scope> =>
	Effect.gen(function* () {
		const session = yield* CliUiTest.session(options);
		const program = Effect.gen(function* () {
			const cell = yield* CliExit;
			yield* handler;
			return MutableRef.get(cell.code);
		}).pipe(
			Effect.provide(CliExit.layer),
			Effect.provide(CliLogger.layer()),
			Effect.provide(session.layer),
			Effect.provide(presentation({ audience: "human" })),
		);
		const fiber = yield* Effect.forkScoped(program);
		return {
			session,
			next: (contains) => session.next({ contains }),
			done: Fiber.await(fiber),
		};
	});
