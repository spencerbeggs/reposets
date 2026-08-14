import { Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { syncHandler } from "./sync.js";

/**
 * `reposets drift` — report resources changed outside reposets, and change
 * nothing.
 *
 * @remarks
 * This is `sync --dry-run --no-cleanup --fail-on-drift` under a name that says
 * what it is for, and it is deliberately the *same* handler rather than a
 * second pipeline. Drift is decided by comparing three fingerprints — desired,
 * live, and last-applied — and that comparison happens inside the phases. A
 * separate read-only implementation would be a second copy of that decision,
 * free to disagree with the one that actually converges, which is the worst
 * possible outcome for a command whose entire job is to be believed.
 *
 * **It writes nothing, to GitHub or to the baseline.** Every phase gates its
 * writes on `dryRun`, and that includes recording the applied-state fingerprint
 * — so a drift check does not quietly accept the drift it just reported by
 * adopting the live state as the new baseline. The run does appear in
 * `reposets history`, flagged as a dry run.
 *
 * Cleanup is off because a resource the config never declared is not drift. It
 * is undeclared, which is a different question and one `sync` answers.
 *
 * Exits non-zero when drift is found, so it works as a CI gate without a flag.
 *
 * @public
 */
export const driftCommand = Command.make(
	"drift",
	{
		group: Flag.string("group").pipe(Flag.withDescription("Check only this group"), Flag.optional),
		repo: Flag.string("repo").pipe(Flag.withDescription("Check only this repository"), Flag.optional),
		debug: Flag.boolean("debug").pipe(
			Flag.withDescription("Show the applied and live fingerprints behind each drift report"),
		),
	},
	(input) =>
		syncHandler({
			dryRun: true,
			noCleanup: true,
			failOnDrift: true,
			group: Option.getOrUndefined(input.group),
			repo: Option.getOrUndefined(input.repo),
			only: [],
			skip: [],
			debug: input.debug,
		}),
).pipe(Command.withDescription("Report resources changed outside reposets, without changing anything"));
