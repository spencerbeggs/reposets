import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import type { Config } from "../../src/schemas/config.js";
import type { Credentials } from "../../src/schemas/credentials.js";
import { GitHubClientTest } from "../../src/services/GitHubClient.js";
import { OnePasswordClientTest } from "../../src/services/OnePasswordClient.js";
import { SyncEngine, SyncEngineLive } from "../../src/services/SyncEngine.js";
import { ValueResolverLive } from "../../src/services/ValueResolver.js";

function makeTestConfig(overrides: Partial<Config> = {}): Config {
	return {
		owner: "testowner",
		settings: {},
		secrets: {
			deploy: {
				NPM_TOKEN: { value: "npm-secret" },
			},
		},
		variables: {
			common: {
				NODE_ENV: { value: "production" },
			},
		},
		rulesets: {},
		cleanup: {
			secrets: false,
			variables: false,
			dependabot_secrets: false,
			codespaces_secrets: false,
			rulesets: false,
			preserve: { secrets: [], variables: [], dependabot_secrets: [], codespaces_secrets: [], rulesets: [] },
		},
		repos: {
			mygroup: {
				names: ["repo-one"],
				secrets: { actions: ["deploy"] },
				variables: { actions: ["common"] },
			},
		},
		...overrides,
	};
}

function makeTestCredentials(): Credentials {
	return {
		profiles: {
			default: { github_token: "ghp_test" },
		},
	};
}

function buildTestLayer() {
	const recorder = GitHubClientTest();
	const opStubs = OnePasswordClientTest({});
	const resolverLayer = Layer.provide(ValueResolverLive, opStubs);
	const testLayer = Layer.provideMerge(SyncEngineLive, Layer.merge(recorder.layer, resolverLayer));
	return { testLayer, recorder };
}

describe("SyncEngine", () => {
	it("syncs secrets and variables to repos in a group", async () => {
		const { testLayer, recorder } = buildTestLayer();
		const config = makeTestConfig();
		const creds = makeTestCredentials();

		const program = Effect.gen(function* () {
			const engine = yield* SyncEngine;
			return yield* engine.syncAll(config, creds, { dryRun: false, noCleanup: false });
		}).pipe(Effect.provide(testLayer));

		await Effect.runPromise(program);

		const calls = recorder.calls();
		expect(calls).toContainEqual(
			expect.objectContaining({
				method: "syncSecret",
				args: expect.objectContaining({ name: "NPM_TOKEN", scope: "actions" }),
			}),
		);
		expect(calls).toContainEqual(
			expect.objectContaining({
				method: "syncVariable",
				args: expect.objectContaining({ name: "NODE_ENV" }),
			}),
		);
	});

	it("skips mutations in dry-run mode", async () => {
		const { testLayer, recorder } = buildTestLayer();
		const config = makeTestConfig();
		const creds = makeTestCredentials();

		const program = Effect.gen(function* () {
			const engine = yield* SyncEngine;
			return yield* engine.syncAll(config, creds, { dryRun: true, noCleanup: false });
		}).pipe(Effect.provide(testLayer));

		await Effect.runPromise(program);

		const calls = recorder.calls();
		expect(calls.filter((c) => c.method.startsWith("sync"))).toHaveLength(0);
	});

	it("uses owner override from repo group", async () => {
		const { testLayer, recorder } = buildTestLayer();
		const config = makeTestConfig({
			repos: {
				mygroup: {
					owner: "custom-owner",
					names: ["repo-one"],
					secrets: { actions: ["deploy"] },
				},
			},
		});
		const creds = makeTestCredentials();

		const program = Effect.gen(function* () {
			const engine = yield* SyncEngine;
			return yield* engine.syncAll(config, creds, { dryRun: false, noCleanup: false });
		}).pipe(Effect.provide(testLayer));

		await Effect.runPromise(program);

		const calls = recorder.calls();
		expect(calls[0].args.owner).toBe("custom-owner");
	});
});
