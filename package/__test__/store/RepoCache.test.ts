import { App } from "@effected/app";
import { Cache } from "@effected/store";
import { DateTime, Duration, Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";
import { RepoCache, RepoCacheLive } from "../../src/store/RepoCache.js";

/**
 * `App.layerTest` gives `:memory:` databases with `R = never`, so these run
 * with no filesystem and no temp directories.
 */
const AppTest = App.layerTest({ namespace: "reposets-repocache-test" });

/** `RepoCache` plus the ambient `Cache` the assertions read through. */
const layers = Layer.provideMerge(RepoCacheLive, AppTest);

const run = <A>(program: Effect.Effect<A, unknown, RepoCache | Cache>): Promise<A> =>
	Effect.runPromise(program.pipe(Effect.provide(layers)) as Effect.Effect<A>);

/** A fetch that counts how many times it actually ran. */
const counted = <A>(counter: { n: number }, value: A): Effect.Effect<A> =>
	Effect.sync(() => {
		counter.n += 1;
		return value;
	});

describe("key shapes", () => {
	/**
	 * A wrong key is the worst failure mode this service has: it caches under a
	 * name nothing reads, so every lookup misses forever and the symptom is "the
	 * cache does nothing" rather than an error. Nothing else in the codebase
	 * pins these strings.
	 */
	it("writes team ids under team:{org}/{slug}", async () => {
		const entries = await run(
			Effect.gen(function* () {
				const repoCache = yield* RepoCache;
				yield* repoCache.teamId("acme", "platform", Effect.succeed(42));
				const cache = yield* Cache;
				return yield* cache.entries;
			}),
		);

		expect(entries.map((entry) => entry.key)).toEqual(["team:acme/platform"]);
		expect(entries[0]?.tags).toEqual(["team"]);
	});

	it("writes owner types under owner:{owner}", async () => {
		const entries = await run(
			Effect.gen(function* () {
				const repoCache = yield* RepoCache;
				yield* repoCache.ownerType("acme", Effect.succeed("Organization" as const));
				const cache = yield* Cache;
				return yield* cache.entries;
			}),
		);

		expect(entries.map((entry) => entry.key)).toEqual(["owner:acme"]);
		expect(entries[0]?.tags).toEqual(["owner"]);
	});

	it("writes languages under langs:{owner}/{repo}", async () => {
		const entries = await run(
			Effect.gen(function* () {
				const repoCache = yield* RepoCache;
				yield* repoCache.repoLanguages("acme", "widget", Effect.succeed(["Go"]));
				const cache = yield* Cache;
				return yield* cache.entries;
			}),
		);

		expect(entries.map((entry) => entry.key)).toEqual(["langs:acme/widget"]);
		expect(entries[0]?.tags).toEqual(["langs"]);
	});

	it("keeps the three namespaces from colliding on the same name", async () => {
		const keys = await run(
			Effect.gen(function* () {
				const repoCache = yield* RepoCache;
				// Same string in all three positions — only the key prefix keeps
				// these apart.
				yield* repoCache.ownerType("acme", Effect.succeed("User" as const));
				yield* repoCache.teamId("acme", "acme", Effect.succeed(1));
				yield* repoCache.repoLanguages("acme", "acme", Effect.succeed(["Go"]));
				const cache = yield* Cache;
				return (yield* cache.entries).map((entry) => entry.key).sort();
			}),
		);

		expect(keys).toEqual(["langs:acme/acme", "owner:acme", "team:acme/acme"]);
	});

	it("distinguishes different slugs under the same org", async () => {
		const keys = await run(
			Effect.gen(function* () {
				const repoCache = yield* RepoCache;
				yield* repoCache.teamId("acme", "platform", Effect.succeed(1));
				yield* repoCache.teamId("acme", "security", Effect.succeed(2));
				const cache = yield* Cache;
				return (yield* cache.entries).map((entry) => entry.key).sort();
			}),
		);

		expect(keys).toEqual(["team:acme/platform", "team:acme/security"]);
	});
});

describe("read-through", () => {
	/**
	 * The second call passes a *different* value, so a hit is distinguishable by
	 * what comes back rather than only by a counter — a broken cache that
	 * re-fetched would return the second value and a counter-only assertion
	 * could still be written to pass.
	 */
	it("populates on a miss and serves the cached value afterwards", async () => {
		const result = await run(
			Effect.gen(function* () {
				const repoCache = yield* RepoCache;
				const fetches = { n: 0 };
				const first = yield* repoCache.teamId("acme", "platform", counted(fetches, 4242));
				const second = yield* repoCache.teamId("acme", "platform", counted(fetches, -1));
				return { first, second, fetches: fetches.n };
			}),
		);

		expect(result).toEqual({ first: 4242, second: 4242, fetches: 1 });
	});

	it("caches owner types by value, not by re-fetching", async () => {
		const result = await run(
			Effect.gen(function* () {
				const repoCache = yield* RepoCache;
				const fetches = { n: 0 };
				const first = yield* repoCache.ownerType("acme", counted(fetches, "Organization" as const));
				const second = yield* repoCache.ownerType("acme", counted(fetches, "User" as const));
				return { first, second, fetches: fetches.n };
			}),
		);

		expect(result).toEqual({ first: "Organization", second: "Organization", fetches: 1 });
	});

	it("caches language lists by value, not by re-fetching", async () => {
		const result = await run(
			Effect.gen(function* () {
				const repoCache = yield* RepoCache;
				const fetches = { n: 0 };
				const first = yield* repoCache.repoLanguages("acme", "widget", counted(fetches, ["TypeScript", "Go"]));
				const second = yield* repoCache.repoLanguages("acme", "widget", counted(fetches, ["Cobol"]));
				return { first, second, fetches: fetches.n };
			}),
		);

		expect(result).toEqual({ first: ["TypeScript", "Go"], second: ["TypeScript", "Go"], fetches: 1 });
	});

	it("does not serve one repository's languages for another", async () => {
		const result = await run(
			Effect.gen(function* () {
				const repoCache = yield* RepoCache;
				const fetches = { n: 0 };
				const widget = yield* repoCache.repoLanguages("acme", "widget", counted(fetches, ["Go"]));
				const gadget = yield* repoCache.repoLanguages("acme", "gadget", counted(fetches, ["Rust"]));
				return { widget, gadget, fetches: fetches.n };
			}),
		);

		expect(result).toEqual({ widget: ["Go"], gadget: ["Rust"], fetches: 2 });
	});

	it("round-trips a value through the byte encoding unchanged", async () => {
		const languages = await run(
			Effect.gen(function* () {
				const repoCache = yield* RepoCache;
				// Non-ASCII and punctuation, to catch an encoding that only works
				// for plain identifiers.
				const stored = ["C++", "F#", "Objective-C", "Jupyter Notebook"];
				yield* repoCache.repoLanguages("acme", "widget", Effect.succeed(stored));
				return yield* repoCache.repoLanguages("acme", "widget", Effect.die("must not re-fetch"));
			}),
		);

		expect(languages).toEqual(["C++", "F#", "Objective-C", "Jupyter Notebook"]);
	});
});

describe("TTL policy", () => {
	/** How long an entry was given to live, from its own recorded timestamps. */
	const lifetime = (entry: { readonly created: DateTime.Utc; readonly expiresAt?: DateTime.Utc }): number => {
		if (entry.expiresAt === undefined) throw new Error(`entry has no expiry`);
		return DateTime.toEpochMillis(entry.expiresAt) - DateTime.toEpochMillis(entry.created);
	};

	/**
	 * Transposing these is silent and expensive in one direction: a 30-day
	 * languages TTL would under-configure CodeQL for a month on any repository
	 * that gained a language. Asserting the recorded expiry catches it without a
	 * clock.
	 */
	it("gives team ids and owner types the long TTL, and languages the short one", async () => {
		const byKey = await run(
			Effect.gen(function* () {
				const repoCache = yield* RepoCache;
				yield* repoCache.teamId("acme", "platform", Effect.succeed(1));
				yield* repoCache.ownerType("acme", Effect.succeed("User" as const));
				yield* repoCache.repoLanguages("acme", "widget", Effect.succeed(["Go"]));
				const cache = yield* Cache;
				const entries = yield* cache.entries;
				return new Map(entries.map((entry) => [entry.key, lifetime(entry)] as const));
			}),
		);

		expect(byKey.get("team:acme/platform")).toBe(Duration.toMillis(Duration.days(30)));
		expect(byKey.get("owner:acme")).toBe(Duration.toMillis(Duration.days(30)));
		expect(byKey.get("langs:acme/widget")).toBe(Duration.toMillis(Duration.minutes(10)));
	});

	it("holds languages for very much less time than identities", async () => {
		const byKey = await run(
			Effect.gen(function* () {
				const repoCache = yield* RepoCache;
				yield* repoCache.teamId("acme", "platform", Effect.succeed(1));
				yield* repoCache.repoLanguages("acme", "widget", Effect.succeed(["Go"]));
				const cache = yield* Cache;
				const entries = yield* cache.entries;
				return new Map(entries.map((entry) => [entry.key, lifetime(entry)] as const));
			}),
		);

		const team = byKey.get("team:acme/platform") ?? 0;
		const langs = byKey.get("langs:acme/widget") ?? 0;
		// The direction of the inequality is the whole assertion.
		expect(langs).toBeLessThan(team);
	});
});

describe("expiry", () => {
	/**
	 * `TestClock.layer()` is provided **outside** the App layer on purpose: the
	 * cache reads the clock during layer construction as well as on every read,
	 * and providing the test clock beneath the databases makes `TestClock.adjust`
	 * die rather than advance.
	 */
	const runWithTestClock = <A>(program: Effect.Effect<A, unknown, RepoCache | Cache>): Promise<A> =>
		Effect.runPromise(program.pipe(Effect.provide(layers), Effect.provide(TestClock.layer())) as Effect.Effect<A>);

	it("re-fetches languages once the short TTL has passed", async () => {
		const result = await runWithTestClock(
			Effect.gen(function* () {
				const repoCache = yield* RepoCache;
				const fetches = { n: 0 };

				const fresh = yield* repoCache.repoLanguages("acme", "widget", counted(fetches, ["Rust"]));

				yield* TestClock.adjust("9 minutes");
				const stillLive = yield* repoCache.repoLanguages("acme", "widget", counted(fetches, ["Zig"]));

				yield* TestClock.adjust("2 minutes");
				const afterExpiry = yield* repoCache.repoLanguages("acme", "widget", counted(fetches, ["Zig"]));

				return { fresh, stillLive, afterExpiry, fetches: fetches.n };
			}),
		);

		expect(result).toEqual({
			fresh: ["Rust"],
			stillLive: ["Rust"],
			afterExpiry: ["Zig"],
			fetches: 2,
		});
	});

	it("keeps team ids well past the languages TTL", async () => {
		const result = await runWithTestClock(
			Effect.gen(function* () {
				const repoCache = yield* RepoCache;
				const fetches = { n: 0 };
				yield* repoCache.teamId("acme", "platform", counted(fetches, 4242));
				// Long past the 10-minute languages TTL, nowhere near 30 days.
				yield* TestClock.adjust("2 hours");
				const later = yield* repoCache.teamId("acme", "platform", counted(fetches, -1));
				return { later, fetches: fetches.n };
			}),
		);

		expect(result).toEqual({ later: 4242, fetches: 1 });
	});
});

describe("decode drift", () => {
	it("treats an entry that no longer decodes as a miss and overwrites it", async () => {
		const result = await run(
			Effect.gen(function* () {
				const cache = yield* Cache;
				// What an older version might plausibly have stored for languages:
				// an object of byte counts rather than an array of names.
				yield* cache.set({
					key: "langs:acme/legacy",
					value: new TextEncoder().encode(`{"TypeScript":1200}`),
					contentType: "application/json",
					tags: ["langs"],
				});

				const repoCache = yield* RepoCache;
				const fetches = { n: 0 };
				const first = yield* repoCache.repoLanguages("acme", "legacy", counted(fetches, ["TypeScript"]));
				const second = yield* repoCache.repoLanguages("acme", "legacy", counted(fetches, ["Cobol"]));
				return { first, second, fetches: fetches.n };
			}),
		);

		// One fetch: the undecodable entry was a miss, and the rewrite then hit.
		expect(result).toEqual({ first: ["TypeScript"], second: ["TypeScript"], fetches: 1 });
	});
});
