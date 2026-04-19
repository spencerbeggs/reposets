import { Effect, Layer, Ref } from "effect";
import { describe, expect, it } from "vitest";
import type { Config } from "../../src/schemas/config.js";
import type { Credentials } from "../../src/schemas/credentials.js";
import { CredentialResolverLive } from "../../src/services/CredentialResolver.js";
import { GitHubClientTest } from "../../src/services/GitHubClient.js";
import { OnePasswordClientTest } from "../../src/services/OnePasswordClient.js";
import { SyncEngine, SyncEngineLive } from "../../src/services/SyncEngine.js";
import { SyncLoggerLive } from "../../src/services/SyncLogger.js";

function makeTestConfig(overrides: Partial<Config> = {}): Config {
	return {
		owner: "testowner",
		log_level: "info",
		settings: {},
		secrets: {
			deploy: { value: { NPM_TOKEN: "npm-secret" } },
		},
		variables: {
			common: { value: { NODE_ENV: "production" } },
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
		groups: {
			mygroup: {
				repos: ["repo-one"],
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
	const credResolverLayer = Layer.provide(CredentialResolverLive, opStubs);
	const loggerLayer = SyncLoggerLive({ dryRun: false, logLevel: "silent" });
	const testLayer = Layer.provideMerge(
		SyncEngineLive,
		Layer.merge(Layer.merge(recorder.layer, credResolverLayer), loggerLayer),
	);
	return { testLayer, recorder };
}

describe("SyncEngine", () => {
	it("syncs secrets and variables to repos in a group", async () => {
		const { testLayer, recorder } = buildTestLayer();
		const config = makeTestConfig();
		const creds = makeTestCredentials();

		const program = Effect.gen(function* () {
			const engine = yield* SyncEngine;
			return yield* engine.syncAll(config, creds, { dryRun: false, noCleanup: false, configDir: process.cwd() });
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
			return yield* engine.syncAll(config, creds, { dryRun: true, noCleanup: false, configDir: process.cwd() });
		}).pipe(Effect.provide(testLayer));

		await Effect.runPromise(program);

		const calls = recorder.calls();
		expect(calls.filter((c) => c.method.startsWith("sync"))).toHaveLength(0);
	});

	it("uses owner override from repo group", async () => {
		const { testLayer, recorder } = buildTestLayer();
		const config = makeTestConfig({
			groups: {
				mygroup: {
					owner: "custom-owner",
					repos: ["repo-one"],
					secrets: { actions: ["deploy"] },
				},
			},
		});
		const creds = makeTestCredentials();

		const program = Effect.gen(function* () {
			const engine = yield* SyncEngine;
			return yield* engine.syncAll(config, creds, { dryRun: false, noCleanup: false, configDir: process.cwd() });
		}).pipe(Effect.provide(testLayer));

		await Effect.runPromise(program);

		const calls = recorder.calls();
		expect(calls[0].args.owner).toBe("custom-owner");
	});

	it("emits sync summary at info level", async () => {
		const recorder = GitHubClientTest();
		const opStubs = OnePasswordClientTest({});
		const credResolverLayer = Layer.provide(CredentialResolverLive, opStubs);
		const output = Ref.unsafeMake<string[]>([]);
		const loggerLayer = SyncLoggerLive({ dryRun: false, logLevel: "info", output });
		const testLayer = Layer.provideMerge(
			SyncEngineLive,
			Layer.merge(Layer.merge(recorder.layer, credResolverLayer), loggerLayer),
		);

		const config = makeTestConfig();
		const creds = makeTestCredentials();

		const program = Effect.gen(function* () {
			const engine = yield* SyncEngine;
			yield* engine.syncAll(config, creds, { dryRun: false, noCleanup: false, configDir: process.cwd() });
			return yield* Ref.get(output);
		}).pipe(Effect.provide(testLayer));

		const lines = await Effect.runPromise(program);
		expect(lines).toContainEqual(expect.stringContaining("group: mygroup"));
		expect(lines).toContainEqual(expect.stringContaining("repo: testowner/repo-one"));
		expect(lines).toContainEqual(expect.stringContaining("synced"));
		expect(lines).toContainEqual(expect.stringContaining("Sync complete!"));
	});
});
