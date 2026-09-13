import { NodeServices } from "@effect/platform-node";
import { Effect, Option } from "effect";
import { Command } from "effect/unstable/cli";
import { describe, expect, it } from "vitest";
import { driftCommand } from "../../src/cli/commands/drift.js";
import { historyCommand } from "../../src/cli/commands/history.js";
import { initCommand } from "../../src/cli/commands/init.js";
import { nukeCommand } from "../../src/cli/commands/nuke.js";
import { syncCommand } from "../../src/cli/commands/sync.js";

/**
 * The one parser fact this repo owns: what each command receives when a flag
 * is omitted. Since rc.115 a `Flag.Boolean` with no `Flag.withDefault(false)`
 * is a *required* flag — `reposets sync` printed help and exited 0 instead of
 * syncing, and no handler test could see it because the handlers were only
 * ever called directly. Each command here has its handler swapped for one that
 * records the parsed input, then is run with the bare argv a user types.
 */
const parse = <Name extends string, Input>(
	command: Command.Command<Name, Input, unknown, unknown, unknown>,
	argv: ReadonlyArray<string>,
) =>
	Effect.gen(function* () {
		let received: Input | undefined;
		const capturing = Command.withHandler(command, (input: Input) =>
			Effect.sync(() => {
				received = input;
			}),
		);
		yield* Command.runWith(capturing, { version: "0.0.0-test" })(argv);
		return received;
	}).pipe(Effect.provide(NodeServices.layer), Effect.runPromise);

describe("flags omitted from argv", () => {
	it("sync runs with every flag at its default", async () => {
		const input = await parse(syncCommand, []);
		expect(input).toEqual({
			dryRun: false,
			noCleanup: false,
			failOnDrift: false,
			group: Option.none(),
			repo: Option.none(),
			only: [],
			skip: [],
			debug: false,
		});
	});

	it("sync reads every flag it declares", async () => {
		const input = await parse(syncCommand, [
			"--dry-run",
			"--no-cleanup",
			"--fail-on-drift",
			"--group",
			"g",
			"--repo",
			"r",
			"--only",
			"secrets",
			"--only",
			"variables",
			"--skip",
			"cleanup",
			"--debug",
		]);
		expect(input).toEqual({
			dryRun: true,
			noCleanup: true,
			failOnDrift: true,
			group: Option.some("g"),
			repo: Option.some("r"),
			only: ["secrets", "variables"],
			skip: ["cleanup"],
			debug: true,
		});
	});

	it("drift runs with every flag at its default", async () => {
		expect(await parse(driftCommand, [])).toEqual({ group: Option.none(), repo: Option.none(), debug: false });
	});

	it("init does not require --project", async () => {
		expect(await parse(initCommand, [])).toEqual({ project: false });
	});

	it("nuke does not require --force", async () => {
		expect(await parse(nukeCommand, [])).toEqual({ force: false });
	});

	it("history defaults its limit and leaves the repo filter empty", async () => {
		expect(await parse(historyCommand, [])).toEqual({ limit: 20, repo: Option.none() });
	});
});
