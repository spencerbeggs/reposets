import { Effect, Layer, Ref } from "effect";
import { describe, expect, it } from "vitest";
import type { CleanupScope } from "../../src/schemas/common.js";
import type { Config } from "../../src/schemas/config.js";
import type { Credentials } from "../../src/schemas/credentials.js";
import { CredentialResolverLive } from "../../src/services/CredentialResolver.js";
import { GitHubClient, GitHubClientTest } from "../../src/services/GitHubClient.js";
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
		environments: {},
		security: {},
		code_scanning: {},
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

	it("syncs environments before secrets", async () => {
		const { testLayer, recorder } = buildTestLayer();
		const config = makeTestConfig({
			environments: {
				staging: { wait_timer: 0 },
			},
			secrets: {
				deploy: { value: { NPM_TOKEN: "npm-secret" } },
				env_secrets: { value: { DB_URL: "postgres://localhost" } },
			},
			groups: {
				mygroup: {
					repos: ["repo-one"],
					environments: ["staging"],
					secrets: {
						actions: ["deploy"],
						environments: { staging: ["env_secrets"] },
					},
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
		const envSyncIndex = calls.findIndex((c) => c.method === "syncEnvironment");
		const secretSyncIndex = calls.findIndex((c) => c.method === "syncSecret");
		const envSecretSyncIndex = calls.findIndex((c) => c.method === "syncEnvironmentSecret");

		expect(envSyncIndex).toBeGreaterThanOrEqual(0);
		expect(secretSyncIndex).toBeGreaterThanOrEqual(0);
		expect(envSecretSyncIndex).toBeGreaterThanOrEqual(0);

		// Environments are synced before repo-level secrets
		expect(envSyncIndex).toBeLessThan(secretSyncIndex);
		// Environments are synced before environment secrets
		expect(envSyncIndex).toBeLessThan(envSecretSyncIndex);
	});

	it("syncs environment-scoped secrets", async () => {
		const { testLayer, recorder } = buildTestLayer();
		const config = makeTestConfig({
			environments: {
				production: {},
			},
			secrets: {
				prod_secrets: { value: { API_KEY: "secret-key", DB_PASSWORD: "db-pass" } },
			},
			groups: {
				mygroup: {
					repos: ["repo-one"],
					environments: ["production"],
					secrets: {
						environments: { production: ["prod_secrets"] },
					},
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
		expect(calls).toContainEqual(
			expect.objectContaining({
				method: "syncEnvironmentSecret",
				args: expect.objectContaining({ envName: "production", name: "API_KEY" }),
			}),
		);
		expect(calls).toContainEqual(
			expect.objectContaining({
				method: "syncEnvironmentSecret",
				args: expect.objectContaining({ envName: "production", name: "DB_PASSWORD" }),
			}),
		);
	});

	it("syncs environment-scoped variables", async () => {
		const { testLayer, recorder } = buildTestLayer();
		const config = makeTestConfig({
			environments: {
				staging: {},
			},
			variables: {
				common: { value: { NODE_ENV: "production" } },
				staging_vars: { value: { LOG_LEVEL: "debug", REGION: "us-east-1" } },
			},
			groups: {
				mygroup: {
					repos: ["repo-one"],
					environments: ["staging"],
					variables: {
						actions: ["common"],
						environments: { staging: ["staging_vars"] },
					},
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
		expect(calls).toContainEqual(
			expect.objectContaining({
				method: "syncEnvironmentVariable",
				args: expect.objectContaining({ envName: "staging", name: "LOG_LEVEL" }),
			}),
		);
		expect(calls).toContainEqual(
			expect.objectContaining({
				method: "syncEnvironmentVariable",
				args: expect.objectContaining({ envName: "staging", name: "REGION" }),
			}),
		);
	});

	it("uses per-group cleanup (no global cleanup merge)", async () => {
		const { testLayer, recorder } = buildTestLayer();
		const config = makeTestConfig({
			secrets: {
				deploy: { value: { NPM_TOKEN: "npm-secret" } },
			},
			groups: {
				mygroup: {
					repos: ["repo-one"],
					secrets: { actions: ["deploy"] },
					cleanup: {
						secrets: { actions: true, dependabot: false, codespaces: false, environments: false },
						variables: { actions: false, environments: false },
						rulesets: false,
						environments: false,
					},
				},
			},
		});
		const creds = makeTestCredentials();

		const program = Effect.gen(function* () {
			const engine = yield* SyncEngine;
			return yield* engine.syncAll(config, creds, { dryRun: false, noCleanup: false, configDir: process.cwd() });
		}).pipe(Effect.provide(testLayer));

		await Effect.runPromise(program);

		// The test recorder returns empty lists so no deletions happen,
		// but the fact that it ran without errors validates the cleanup path
		const calls = recorder.calls();
		expect(calls).toContainEqual(
			expect.objectContaining({
				method: "syncSecret",
				args: expect.objectContaining({ name: "NPM_TOKEN" }),
			}),
		);
	});

	it("three-way cleanup works with preserve list", async () => {
		const existingSecrets = [{ name: "NPM_TOKEN" }, { name: "LEGACY_KEY" }, { name: "OLD_SECRET" }];

		// Track deletions for assertions
		const deleted: string[] = [];
		const trackingGithubLayer = Layer.succeed(GitHubClient, {
			getOwnerType: () => Effect.succeed("User" as const),
			syncSecret: () => Effect.void,
			syncVariable: () => Effect.void,
			syncSettings: () => Effect.void,
			syncRuleset: () => Effect.void,
			listSecrets: () => Effect.succeed(existingSecrets),
			listVariables: () => Effect.succeed([]),
			listRulesets: () => Effect.succeed([]),
			deleteSecret(_owner, _repo, name, _scope) {
				deleted.push(name);
				return Effect.void;
			},
			deleteVariable: () => Effect.void,
			deleteRuleset: () => Effect.void,
			syncEnvironment: () => Effect.void,
			syncEnvironmentSecret: () => Effect.void,
			syncEnvironmentVariable: () => Effect.void,
			listEnvironments: () => Effect.succeed([]),
			listEnvironmentSecrets: () => Effect.succeed([]),
			listEnvironmentVariables: () => Effect.succeed([]),
			deleteEnvironment: () => Effect.void,
			deleteEnvironmentSecret: () => Effect.void,
			deleteEnvironmentVariable: () => Effect.void,
			getVulnerabilityAlerts: () => Effect.succeed(false),
			setVulnerabilityAlerts: () => Effect.void,
			getAutomatedSecurityFixes: () => Effect.succeed(false),
			setAutomatedSecurityFixes: () => Effect.void,
			getPrivateVulnerabilityReporting: () => Effect.succeed(false),
			setPrivateVulnerabilityReporting: () => Effect.void,
			getCodeScanningDefaultSetup: () => Effect.succeed({}),
			updateCodeScanningDefaultSetup: () => Effect.void,
			listRepoLanguages: () => Effect.succeed([]),
			resolveTeamId: () => Effect.succeed(0),
		});

		const opStubs = OnePasswordClientTest({});
		const credResolverLayer = Layer.provide(CredentialResolverLive, opStubs);
		const loggerLayer = SyncLoggerLive({ dryRun: false, logLevel: "silent" });
		const testLayer = Layer.provideMerge(
			SyncEngineLive,
			Layer.merge(Layer.merge(trackingGithubLayer, credResolverLayer), loggerLayer),
		);

		const config = makeTestConfig({
			secrets: {
				deploy: { value: { NPM_TOKEN: "npm-secret" } },
			},
			groups: {
				mygroup: {
					repos: ["repo-one"],
					secrets: { actions: ["deploy"] },
					cleanup: {
						secrets: {
							actions: { preserve: ["LEGACY_KEY"] } as CleanupScope,
							dependabot: false,
							codespaces: false,
							environments: false,
						},
						variables: { actions: false, environments: false },
						rulesets: false,
						environments: false,
					},
				},
			},
		});
		const creds = makeTestCredentials();

		const program = Effect.gen(function* () {
			const engine = yield* SyncEngine;
			return yield* engine.syncAll(config, creds, { dryRun: false, noCleanup: false, configDir: process.cwd() });
		}).pipe(Effect.provide(testLayer));

		await Effect.runPromise(program);

		// NPM_TOKEN is configured, so not deleted
		// LEGACY_KEY is in the preserve list, so not deleted
		// OLD_SECRET is not configured and not preserved, so it should be deleted
		expect(deleted).toContain("OLD_SECRET");
		expect(deleted).not.toContain("NPM_TOKEN");
		expect(deleted).not.toContain("LEGACY_KEY");
	});

	it("cleanup environments deletes unconfigured environments", async () => {
		const existingEnvs = [{ name: "staging" }, { name: "production" }, { name: "old-env" }];
		const deleted: string[] = [];

		const trackingGithubLayer = Layer.succeed(GitHubClient, {
			getOwnerType: () => Effect.succeed("User" as const),
			syncSecret: () => Effect.void,
			syncVariable: () => Effect.void,
			syncSettings: () => Effect.void,
			syncRuleset: () => Effect.void,
			syncEnvironment: () => Effect.void,
			syncEnvironmentSecret: () => Effect.void,
			syncEnvironmentVariable: () => Effect.void,
			listSecrets: () => Effect.succeed([]),
			listVariables: () => Effect.succeed([]),
			listRulesets: () => Effect.succeed([]),
			listEnvironments: () => Effect.succeed(existingEnvs),
			listEnvironmentSecrets: () => Effect.succeed([]),
			listEnvironmentVariables: () => Effect.succeed([]),
			deleteSecret: () => Effect.void,
			deleteVariable: () => Effect.void,
			deleteRuleset: () => Effect.void,
			deleteEnvironment(_owner, _repo, name) {
				deleted.push(name);
				return Effect.void;
			},
			deleteEnvironmentSecret: () => Effect.void,
			deleteEnvironmentVariable: () => Effect.void,
			getVulnerabilityAlerts: () => Effect.succeed(false),
			setVulnerabilityAlerts: () => Effect.void,
			getAutomatedSecurityFixes: () => Effect.succeed(false),
			setAutomatedSecurityFixes: () => Effect.void,
			getPrivateVulnerabilityReporting: () => Effect.succeed(false),
			setPrivateVulnerabilityReporting: () => Effect.void,
			getCodeScanningDefaultSetup: () => Effect.succeed({}),
			updateCodeScanningDefaultSetup: () => Effect.void,
			listRepoLanguages: () => Effect.succeed([]),
			resolveTeamId: () => Effect.succeed(0),
		});

		const opStubs = OnePasswordClientTest({});
		const credResolverLayer = Layer.provide(CredentialResolverLive, opStubs);
		const loggerLayer = SyncLoggerLive({ dryRun: false, logLevel: "silent" });
		const testLayer = Layer.provideMerge(
			SyncEngineLive,
			Layer.merge(Layer.merge(trackingGithubLayer, credResolverLayer), loggerLayer),
		);

		const config = makeTestConfig({
			environments: {
				staging: {},
				production: {},
			},
			groups: {
				mygroup: {
					repos: ["repo-one"],
					environments: ["staging", "production"],
					cleanup: {
						secrets: { actions: false, dependabot: false, codespaces: false, environments: false },
						variables: { actions: false, environments: false },
						rulesets: false,
						environments: true,
					},
				},
			},
		});
		const creds = makeTestCredentials();

		const program = Effect.gen(function* () {
			const engine = yield* SyncEngine;
			return yield* engine.syncAll(config, creds, { dryRun: false, noCleanup: false, configDir: process.cwd() });
		}).pipe(Effect.provide(testLayer));

		await Effect.runPromise(program);

		// staging and production are configured, so not deleted
		// old-env is not configured, so it should be deleted
		expect(deleted).toContain("old-env");
		expect(deleted).not.toContain("staging");
		expect(deleted).not.toContain("production");
	});

	it("cleanup environment secrets deletes unconfigured secrets per environment", async () => {
		const existingEnvSecrets = [{ name: "DB_URL" }, { name: "OLD_KEY" }];
		const deleted: { envName: string; name: string }[] = [];

		const trackingGithubLayer = Layer.succeed(GitHubClient, {
			getOwnerType: () => Effect.succeed("User" as const),
			syncSecret: () => Effect.void,
			syncVariable: () => Effect.void,
			syncSettings: () => Effect.void,
			syncRuleset: () => Effect.void,
			syncEnvironment: () => Effect.void,
			syncEnvironmentSecret: () => Effect.void,
			syncEnvironmentVariable: () => Effect.void,
			listSecrets: () => Effect.succeed([]),
			listVariables: () => Effect.succeed([]),
			listRulesets: () => Effect.succeed([]),
			listEnvironments: () => Effect.succeed([]),
			listEnvironmentSecrets: () => Effect.succeed(existingEnvSecrets),
			listEnvironmentVariables: () => Effect.succeed([]),
			deleteSecret: () => Effect.void,
			deleteVariable: () => Effect.void,
			deleteRuleset: () => Effect.void,
			deleteEnvironment: () => Effect.void,
			deleteEnvironmentSecret(_owner, _repo, envName, name) {
				deleted.push({ envName, name });
				return Effect.void;
			},
			deleteEnvironmentVariable: () => Effect.void,
			getVulnerabilityAlerts: () => Effect.succeed(false),
			setVulnerabilityAlerts: () => Effect.void,
			getAutomatedSecurityFixes: () => Effect.succeed(false),
			setAutomatedSecurityFixes: () => Effect.void,
			getPrivateVulnerabilityReporting: () => Effect.succeed(false),
			setPrivateVulnerabilityReporting: () => Effect.void,
			getCodeScanningDefaultSetup: () => Effect.succeed({}),
			updateCodeScanningDefaultSetup: () => Effect.void,
			listRepoLanguages: () => Effect.succeed([]),
			resolveTeamId: () => Effect.succeed(0),
		});

		const opStubs = OnePasswordClientTest({});
		const credResolverLayer = Layer.provide(CredentialResolverLive, opStubs);
		const loggerLayer = SyncLoggerLive({ dryRun: false, logLevel: "silent" });
		const testLayer = Layer.provideMerge(
			SyncEngineLive,
			Layer.merge(Layer.merge(trackingGithubLayer, credResolverLayer), loggerLayer),
		);

		const config = makeTestConfig({
			environments: {
				staging: {},
			},
			secrets: {
				env_secrets: { value: { DB_URL: "postgres://localhost" } },
			},
			groups: {
				mygroup: {
					repos: ["repo-one"],
					environments: ["staging"],
					secrets: {
						environments: { staging: ["env_secrets"] },
					},
					cleanup: {
						secrets: { actions: false, dependabot: false, codespaces: false, environments: true },
						variables: { actions: false, environments: false },
						rulesets: false,
						environments: false,
					},
				},
			},
		});
		const creds = makeTestCredentials();

		const program = Effect.gen(function* () {
			const engine = yield* SyncEngine;
			return yield* engine.syncAll(config, creds, { dryRun: false, noCleanup: false, configDir: process.cwd() });
		}).pipe(Effect.provide(testLayer));

		await Effect.runPromise(program);

		// DB_URL is configured, so not deleted
		// OLD_KEY is not configured, so it should be deleted
		expect(deleted).toContainEqual({ envName: "staging", name: "OLD_KEY" });
		expect(deleted).not.toContainEqual(expect.objectContaining({ name: "DB_URL" }));
	});

	it("skips repo when no changes are configured", async () => {
		const recorder = GitHubClientTest();
		const opStubs = OnePasswordClientTest({});
		const credResolverLayer = Layer.provide(CredentialResolverLive, opStubs);
		const output = Ref.unsafeMake<string[]>([]);
		const loggerLayer = SyncLoggerLive({ dryRun: false, logLevel: "info", output });
		const testLayer = Layer.provideMerge(
			SyncEngineLive,
			Layer.merge(Layer.merge(recorder.layer, credResolverLayer), loggerLayer),
		);

		const config = makeTestConfig({
			secrets: {},
			variables: {},
			rulesets: {},
			environments: {},
			groups: {
				mygroup: {
					repos: ["repo-one"],
				},
			},
		});
		const creds = makeTestCredentials();

		const program = Effect.gen(function* () {
			const engine = yield* SyncEngine;
			yield* engine.syncAll(config, creds, { dryRun: false, noCleanup: false, configDir: process.cwd() });
			return yield* Ref.get(output);
		}).pipe(Effect.provide(testLayer));

		const lines = await Effect.runPromise(program);
		expect(lines).toContainEqual(expect.stringContaining("skip"));
	});

	it("cleanup disabled when noCleanup is true", async () => {
		const existingSecrets = [{ name: "STALE_SECRET" }];
		const deleted: string[] = [];

		const trackingGithubLayer = Layer.succeed(GitHubClient, {
			getOwnerType: () => Effect.succeed("User" as const),
			syncSecret: () => Effect.void,
			syncVariable: () => Effect.void,
			syncSettings: () => Effect.void,
			syncRuleset: () => Effect.void,
			syncEnvironment: () => Effect.void,
			syncEnvironmentSecret: () => Effect.void,
			syncEnvironmentVariable: () => Effect.void,
			listSecrets: () => Effect.succeed(existingSecrets),
			listVariables: () => Effect.succeed([]),
			listRulesets: () => Effect.succeed([]),
			listEnvironments: () => Effect.succeed([]),
			listEnvironmentSecrets: () => Effect.succeed([]),
			listEnvironmentVariables: () => Effect.succeed([]),
			deleteSecret(_owner, _repo, name, _scope) {
				deleted.push(name);
				return Effect.void;
			},
			deleteVariable: () => Effect.void,
			deleteRuleset: () => Effect.void,
			deleteEnvironment: () => Effect.void,
			deleteEnvironmentSecret: () => Effect.void,
			deleteEnvironmentVariable: () => Effect.void,
			getVulnerabilityAlerts: () => Effect.succeed(false),
			setVulnerabilityAlerts: () => Effect.void,
			getAutomatedSecurityFixes: () => Effect.succeed(false),
			setAutomatedSecurityFixes: () => Effect.void,
			getPrivateVulnerabilityReporting: () => Effect.succeed(false),
			setPrivateVulnerabilityReporting: () => Effect.void,
			getCodeScanningDefaultSetup: () => Effect.succeed({}),
			updateCodeScanningDefaultSetup: () => Effect.void,
			listRepoLanguages: () => Effect.succeed([]),
			resolveTeamId: () => Effect.succeed(0),
		});

		const opStubs = OnePasswordClientTest({});
		const credResolverLayer = Layer.provide(CredentialResolverLive, opStubs);
		const loggerLayer = SyncLoggerLive({ dryRun: false, logLevel: "silent" });
		const testLayer = Layer.provideMerge(
			SyncEngineLive,
			Layer.merge(Layer.merge(trackingGithubLayer, credResolverLayer), loggerLayer),
		);

		const config = makeTestConfig({
			secrets: {
				deploy: { value: { NPM_TOKEN: "npm-secret" } },
			},
			groups: {
				mygroup: {
					repos: ["repo-one"],
					secrets: { actions: ["deploy"] },
					cleanup: {
						secrets: { actions: true, dependabot: false, codespaces: false, environments: false },
						variables: { actions: false, environments: false },
						rulesets: false,
						environments: false,
					},
				},
			},
		});
		const creds = makeTestCredentials();

		const program = Effect.gen(function* () {
			const engine = yield* SyncEngine;
			return yield* engine.syncAll(config, creds, { dryRun: false, noCleanup: true, configDir: process.cwd() });
		}).pipe(Effect.provide(testLayer));

		await Effect.runPromise(program);

		// No cleanup should happen when noCleanup is true
		expect(deleted).toHaveLength(0);
	});

	describe("Advanced security sync", () => {
		it("syncs vulnerability_alerts when current state differs from desired", async () => {
			const { testLayer, recorder } = buildTestLayer();
			const config = makeTestConfig({
				security: { oss: { vulnerability_alerts: true } },
				groups: {
					mygroup: { repos: ["repo-one"], security: ["oss"] },
				},
			});
			const creds = makeTestCredentials();

			const program = Effect.gen(function* () {
				const engine = yield* SyncEngine;
				return yield* engine.syncAll(config, creds, { dryRun: false, noCleanup: true, configDir: process.cwd() });
			}).pipe(Effect.provide(testLayer));

			await Effect.runPromise(program);

			expect(recorder.calls()).toContainEqual({
				method: "setVulnerabilityAlerts",
				args: { owner: "testowner", repo: "repo-one", enabled: true },
			});
		});

		it("syncs all three security feature toggles when configured", async () => {
			const { testLayer, recorder } = buildTestLayer();
			const config = makeTestConfig({
				security: {
					oss: {
						vulnerability_alerts: true,
						automated_security_fixes: true,
						private_vulnerability_reporting: true,
					},
				},
				groups: { mygroup: { repos: ["repo-one"], security: ["oss"] } },
			});
			const creds = makeTestCredentials();

			await Effect.runPromise(
				Effect.gen(function* () {
					const engine = yield* SyncEngine;
					return yield* engine.syncAll(config, creds, {
						dryRun: false,
						noCleanup: true,
						configDir: process.cwd(),
					});
				}).pipe(Effect.provide(testLayer)),
			);

			const methods = recorder.calls().map((c) => c.method);
			expect(methods).toContain("setVulnerabilityAlerts");
			expect(methods).toContain("setAutomatedSecurityFixes");
			expect(methods).toContain("setPrivateVulnerabilityReporting");
		});

		it("does not call security setters in dry-run mode", async () => {
			const { testLayer, recorder } = buildTestLayer();
			const config = makeTestConfig({
				security: { oss: { vulnerability_alerts: true } },
				groups: { mygroup: { repos: ["repo-one"], security: ["oss"] } },
			});
			const creds = makeTestCredentials();

			await Effect.runPromise(
				Effect.gen(function* () {
					const engine = yield* SyncEngine;
					return yield* engine.syncAll(config, creds, {
						dryRun: true,
						noCleanup: true,
						configDir: process.cwd(),
					});
				}).pipe(Effect.provide(testLayer)),
			);

			expect(recorder.calls().some((c) => c.method.startsWith("set"))).toBe(false);
		});

		it("merges multiple security groups (last write wins)", async () => {
			const { testLayer, recorder } = buildTestLayer();
			const config = makeTestConfig({
				security: {
					base: { vulnerability_alerts: false, automated_security_fixes: true },
					override: { vulnerability_alerts: true },
				},
				groups: { mygroup: { repos: ["repo-one"], security: ["base", "override"] } },
			});
			const creds = makeTestCredentials();

			await Effect.runPromise(
				Effect.gen(function* () {
					const engine = yield* SyncEngine;
					return yield* engine.syncAll(config, creds, {
						dryRun: false,
						noCleanup: true,
						configDir: process.cwd(),
					});
				}).pipe(Effect.provide(testLayer)),
			);

			expect(recorder.calls()).toContainEqual({
				method: "setVulnerabilityAlerts",
				args: { owner: "testowner", repo: "repo-one", enabled: true },
			});
			expect(recorder.calls()).toContainEqual({
				method: "setAutomatedSecurityFixes",
				args: { owner: "testowner", repo: "repo-one", enabled: true },
			});
		});

		it("syncs code_scanning default setup with merged config", async () => {
			const { testLayer, recorder } = buildTestLayer();
			const config = makeTestConfig({
				code_scanning: {
					oss: {
						state: "configured",
						query_suite: "extended",
						threat_model: "remote",
					},
				},
				groups: { mygroup: { repos: ["repo-one"], code_scanning: ["oss"] } },
			});
			const creds = makeTestCredentials();

			await Effect.runPromise(
				Effect.gen(function* () {
					const engine = yield* SyncEngine;
					return yield* engine.syncAll(config, creds, {
						dryRun: false,
						noCleanup: true,
						configDir: process.cwd(),
					});
				}).pipe(Effect.provide(testLayer)),
			);

			expect(recorder.calls()).toContainEqual(
				expect.objectContaining({
					method: "updateCodeScanningDefaultSetup",
					args: expect.objectContaining({
						owner: "testowner",
						repo: "repo-one",
						config: expect.objectContaining({
							state: "configured",
							query_suite: "extended",
							threat_model: "remote",
						}),
					}),
				}),
			);
		});

		it("filters code_scanning languages by detected repo languages", async () => {
			// Custom recorder with non-default listRepoLanguages
			const recorded: Array<{ method: string; args: Record<string, unknown> }> = [];
			const githubLayer = Layer.succeed(GitHubClient, {
				getOwnerType: () => Effect.succeed("User" as const),
				syncSecret: () => Effect.void,
				syncVariable: () => Effect.void,
				syncSettings: () => Effect.void,
				syncRuleset: () => Effect.void,
				listSecrets: () => Effect.succeed([]),
				listVariables: () => Effect.succeed([]),
				listRulesets: () => Effect.succeed([]),
				deleteSecret: () => Effect.void,
				deleteVariable: () => Effect.void,
				deleteRuleset: () => Effect.void,
				syncEnvironment: () => Effect.void,
				syncEnvironmentSecret: () => Effect.void,
				syncEnvironmentVariable: () => Effect.void,
				listEnvironments: () => Effect.succeed([]),
				listEnvironmentSecrets: () => Effect.succeed([]),
				listEnvironmentVariables: () => Effect.succeed([]),
				deleteEnvironment: () => Effect.void,
				deleteEnvironmentSecret: () => Effect.void,
				deleteEnvironmentVariable: () => Effect.void,
				getVulnerabilityAlerts: () => Effect.succeed(false),
				setVulnerabilityAlerts: () => Effect.void,
				getAutomatedSecurityFixes: () => Effect.succeed(false),
				setAutomatedSecurityFixes: () => Effect.void,
				getPrivateVulnerabilityReporting: () => Effect.succeed(false),
				setPrivateVulnerabilityReporting: () => Effect.void,
				getCodeScanningDefaultSetup: () => Effect.succeed({}),
				updateCodeScanningDefaultSetup: (owner, repo, config) => {
					recorded.push({ method: "updateCodeScanningDefaultSetup", args: { owner, repo, config } });
					return Effect.void;
				},
				listRepoLanguages: () => Effect.succeed(["TypeScript", "JavaScript"]),
				resolveTeamId: () => Effect.succeed(0),
			});

			const opStubs = OnePasswordClientTest({});
			const credResolverLayer = Layer.provide(CredentialResolverLive, opStubs);
			const loggerLayer = SyncLoggerLive({ dryRun: false, logLevel: "silent" });
			const testLayer = Layer.provideMerge(
				SyncEngineLive,
				Layer.merge(Layer.merge(githubLayer, credResolverLayer), loggerLayer),
			);

			const config = makeTestConfig({
				code_scanning: {
					oss: {
						state: "configured",
						languages: ["javascript-typescript", "python"],
					},
				},
				groups: { mygroup: { repos: ["repo-one"], code_scanning: ["oss"] } },
			});
			const creds = makeTestCredentials();

			await Effect.runPromise(
				Effect.gen(function* () {
					const engine = yield* SyncEngine;
					return yield* engine.syncAll(config, creds, {
						dryRun: false,
						noCleanup: true,
						configDir: process.cwd(),
					});
				}).pipe(Effect.provide(testLayer)),
			);

			expect(recorded).toHaveLength(1);
			const config0 = recorded[0]?.args.config as { languages: string[] };
			expect(config0.languages).toEqual(["javascript-typescript"]);
			expect(config0.languages).not.toContain("python");
		});

		it("always passes 'actions' language through regardless of detected repo languages", async () => {
			const recorded: Array<{ method: string; args: Record<string, unknown> }> = [];
			const githubLayer = Layer.succeed(GitHubClient, {
				getOwnerType: () => Effect.succeed("User" as const),
				syncSecret: () => Effect.void,
				syncVariable: () => Effect.void,
				syncSettings: () => Effect.void,
				syncRuleset: () => Effect.void,
				listSecrets: () => Effect.succeed([]),
				listVariables: () => Effect.succeed([]),
				listRulesets: () => Effect.succeed([]),
				deleteSecret: () => Effect.void,
				deleteVariable: () => Effect.void,
				deleteRuleset: () => Effect.void,
				syncEnvironment: () => Effect.void,
				syncEnvironmentSecret: () => Effect.void,
				syncEnvironmentVariable: () => Effect.void,
				listEnvironments: () => Effect.succeed([]),
				listEnvironmentSecrets: () => Effect.succeed([]),
				listEnvironmentVariables: () => Effect.succeed([]),
				deleteEnvironment: () => Effect.void,
				deleteEnvironmentSecret: () => Effect.void,
				deleteEnvironmentVariable: () => Effect.void,
				getVulnerabilityAlerts: () => Effect.succeed(false),
				setVulnerabilityAlerts: () => Effect.void,
				getAutomatedSecurityFixes: () => Effect.succeed(false),
				setAutomatedSecurityFixes: () => Effect.void,
				getPrivateVulnerabilityReporting: () => Effect.succeed(false),
				setPrivateVulnerabilityReporting: () => Effect.void,
				getCodeScanningDefaultSetup: () => Effect.succeed({}),
				updateCodeScanningDefaultSetup: (owner, repo, config) => {
					recorded.push({ method: "updateCodeScanningDefaultSetup", args: { owner, repo, config } });
					return Effect.void;
				},
				// listLanguages does not report "Actions" — actions must pass through anyway
				listRepoLanguages: () => Effect.succeed([]),
				resolveTeamId: () => Effect.succeed(0),
			});

			const opStubs = OnePasswordClientTest({});
			const credResolverLayer = Layer.provide(CredentialResolverLive, opStubs);
			const loggerLayer = SyncLoggerLive({ dryRun: false, logLevel: "silent" });
			const testLayer = Layer.provideMerge(
				SyncEngineLive,
				Layer.merge(Layer.merge(githubLayer, credResolverLayer), loggerLayer),
			);

			const config = makeTestConfig({
				code_scanning: {
					oss: {
						state: "configured",
						languages: ["actions", "python"],
					},
				},
				groups: { mygroup: { repos: ["repo-one"], code_scanning: ["oss"] } },
			});
			const creds = makeTestCredentials();

			await Effect.runPromise(
				Effect.gen(function* () {
					const engine = yield* SyncEngine;
					return yield* engine.syncAll(config, creds, {
						dryRun: false,
						noCleanup: true,
						configDir: process.cwd(),
					});
				}).pipe(Effect.provide(testLayer)),
			);

			const config0 = recorded[0]?.args.config as { languages: string[] };
			expect(config0.languages).toContain("actions");
			expect(config0.languages).not.toContain("python");
		});

		it("strips org-only security_and_analysis fields on personal accounts", async () => {
			const { testLayer, recorder } = buildTestLayer();
			const config = makeTestConfig({
				settings: {
					oss: {
						security_and_analysis: {
							secret_scanning: "enabled",
							secret_scanning_delegated_bypass: "enabled",
							delegated_bypass_reviewers: [{ team: "security-team", mode: "ALWAYS" }],
						},
					},
				},
				groups: { mygroup: { repos: ["repo-one"], settings: ["oss"] } },
			});
			const creds = makeTestCredentials();

			await Effect.runPromise(
				Effect.gen(function* () {
					const engine = yield* SyncEngine;
					return yield* engine.syncAll(config, creds, {
						dryRun: false,
						noCleanup: true,
						configDir: process.cwd(),
					});
				}).pipe(Effect.provide(testLayer)),
			);

			const settingsCall = recorder.calls().find((c) => c.method === "syncSettings");
			expect(settingsCall).toBeDefined();
			const settings = settingsCall?.args.settings as { security_and_analysis?: Record<string, unknown> };
			expect(settings.security_and_analysis).toBeDefined();
			expect(settings.security_and_analysis?.secret_scanning).toBe("enabled");
			// Org-only fields should have been dropped
			expect(settings.security_and_analysis?.secret_scanning_delegated_bypass).toBeUndefined();
			expect(settings.security_and_analysis?.delegated_bypass_reviewers).toBeUndefined();
			// And resolveTeamId should NOT have been called
			expect(recorder.calls().some((c) => c.method === "resolveTeamId")).toBe(false);
		});

		it("resolves team slugs to reviewer IDs on org accounts", async () => {
			// Custom layer that returns Organization for getOwnerType and stubs resolveTeamId
			const recorded: Array<{ method: string; args: Record<string, unknown> }> = [];
			const githubLayer = Layer.succeed(GitHubClient, {
				getOwnerType: () => Effect.succeed("Organization" as const),
				syncSecret: () => Effect.void,
				syncVariable: () => Effect.void,
				syncSettings: (owner, repo, settings) => {
					recorded.push({ method: "syncSettings", args: { owner, repo, settings } });
					return Effect.void;
				},
				syncRuleset: () => Effect.void,
				listSecrets: () => Effect.succeed([]),
				listVariables: () => Effect.succeed([]),
				listRulesets: () => Effect.succeed([]),
				deleteSecret: () => Effect.void,
				deleteVariable: () => Effect.void,
				deleteRuleset: () => Effect.void,
				syncEnvironment: () => Effect.void,
				syncEnvironmentSecret: () => Effect.void,
				syncEnvironmentVariable: () => Effect.void,
				listEnvironments: () => Effect.succeed([]),
				listEnvironmentSecrets: () => Effect.succeed([]),
				listEnvironmentVariables: () => Effect.succeed([]),
				deleteEnvironment: () => Effect.void,
				deleteEnvironmentSecret: () => Effect.void,
				deleteEnvironmentVariable: () => Effect.void,
				getVulnerabilityAlerts: () => Effect.succeed(false),
				setVulnerabilityAlerts: () => Effect.void,
				getAutomatedSecurityFixes: () => Effect.succeed(false),
				setAutomatedSecurityFixes: () => Effect.void,
				getPrivateVulnerabilityReporting: () => Effect.succeed(false),
				setPrivateVulnerabilityReporting: () => Effect.void,
				getCodeScanningDefaultSetup: () => Effect.succeed({}),
				updateCodeScanningDefaultSetup: () => Effect.void,
				listRepoLanguages: () => Effect.succeed([]),
				resolveTeamId: (org, slug) => {
					recorded.push({ method: "resolveTeamId", args: { org, slug } });
					return Effect.succeed(slug === "security-team" ? 12345 : 0);
				},
			});

			const opStubs = OnePasswordClientTest({});
			const credResolverLayer = Layer.provide(CredentialResolverLive, opStubs);
			const loggerLayer = SyncLoggerLive({ dryRun: false, logLevel: "silent" });
			const testLayer = Layer.provideMerge(
				SyncEngineLive,
				Layer.merge(Layer.merge(githubLayer, credResolverLayer), loggerLayer),
			);

			const config = makeTestConfig({
				owner: "myorg",
				settings: {
					oss: {
						security_and_analysis: {
							secret_scanning_delegated_bypass: "enabled",
							delegated_bypass_reviewers: [{ team: "security-team", mode: "ALWAYS" }, { role: "admin" }],
						},
					},
				},
				groups: { mygroup: { repos: ["repo-one"], settings: ["oss"] } },
			});
			const creds = makeTestCredentials();

			await Effect.runPromise(
				Effect.gen(function* () {
					const engine = yield* SyncEngine;
					return yield* engine.syncAll(config, creds, {
						dryRun: false,
						noCleanup: true,
						configDir: process.cwd(),
					});
				}).pipe(Effect.provide(testLayer)),
			);

			expect(recorded.some((r) => r.method === "resolveTeamId" && r.args.slug === "security-team")).toBe(true);
			const settingsCall = recorded.find((r) => r.method === "syncSettings");
			expect(settingsCall).toBeDefined();
			const settings = settingsCall?.args.settings as {
				security_and_analysis?: { delegated_bypass_reviewers?: Array<Record<string, unknown>> };
			};
			const reviewers = settings.security_and_analysis?.delegated_bypass_reviewers;
			expect(reviewers).toHaveLength(2);
			expect(reviewers?.[0]).toMatchObject({ reviewer_id: 12345, reviewer_type: "TEAM", mode: "ALWAYS" });
			expect(reviewers?.[1]).toMatchObject({ reviewer_id: "admin", reviewer_type: "ROLE" });
		});
	});
});
