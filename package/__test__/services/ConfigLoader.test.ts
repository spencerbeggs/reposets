import { Effect } from "effect";
import { stringify } from "smol-toml";
import { describe, expect, it } from "vitest";
import { ConfigLoader, ConfigLoaderLive } from "../../src/services/ConfigLoader.js";

describe("ConfigLoader", () => {
	const testLayer = ConfigLoaderLive;

	it("loads valid config TOML", async () => {
		const toml = stringify({
			owner: "spencerbeggs",
			repos: {
				mygroup: { names: ["repo-one"] },
			},
		});

		const program = Effect.gen(function* () {
			const loader = yield* ConfigLoader;
			return yield* loader.parseConfig(toml);
		}).pipe(Effect.provide(testLayer));

		const result = await Effect.runPromise(program);
		expect(result.owner).toBe("spencerbeggs");
		expect(result.repos.mygroup.names).toEqual(["repo-one"]);
	});

	it("returns ConfigError for invalid TOML", async () => {
		const program = Effect.gen(function* () {
			const loader = yield* ConfigLoader;
			return yield* loader.parseConfig("invalid = [broken toml");
		}).pipe(Effect.provide(testLayer));

		const exit = await Effect.runPromiseExit(program);
		expect(exit._tag).toBe("Failure");
	});

	it("returns ConfigError for valid TOML that fails schema", async () => {
		const toml = stringify({ owner: 123 });

		const program = Effect.gen(function* () {
			const loader = yield* ConfigLoader;
			return yield* loader.parseConfig(toml);
		}).pipe(Effect.provide(testLayer));

		const exit = await Effect.runPromiseExit(program);
		expect(exit._tag).toBe("Failure");
	});

	it("loads valid credentials TOML", async () => {
		const toml = stringify({
			profiles: {
				personal: { github_token: "ghp_abc" },
			},
		});

		const program = Effect.gen(function* () {
			const loader = yield* ConfigLoader;
			return yield* loader.parseCredentials(toml);
		}).pipe(Effect.provide(testLayer));

		const result = await Effect.runPromise(program);
		expect(result.profiles.personal.github_token).toBe("ghp_abc");
	});

	it("returns empty profiles for empty credentials", async () => {
		const program = Effect.gen(function* () {
			const loader = yield* ConfigLoader;
			return yield* loader.parseCredentials("");
		}).pipe(Effect.provide(testLayer));

		const result = await Effect.runPromise(program);
		expect(result.profiles).toEqual({});
	});
});
