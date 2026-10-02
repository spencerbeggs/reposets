import type { Cancelled, CliLinks, CliTheme, Document } from "@effected/cli";
import { CliExit, CliInteractive, CliMessage, Doc } from "@effected/cli";
import type { MultiSelectSection } from "@effected/cli/ui";
import { CliUi, Confirm, MultiSelect } from "@effected/cli/ui";
import type { Audience, TerminalEnv } from "@effected/env";
import { AppDirs, Xdg } from "@effected/xdg";
import { Effect, FileSystem, Path } from "effect";
import { CliError, Command, Flag } from "effect/cli";
import { CONFIG_FILENAME, CREDENTIALS_FILENAME } from "../../services/ConfigFiles.js";
import { Invocation } from "../../services/Invocation.js";

const forceFlag = Flag.Boolean("force").pipe(
	Flag.withDefault(false),
	Flag.withDescription("Delete without asking. Intended for scripts; there is no undo"),
);

/**
 * Where a target lives, which is also the section the picker groups it under.
 *
 * @remarks
 * The three are different decisions for a person: a project file belongs to one
 * checkout, a user file to every run on this machine, and the state database is
 * the one thing that cannot be rebuilt. Grouping the picker by them lets someone
 * clear a stale project config while keeping the drift baselines.
 */
type Location = "project" | "user" | "state";

/** One thing that would be removed, and what losing it costs. */
interface Target {
	readonly path: string;
	readonly what: string;
	readonly cost: string;
	readonly location: Location;
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
				{
					path: path.join(dir, CONFIG_FILENAME),
					what: "project config",
					cost: "your groups and settings",
					location: "project",
				},
				{
					path: path.join(dir, CREDENTIALS_FILENAME),
					what: "project credentials",
					cost: "token references, not tokens",
					location: "project",
				},
			);
			const parent = path.dirname(dir);
			if (parent === dir) break;
			dir = parent;
		}

		candidates.push(
			{
				path: path.join(appDirs.dirs.config, CONFIG_FILENAME),
				what: "user config",
				cost: "your groups and settings",
				location: "user",
			},
			{
				path: path.join(appDirs.dirs.config, CREDENTIALS_FILENAME),
				what: "user credentials",
				cost: "token references, not tokens",
				location: "user",
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
				location: "state",
			},
		);

		const present: Array<Target> = [];
		for (const candidate of candidates) {
			const info = yield* fs.stat(candidate.path).pipe(Effect.option);
			if (info._tag === "Some" && info.value.type === "File") present.push(candidate);
		}
		return present;
	});

const plural = (n: number): string => `${n} file${n === 1 ? "" : "s"}`;

/**
 * The list of what was found, as a document.
 *
 * @remarks
 * Printed before any question and whether or not one is asked, so a `--force`
 * run in a script leaves the same record in its log that a person reads before
 * answering. When the state database is among the targets its loss is said a
 * second time, as a warning callout: of everything listed it is the only
 * deletion that cannot be undone by restoring or rewriting a file.
 */
const targetsDoc = (targets: ReadonlyArray<Target>): Document => [
	Doc.section("This will delete:", [
		Doc.list(
			targets.map((target) =>
				Doc.lines([
					Doc.file(target.path),
					target.location === "state"
						? [`${target.what} — loses `, Doc.text(target.cost, "warning")]
						: `${target.what} — loses ${target.cost}`,
				]),
			),
			{ compact: true },
		),
	]),
	...(targets.some((target) => target.location === "state")
		? [
				Doc.callout("warning", [
					Doc.paragraph(
						"Deleting the state database cannot be undone: the drift baselines it holds cannot be rebuilt.",
					),
				]),
			]
		: []),
	Doc.paragraph("Nothing on GitHub is touched. Everything reposets applied stays applied."),
];

const SECTION_TITLES: Record<Location, string> = {
	project: "Project files",
	user: "User files",
	state: "State",
};

/**
 * A short, still unambiguous name for a target, for the picker's rows.
 *
 * @remarks
 * A picker row is truncated to the terminal, and an absolute path under a
 * temp or home directory loses exactly the part that tells two files apart.
 * A project file is shown relative to the working directory — `./` or a run of
 * `../` — which is short and distinguishes the same filename at different
 * levels of the upward walk; anything under the home directory is shown with
 * `~`. The absolute path stays in the row's detail and in the list printed
 * above the picker.
 */
const shortPath = (path: Path.Path, cwd: string, home: string, target: Target): string => {
	if (target.location === "project") {
		const relative = path.relative(cwd, target.path);
		return relative.startsWith("..") ? relative : `.${path.sep}${relative}`;
	}
	const homePrefix = home.endsWith(path.sep) ? home : `${home}${path.sep}`;
	return target.path.startsWith(homePrefix) ? `~${path.sep}${target.path.slice(homePrefix.length)}` : target.path;
};

/**
 * The picker's sections: every target pre-selected, grouped by where it lives.
 *
 * @remarks
 * Pre-selected because the command's name is the request — a person who ran
 * `nuke` and presses enter gets what they asked for, and still has the
 * confirmation after it. An empty section is left out rather than drawn as a
 * heading with nothing under it. Each row reads `what: short path` (see
 * {@link shortPath}); the highlighted row's detail is the absolute path.
 */
const pickerSections = (
	targets: ReadonlyArray<Target>,
	short: (target: Target) => string,
): ReadonlyArray<MultiSelectSection<Target>> =>
	(["project", "user", "state"] as const)
		.map((location) => ({
			title: SECTION_TITLES[location],
			items: targets
				.filter((target) => target.location === location)
				.map((target) => ({
					key: target.path,
					label: `${target.what}: ${short(target)}`,
					value: target,
					detail: target.path,
					selected: true,
				})),
		}))
		.filter((section) => section.items.length > 0);

/**
 * Ask a person which of the targets to delete, then whether to go ahead.
 *
 * @remarks
 * Returns the targets to remove — empty when the person deselected everything
 * or answered no. Both screens run only when {@link nukeHandler} has already
 * established the run is interactive; the `NotInteractive` the kit could still
 * report is mapped to the same refusal, so there is one answer for "nobody is
 * there" however it is detected. A cancel (Esc, `q`, Ctrl-C) is the kit's
 * `Cancelled`, left to propagate: `CliRuntime.main` renders it as one line and
 * exits 130, which is not the same outcome as a deliberate "no".
 */
const choose = (
	targets: ReadonlyArray<Target>,
	short: (target: Target) => string,
): Effect.Effect<ReadonlyArray<Target>, Cancelled | CliError.UserError, CliTheme> =>
	Effect.gen(function* () {
		const chosen = yield* CliUi.run(
			MultiSelect.screen({ message: "Delete which files?", sections: pickerSections(targets, short) }),
		);
		if (chosen.length === 0) return [];
		const { confirmed } = yield* CliUi.run(Confirm.screen({ message: `Delete ${plural(chosen.length)}?` }));
		return confirmed ? chosen : [];
	}).pipe(Effect.catchTag("NotInteractive", () => Effect.fail(refusal())));

/**
 * The invocation needed `--force`. A usage error, so exit 64.
 *
 * @remarks
 * A non-interactive run — a pipe, CI, an agent — is refused rather than
 * assumed: prompting there either hangs or reads whatever happens to be on
 * stdin, and proceeding because nobody was there to answer is the one failure
 * mode worth engineering against.
 */
const refusal = (): CliError.UserError =>
	new CliError.UserError({ cause: "Refusing: not an interactive terminal, and --force was not given." });

/**
 * `reposets nuke` — remove everything reposets has written locally.
 *
 * @remarks
 * **Nothing on GitHub is touched.** Every secret, variable, ruleset and setting
 * this tool has ever applied stays exactly where it is; this removes the local
 * files and the local database, which is what "leave no trace on this machine"
 * means.
 *
 * It always prints what it found first. Without `--force`, an interactive run
 * then offers the targets as a pre-selected checklist grouped project / user /
 * state, and asks "Delete N files?" defaulting to **no**; deselecting
 * everything or answering no deletes nothing and succeeds. A non-interactive
 * run without `--force` is refused (exit 64) — see {@link refusal}. Whether the
 * run may prompt is `CliInteractive`, decided once by `CliRuntime.main`'s
 * environment (a human audience on a terminal), not by probing stdin here.
 *
 * Each removal is reported as it happens; one that fails is logged on stderr
 * and the run exits 1 after every target has been tried.
 *
 * @public
 */
export const nukeHandler = (
	force: boolean,
): Effect.Effect<
	void,
	CliError.UserError | Cancelled,
	| FileSystem.FileSystem
	| Path.Path
	| AppDirs
	| Xdg
	| Invocation
	| CliExit
	| CliTheme
	| TerminalEnv
	| Audience
	| CliLinks
> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const appDirs = yield* AppDirs;
		const { cwd } = yield* Invocation;

		const found = yield* findTargets(fs, path, appDirs, cwd);

		if (found.length === 0) {
			yield* CliMessage.info("Nothing to remove — no reposets files found on this machine.");
			return;
		}

		yield* Doc.print(targetsDoc(found));

		let targets = found;
		if (!force) {
			if (!(yield* CliInteractive)) {
				return yield* Effect.fail(refusal());
			}
			const { home } = yield* Xdg;
			targets = yield* choose(found, (target) => shortPath(path, cwd, home, target));
			if (targets.length === 0) {
				yield* CliMessage.info("Nothing was deleted.");
				return;
			}
		}

		let removed = 0;
		for (const target of targets) {
			const outcome = yield* fs.remove(target.path).pipe(Effect.result);
			if (outcome._tag === "Failure") {
				yield* Effect.logError(`could not remove ${target.path} — ${String(outcome.failure)}`);
				continue;
			}
			removed += 1;
			yield* CliMessage.success(`removed ${target.path}`);
		}

		if (removed === targets.length) {
			yield* CliMessage.success(`Done. ${plural(removed)} removed.`);
		} else {
			// A file left behind is a real failure — the user asked for it gone —
			// so the run exits 1, after every target has been attempted and
			// reported.
			yield* CliMessage.failure(`Removed ${removed} of ${targets.length}; the failures are listed above.`);
			yield* CliExit.set(1);
		}
	});

/**
 * The `nuke` command.
 *
 * @public
 */
export const nukeCommand = Command.make("nuke", { force: forceFlag }, ({ force }) => nukeHandler(force)).pipe(
	Command.withDescription("Delete every reposets file on this machine. Nothing on GitHub is touched"),
);
