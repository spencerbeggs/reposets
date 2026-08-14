import { AppDirs } from "@effected/xdg";
import { Effect, FileSystem, Path } from "effect";
import { Command, Flag, Prompt } from "effect/unstable/cli";
import { CONFIG_FILENAME, CREDENTIALS_FILENAME } from "../../services/ConfigFiles.js";

const forceFlag = Flag.boolean("force").pipe(
	Flag.withDescription("Delete without asking. Intended for scripts; there is no undo"),
);

/** One thing that would be removed, and what losing it costs. */
interface Target {
	readonly path: string;
	readonly what: string;
	readonly cost: string;
}

/**
 * Everything reposets has written to this machine.
 *
 * @remarks
 * Assembled by **looking**, not by assuming: only paths that exist are
 * returned, so the confirmation lists what will actually be deleted rather than
 * everything that might. A prompt that overstates is a prompt people learn to
 * skim.
 *
 * The upward walk mirrors the config resolver's own chain — a project-local
 * file anywhere between the working directory and the filesystem root — because
 * the file a user is thinking of is the one the CLI would load, and that is not
 * always the one in the current directory.
 */
const findTargets = (
	fs: FileSystem.FileSystem,
	path: Path.Path,
	appDirs: AppDirs["Service"],
	from: string,
): Effect.Effect<ReadonlyArray<Target>> =>
	Effect.gen(function* () {
		const candidates: Array<Target> = [];

		let dir = from;
		for (;;) {
			candidates.push(
				{ path: path.join(dir, CONFIG_FILENAME), what: "project config", cost: "your groups and settings" },
				{
					path: path.join(dir, CREDENTIALS_FILENAME),
					what: "project credentials",
					cost: "token references, not tokens",
				},
			);
			const parent = path.dirname(dir);
			if (parent === dir) break;
			dir = parent;
		}

		candidates.push(
			{ path: path.join(appDirs.dirs.config, CONFIG_FILENAME), what: "user config", cost: "your groups and settings" },
			{
				path: path.join(appDirs.dirs.config, CREDENTIALS_FILENAME),
				what: "user credentials",
				cost: "token references, not tokens",
			},
			{
				path: path.join(appDirs.dirs.state, "store.db"),
				what: "state database",
				// Said plainly because it is the only irreversible consequence here.
				// The config files are recoverable from a backup or rewritten by hand;
				// the applied-state fingerprints cannot be reconstructed, and without
				// them the next run reports a first sync where a real out-of-band edit
				// happened.
				cost: "run history AND the drift baselines — drift detection restarts from nothing",
			},
		);

		const present: Array<Target> = [];
		for (const candidate of candidates) {
			const info = yield* fs.stat(candidate.path).pipe(Effect.option);
			if (info._tag === "Some" && info.value.type === "File") present.push(candidate);
		}
		return present;
	});

/**
 * `reposets nuke` — remove everything reposets has written locally.
 *
 * @remarks
 * **Nothing on GitHub is touched.** Every secret, variable, ruleset and setting
 * this tool has ever applied stays exactly where it is; this removes the local
 * files and the local database, which is what "leave no trace on this machine"
 * means.
 *
 * Without `--force` it lists what it found and asks. The prompt defaults to
 * **no**, and a non-interactive shell is refused rather than assumed: a
 * destructive command that proceeds because nobody was there to answer is the
 * one failure mode worth engineering against.
 *
 * @public
 */
export const nukeHandler = (
	force: boolean,
	// `Prompt` runs against the CLI's own environment rather than raw stdio,
	// which is what lets a test drive the confirmation without a terminal.
): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path | AppDirs | Command.Environment> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const appDirs = yield* AppDirs;

		const targets = yield* findTargets(fs, path, appDirs, process.cwd());

		if (targets.length === 0) {
			yield* Effect.log("Nothing to remove — no reposets files found on this machine.");
			return;
		}

		yield* Effect.log("This will delete:");
		for (const target of targets) {
			yield* Effect.log(`  ${target.path}`);
			yield* Effect.log(`    ${target.what} — loses ${target.cost}`);
		}
		yield* Effect.log("");
		yield* Effect.log("Nothing on GitHub is touched. Everything reposets applied stays applied.");

		if (!force) {
			// `process.stdin.isTTY` is undefined when piped. Prompting there either
			// hangs forever or reads whatever happens to be on stdin, and both are
			// worse than refusing.
			if (process.stdin.isTTY !== true) {
				yield* Effect.logError("");
				yield* Effect.logError("Refusing: not an interactive terminal, and --force was not given.");
				yield* Effect.sync(() => {
					process.exitCode = 1;
				});
				return;
			}

			yield* Effect.log("");
			const confirmed = yield* Prompt.confirm({
				message: `Delete ${targets.length} file${targets.length === 1 ? "" : "s"}?`,
			}).pipe(Effect.orElseSucceed(() => false));

			if (!confirmed) {
				yield* Effect.log("Nothing was deleted.");
				return;
			}
		}

		let removed = 0;
		for (const target of targets) {
			const outcome = yield* fs.remove(target.path).pipe(Effect.result);
			if (outcome._tag === "Failure") {
				yield* Effect.logError(`  could not remove ${target.path} — ${String(outcome.failure)}`);
				continue;
			}
			removed += 1;
			yield* Effect.log(`  removed ${target.path}`);
		}

		yield* Effect.log("");
		yield* Effect.log(
			removed === targets.length
				? `Done. ${removed} file${removed === 1 ? "" : "s"} removed.`
				: `Removed ${removed} of ${targets.length}; the rest are listed above.`,
		);
	});

/**
 * The `nuke` command.
 *
 * @public
 */
export const nukeCommand = Command.make("nuke", { force: forceFlag }, ({ force }) => nukeHandler(force)).pipe(
	Command.withDescription("Delete every reposets file on this machine. Nothing on GitHub is touched"),
);
