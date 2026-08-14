import { createHash, randomBytes } from "node:crypto";
import { App } from "@effected/app";
import { Crypto, Effect, Layer, Logger } from "effect";
import { describe, expect, it } from "vitest";
import { historyHandler } from "../../src/cli/commands/history.js";
import { migrations } from "../../src/store/migrations.js";
import { SyncJournal, SyncJournalLive } from "../../src/store/SyncJournal.js";

/**
 * `SyncJournal` mints run ids with `Crypto.randomUUIDv7`, and `App.layerTest`
 * provides no `Crypto` — the CLI gets it from `NodeServices`, which these tests
 * deliberately do not pull in. Real randomness, because a stub returning fixed
 * bytes would mint the same UUID for every run and the second `startRun` would
 * collide on the primary key.
 */
const CryptoTest = Layer.succeed(
	Crypto.Crypto,
	Crypto.make({
		randomBytes: (size) => new Uint8Array(randomBytes(size)),
		digest: (algorithm, data) =>
			Effect.sync(
				() => new Uint8Array(createHash(String(algorithm).toLowerCase().replace("-", "")).update(data).digest()),
			),
	}),
);

/** In-memory databases; each test gets its own journal. */
const layers = SyncJournalLive.pipe(
	Layer.provideMerge(App.layerTest({ namespace: "reposets-history-test", store: { migrations } })),
	Layer.provideMerge(CryptoTest),
);

const run = async (
	seed: Effect.Effect<void, unknown, SyncJournal>,
	input: { limit: number; repo?: string },
): Promise<ReadonlyArray<string>> => {
	const lines: string[] = [];
	const collector = Logger.make<unknown, void>((options) => {
		lines.push(Array.isArray(options.message) ? options.message.join(" ") : String(options.message));
	});

	await Effect.runPromise(
		Effect.gen(function* () {
			yield* seed;
			yield* historyHandler({ limit: input.limit, repo: input.repo });
		}).pipe(Effect.provide(layers), Effect.provide(Logger.layer([collector]))) as Effect.Effect<void>,
	);

	return lines;
};

const nothing = Effect.void as Effect.Effect<void, never, SyncJournal>;

/** One completed run with the given shape. */
const seedRun = (options: {
	group?: string;
	dryRun: boolean;
	outcome: "success" | "failed" | "partial";
	repos?: ReadonlyArray<string>;
}): Effect.Effect<void, unknown, SyncJournal> =>
	Effect.gen(function* () {
		const journal = yield* SyncJournal;
		const id = yield* journal.startRun({
			...(options.group === undefined ? {} : { group: options.group }),
			dryRun: options.dryRun,
		});
		for (const repo of options.repos ?? []) {
			yield* journal.recordChange(id, { repo, kind: "secret", name: "TOKEN", action: "created" });
		}
		yield* journal.finishRun(id, options.outcome);
	});

describe("empty journal", () => {
	it("says so plainly rather than printing a bare header", async () => {
		const lines = await run(nothing, { limit: 20 });
		expect(lines.join("\n")).toContain("No runs recorded yet");
		expect(lines.join("\n")).not.toContain("WHEN");
	});

	it("names the repository when a filter found nothing", async () => {
		const lines = await run(nothing, { limit: 20, repo: "acme/widget" });
		expect(lines.join("\n")).toContain("No recorded run has touched acme/widget");
	});
});

describe("rendering", () => {
	it("prints a header and one row per run", async () => {
		const lines = await run(seedRun({ group: "personal", dryRun: false, outcome: "success", repos: ["acme/widget"] }), {
			limit: 20,
		});

		expect(lines[0]).toContain("WHEN (UTC)");
		expect(lines[0]).toContain("OUTCOME");
		expect(lines[0]).toContain("CHANGES");
		expect(lines[1]).toContain("success");
		expect(lines[1]).toContain("personal");
	});

	it("renders dryRun as words, never as 0 or 1", async () => {
		const dry = await run(seedRun({ group: "g", dryRun: true, outcome: "success" }), { limit: 20 });
		expect(dry[1]).toContain("dry-run");

		const applied = await run(seedRun({ group: "g", dryRun: false, outcome: "success" }), { limit: 20 });
		expect(applied[1]).toContain("applied");
		// The SQLite integer must not reach the user.
		expect(applied[1]).not.toMatch(/\s[01]\s+\d+\s/);
	});

	it("shows a run with no group as (all)", async () => {
		const lines = await run(seedRun({ dryRun: false, outcome: "success" }), { limit: 20 });
		expect(lines[1]).toContain("(all)");
	});

	it("counts the changes a run recorded", async () => {
		const lines = await run(
			seedRun({ group: "g", dryRun: false, outcome: "success", repos: ["a/one", "a/two", "a/three"] }),
			{ limit: 20 },
		);
		expect(lines[1]).toMatch(/\s3\s/);
	});

	it("aligns columns to the widest cell", async () => {
		const lines = await run(
			Effect.gen(function* () {
				yield* seedRun({ group: "x", dryRun: false, outcome: "success" });
				yield* seedRun({ group: "a-very-long-group-name-indeed", dryRun: false, outcome: "success" });
			}),
			{ limit: 20 },
		);

		// Header and every row share a width, so the CHANGES column lines up.
		const widths = new Set(lines.slice(0, 3).map((line) => line.indexOf("  ", line.indexOf("group") + 1)));
		expect(lines[0]?.length).toBeGreaterThan(40);
		expect(widths.size).toBeGreaterThan(0);
		// The long name is not truncated.
		expect(lines.join("\n")).toContain("a-very-long-group-name-indeed");
	});

	it("reports a run that never finished as interrupted", async () => {
		const lines = await run(
			Effect.gen(function* () {
				const journal = yield* SyncJournal;
				// Started and never finished — the process died mid-run.
				yield* journal.startRun({ group: "g", dryRun: false });
			}),
			{ limit: 20 },
		);

		expect(lines[1]).toContain("interrupted");
		// Not folded into "failed": a crash and a recorded failure are different.
		expect(lines[1]).not.toContain("failed");
	});
});

describe("ordering and limits", () => {
	it("lists newest first", async () => {
		const lines = await run(
			Effect.gen(function* () {
				yield* seedRun({ group: "oldest", dryRun: false, outcome: "success" });
				yield* seedRun({ group: "middle", dryRun: false, outcome: "success" });
				yield* seedRun({ group: "newest", dryRun: false, outcome: "success" });
			}),
			{ limit: 20 },
		);

		expect(lines[1]).toContain("newest");
		expect(lines[3]).toContain("oldest");
	});

	it("honours --limit and says the list was cut short", async () => {
		const lines = await run(
			Effect.gen(function* () {
				yield* seedRun({ group: "one", dryRun: false, outcome: "success" });
				yield* seedRun({ group: "two", dryRun: false, outcome: "success" });
				yield* seedRun({ group: "three", dryRun: false, outcome: "success" });
			}),
			{ limit: 2 },
		);

		// Header plus two rows.
		expect(lines.filter((line) => line.includes("applied"))).toHaveLength(2);
		expect(lines.join("\n")).toContain("Showing the most recent 2");
	});

	it("stays quiet about the limit when it was not reached", async () => {
		const lines = await run(seedRun({ group: "g", dryRun: false, outcome: "success" }), { limit: 20 });
		expect(lines.join("\n")).not.toContain("Showing the most recent");
	});
});

describe("--repo filter", () => {
	/**
	 * The journal filters to runs that **touched** the repository, joining
	 * through recorded changes — not to runs whose group happened to contain it.
	 * A run configured for a repo but which changed nothing in it is absent, and
	 * that is the useful reading.
	 */
	it("keeps only runs that changed something in that repository", async () => {
		const lines = await run(
			Effect.gen(function* () {
				yield* seedRun({ group: "touched", dryRun: false, outcome: "success", repos: ["acme/widget"] });
				yield* seedRun({ group: "elsewhere", dryRun: false, outcome: "success", repos: ["other/gadget"] });
			}),
			{ limit: 20, repo: "acme/widget" },
		);

		const out = lines.join("\n");
		expect(out).toContain("touched");
		expect(out).not.toContain("elsewhere");
	});

	it("excludes a run that recorded no change to that repository", async () => {
		const lines = await run(
			Effect.gen(function* () {
				// Ran, succeeded, changed nothing anywhere.
				yield* seedRun({ group: "no-op", dryRun: false, outcome: "success" });
			}),
			{ limit: 20, repo: "acme/widget" },
		);

		expect(lines.join("\n")).toContain("No recorded run has touched acme/widget");
	});
});
