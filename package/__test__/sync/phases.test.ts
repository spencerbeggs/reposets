import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "@effected/app";
import {
	CodeScanning,
	DeploymentEnvironment,
	GitHubError,
	GitHubRepository,
	Repo,
	RepoRef,
	RepositorySecret,
	RepositoryVariable,
	Ruleset,
	WorkflowDispatch,
} from "@effected/github";
import { Effect, Layer, Logger, Redacted } from "effect";
import { describe, expect, it } from "vitest";
import { fingerprint } from "../../src/lib/fingerprint.js";
import type { Config } from "../../src/schemas/config.js";
import { SyncLoggerLive } from "../../src/services/SyncLogger.js";
import type { AppliedRecord } from "../../src/store/AppliedState.js";
import { AppliedState, AppliedStateLive, lookup } from "../../src/store/AppliedState.js";
import { migrations } from "../../src/store/migrations.js";
import { RepoCacheLive } from "../../src/store/RepoCache.js";
import type { Phase, PhaseResult, RepoContext } from "../../src/sync/phase.js";
import { cleanupPhase } from "../../src/sync/phases/cleanup.js";
import { codeScanningPhase } from "../../src/sync/phases/code-scanning.js";
import { environmentsPhase } from "../../src/sync/phases/environments.js";
import { rulesetsPhase } from "../../src/sync/phases/rulesets.js";
import { secretsPhase } from "../../src/sync/phases/secrets.js";
import { settingsPhase } from "../../src/sync/phases/settings.js";
import { variablesPhase } from "../../src/sync/phases/variables.js";
import { recorder } from "./harness.js";

/**
 * A phase is a function of its `RepoContext`, so these construct one directly
 * and never build an engine. Services come from the recording `GitHubClient`
 * double plus `App.layerTest`'s in-memory databases.
 */

const AppTest = App.layerTest({ namespace: "reposets-phases-test", store: { migrations } });

const config = (overrides: Partial<Config>): Config =>
	({
		log_level: "info",
		settings: {},
		secrets: {},
		variables: {},
		rulesets: {},
		environments: {},
		security: {},
		code_scanning: {},
		groups: {},
		...overrides,
	}) as Config;

const context = (overrides: Partial<RepoContext> & { readonly config: Config }): RepoContext => ({
	owner: "acme",
	repo: "widget",
	slug: "acme/widget",
	group: "g",
	ownerType: "Organization",
	credentials: new Map(),
	configDir: "/tmp/reposets-test-config",
	runId: "run-1",
	dryRun: false,
	noCleanup: false,
	...overrides,
});

interface Outcome {
	readonly result: PhaseResult;
	readonly routes: ReadonlyArray<string>;
	readonly lines: ReadonlyArray<string>;
	/** Every recorded request, for asserting on parameters rather than routes. */
	readonly requests: ReadonlyArray<{ readonly route: string; readonly params: Record<string, unknown> }>;
	/**
	 * Fingerprints recorded during the run.
	 *
	 * @remarks
	 * Read with {@link printOf}, never by composing the key yourself — the map's
	 * key format is `AppliedState`'s private business and is NOT `kind name`.
	 * Hardcoding a separator here cost me a debugging cycle: the lookups silently
	 * missed, which read as "the write did not persist" when the row was there
	 * all along.
	 */
	readonly recorded: ReadonlyMap<string, AppliedRecord>;
}

/**
 * Run one phase against a context, capturing what it called, printed and
 * persisted.
 *
 * @param seed - baseline fingerprints to install before the phase runs, so the
 * three decision branches can each be reached.
 */
/** The fingerprint recorded for one resource, or `undefined`. */
const printOf = (out: Outcome, kind: string, name: string): string | undefined => {
	const record = lookup(out.recorded, kind, name);
	return record._tag === "Some" ? record.value.fingerprint : undefined;
};

/**
 * Every write route these phases can issue, answering with an empty body.
 *
 * @remarks
 * `GitHubClient.layerFixture` fails a route it has no entry for, which is right
 * for the route suite — there, the fixture keys are a second statement of which
 * routes a method may touch. Here it is only noise: a phase test is about the
 * decision, not the endpoint, and every phase catches `GitHubError` per resource
 * and reports it. So an omitted stub does not fail loudly, it silently turns a
 * write into a reported failure and the phase into a different execution path.
 *
 * Declaring the writes once, in one place, is what keeps that from happening
 * twenty-eight times.
 */
const WRITES_ACCEPTED: Readonly<Record<string, unknown>> = {
	"PATCH /repos/{owner}/{repo}": {},
	"PUT /repos/{owner}/{repo}/vulnerability-alerts": {},
	"DELETE /repos/{owner}/{repo}/vulnerability-alerts": {},
	"PUT /repos/{owner}/{repo}/automated-security-fixes": {},
	"DELETE /repos/{owner}/{repo}/automated-security-fixes": {},
	"PUT /repos/{owner}/{repo}/private-vulnerability-reporting": {},
	"DELETE /repos/{owner}/{repo}/private-vulnerability-reporting": {},
	"PATCH /repos/{owner}/{repo}/code-scanning/default-setup": {},
	"PUT /repos/{owner}/{repo}/environments/{environment_name}": {},
	"DELETE /repos/{owner}/{repo}/environments/{environment_name}": {},
	"PUT /repos/{owner}/{repo}/actions/secrets/{secret_name}": {},
	"PUT /repos/{owner}/{repo}/dependabot/secrets/{secret_name}": {},
	"PUT /repos/{owner}/{repo}/codespaces/secrets/{secret_name}": {},
	"DELETE /repos/{owner}/{repo}/actions/secrets/{secret_name}": {},
	"DELETE /repos/{owner}/{repo}/dependabot/secrets/{secret_name}": {},
	"DELETE /repos/{owner}/{repo}/codespaces/secrets/{secret_name}": {},
	"PUT /repos/{owner}/{repo}/environments/{environment_name}/secrets/{secret_name}": {},
	"DELETE /repos/{owner}/{repo}/environments/{environment_name}/secrets/{secret_name}": {},
	// `RepositoryVariable.set` answers "does this exist?" with a by-name read in
	// @effected/github 0.4.0, where it used to paginate the whole collection — so
	// a mis-scoped token fails instead of looking like absence. Absent by default,
	// which is what these fixtures mostly model; the tests that model a variable
	// already being there override it and get a PATCH.
	"GET /repos/{owner}/{repo}/actions/variables/{name}": GitHubError.notFound("RepositoryVariable.set", "variable"),
	"GET /repos/{owner}/{repo}/environments/{environment_name}/variables/{name}": GitHubError.notFound(
		"RepositoryVariable.setForEnvironment",
		"variable",
	),
	"POST /repos/{owner}/{repo}/actions/variables": {},
	"PATCH /repos/{owner}/{repo}/actions/variables/{name}": {},
	"DELETE /repos/{owner}/{repo}/actions/variables/{name}": {},
	"POST /repos/{owner}/{repo}/environments/{environment_name}/variables": {},
	"PATCH /repos/{owner}/{repo}/environments/{environment_name}/variables/{name}": {},
	"DELETE /repos/{owner}/{repo}/environments/{environment_name}/variables/{name}": {},
	"POST /repos/{owner}/{repo}/rulesets": {},
	"PUT /repos/{owner}/{repo}/rulesets/{ruleset_id}": {},
	"DELETE /repos/{owner}/{repo}/rulesets/{ruleset_id}": {},
};

const runPhase = async <R>(
	phase: Effect.Effect<Phase, never, R>,
	ctx: RepoContext,
	options: {
		readonly responses?: Readonly<Record<string, unknown>>;
		readonly seed?: ReadonlyArray<{ kind: string; name: string; fingerprint: string }>;
	} = {},
): Promise<Outcome> => {
	const rec = recorder({ ...WRITES_ACCEPTED, ...options.responses });
	const lines: string[] = [];
	const collector = Logger.make<unknown, void>((o) => {
		lines.push(Array.isArray(o.message) ? o.message.join(" ") : String(o.message));
	});

	const services = Layer.mergeAll(
		GitHubRepository.layer,
		RepositorySecret.layer,
		Ruleset.layer,
		CodeScanning.layer,
		DeploymentEnvironment.layer,
		RepositoryVariable.layer,
		WorkflowDispatch.layer,
		RepoCacheLive,
		AppliedStateLive,
		SyncLoggerLive({ dryRun: ctx.dryRun, debug: true }),
	).pipe(Layer.provideMerge(AppTest), Layer.provideMerge(rec.layer));

	const program = Effect.gen(function* () {
		const applied = yield* AppliedState;
		for (const entry of options.seed ?? []) {
			yield* applied.record({ repo: ctx.slug, kind: entry.kind, name: entry.name }, entry.fingerprint, "seed-run");
		}
		const built = yield* phase;
		// The engine discharges `Repo` once at its repository loop; a phase test
		// stands in for that, since every resource service resolves it per call.
		const result = yield* built.run(ctx).pipe(Repo.provide(RepoRef.make({ owner: ctx.owner, repo: ctx.repo })));
		const after = yield* applied.getMany(ctx.slug);
		return { result, recorded: after };
	});

	const { result, recorded } = await Effect.runPromise(
		program.pipe(Effect.provide(services), Effect.provide(Logger.layer([collector]))) as Effect.Effect<{
			result: PhaseResult;
			recorded: ReadonlyMap<string, AppliedRecord>;
		}>,
	);

	return { result, routes: rec.routes(), lines, recorded, requests: rec.calls };
};

// ---------------------------------------------------------------------------
// settings
// ---------------------------------------------------------------------------

const settingsConfig = config({
	settings: { defaults: { has_issues: true, has_wiki: false } },
	groups: { g: { repos: ["widget"], settings: ["defaults"], credentials: "default" } },
} as Partial<Config>);

describe("settings phase", () => {
	it("declines when the group references no settings groups", async () => {
		const built = await Effect.runPromise(
			settingsPhase.pipe(
				Effect.provide(
					Layer.mergeAll(
						GitHubRepository.layer,
						Ruleset.layer,
						RepoCacheLive,
						AppliedStateLive,
						SyncLoggerLive({ dryRun: false, debug: true }),
					).pipe(Layer.provideMerge(AppTest), Layer.provideMerge(recorder().layer)),
				),
			) as Effect.Effect<Phase>,
		);

		expect(
			built.appliesTo(
				context({
					config: config({ groups: { g: { repos: ["widget"], credentials: "default" } } } as Partial<Config>),
				}),
			),
		).toBe(false);
		expect(built.appliesTo(context({ config: settingsConfig }))).toBe(true);
	});

	it("no baseline: applies and records a fingerprint", async () => {
		const out = await runPhase(settingsPhase, context({ config: settingsConfig }));

		expect(out.routes).toContain("PATCH /repos/{owner}/{repo}");
		expect(out.result.changes).toHaveLength(1);
		expect(out.result.changes[0]?.action).toBe("updated");
		expect(printOf(out, "settings", "settings")).toBeDefined();
	});

	it("baseline matches the config: writes nothing", async () => {
		// Learn the fingerprint the phase computes, then replay it as baseline.
		const first = await runPhase(settingsPhase, context({ config: settingsConfig }));
		const print = printOf(first, "settings", "settings") as string;

		const out = await runPhase(settingsPhase, context({ config: settingsConfig }), {
			seed: [{ kind: "settings", name: "settings", fingerprint: print }],
		});

		expect(out.routes).not.toContain("PATCH /repos/{owner}/{repo}");
		expect(out.result.changes).toHaveLength(0);
	});

	it("baseline differs from the config: applies again", async () => {
		const out = await runPhase(settingsPhase, context({ config: settingsConfig }), {
			seed: [{ kind: "settings", name: "settings", fingerprint: "stale-fingerprint" }],
		});

		expect(out.routes).toContain("PATCH /repos/{owner}/{repo}");
		expect(out.result.changes).toHaveLength(1);
	});

	it("a dry run writes nothing and records nothing", async () => {
		const out = await runPhase(settingsPhase, context({ config: settingsConfig, dryRun: true }));

		expect(out.routes).toEqual([]);
		expect(out.recorded.size).toBe(0);
		// Still reported: a dry run's job is to say what would happen.
		expect(out.result.changes).toHaveLength(1);
	});

	it("strips org-only settings on a personal account and says so", async () => {
		const withForking = config({
			settings: { defaults: { has_issues: true, allow_forking: true } },
			groups: { g: { repos: ["widget"], settings: ["defaults"], credentials: "default" } },
		} as Partial<Config>);

		const out = await runPhase(settingsPhase, context({ config: withForking, ownerType: "User" }));

		const patch = out.routes.includes("PATCH /repos/{owner}/{repo}");
		expect(patch).toBe(true);
		expect(out.lines.join("\n")).toContain("allow_forking");
		expect(out.lines.join("\n")).toContain("org-only");
	});

	it("strips org-only security_and_analysis fields on a personal account", async () => {
		const withDelegation = config({
			settings: {
				defaults: {
					has_issues: true,
					security_and_analysis: { secret_scanning: "enabled", secret_scanning_delegated_bypass: "enabled" },
				},
			},
			groups: { g: { repos: ["widget"], settings: ["defaults"], credentials: "default" } },
		} as unknown as Partial<Config>);

		const out = await runPhase(settingsPhase, context({ config: withDelegation, ownerType: "User" }));
		expect(out.lines.join("\n")).toContain("secret_scanning_delegated_bypass");
	});

	it("resolves a delegated-bypass team slug to a numeric reviewer id", async () => {
		const withReviewers = config({
			settings: {
				defaults: {
					security_and_analysis: {
						secret_scanning_delegated_bypass: "enabled",
						delegated_bypass_reviewers: [{ team: "security-team", mode: "ALWAYS" }],
					},
				},
			},
			groups: { g: { repos: ["widget"], settings: ["defaults"], credentials: "default" } },
		} as unknown as Partial<Config>);

		const out = await runPhase(settingsPhase, context({ config: withReviewers }), {
			responses: { "GET /orgs/{org}/teams/{team_slug}": { id: 4242 } },
		});

		expect(out.routes).toContain("GET /orgs/{org}/teams/{team_slug}");
		expect(out.result.errors).toHaveLength(0);
	});

	it("records an error, not a failure, when a team slug cannot be resolved", async () => {
		const withReviewers = config({
			settings: {
				defaults: {
					security_and_analysis: { delegated_bypass_reviewers: [{ team: "ghost-team" }] },
				},
			},
			groups: { g: { repos: ["widget"], settings: ["defaults"], credentials: "default" } },
		} as unknown as Partial<Config>);

		// The 404 is recorded at the route it belongs to. Leaning on an ABSENT
		// fixture would say "this route is unwired" rather than "this team does
		// not exist" — and an absent fixture is now a defect, not a failure.
		const out = await runPhase(settingsPhase, context({ config: withReviewers }), {
			responses: {
				"GET /orgs/{org}/teams/{team_slug}": GitHubError.notFound("Rulesets.resolveTeamId", "team ghost-team"),
			},
		});

		expect(out.result.errors.some((e) => e.context.includes("ghost-team"))).toBe(true);
		// The phase still returns; it does not abort the run.
		expect(out.result.errors).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// code-scanning
// ---------------------------------------------------------------------------

const codeScanningConfig = config({
	code_scanning: { oss: { state: "configured", languages: ["javascript-typescript", "go"] } },
	groups: { g: { repos: ["widget"], code_scanning: ["oss"] } },
} as unknown as Partial<Config>);

describe("code-scanning phase", () => {
	it("filters configured languages by what GitHub detects", async () => {
		const out = await runPhase(codeScanningPhase, context({ config: codeScanningConfig }), {
			responses: { "GET /repos/{owner}/{repo}/languages": { TypeScript: 1000 } },
		});

		const patch = out.routes.includes("PATCH /repos/{owner}/{repo}/code-scanning/default-setup");
		expect(patch).toBe(true);
		// `go` is configured but not detected, so it is reported and dropped.
		expect(out.lines.join("\n")).toContain("not detected in repository");
		expect(out.lines.join("\n")).toContain("go");
	});

	it("sends `actions` when the repository has workflow files", async () => {
		const withActions = config({
			code_scanning: { oss: { state: "configured", languages: ["actions"] } },
			groups: { g: { repos: ["widget"], code_scanning: ["oss"] } },
		} as unknown as Partial<Config>);

		const out = await runPhase(codeScanningPhase, context({ config: withActions }), {
			responses: {
				"GET /repos/{owner}/{repo}/languages": {},
				"GET /repos/{owner}/{repo}/actions/workflows": {
					total_count: 2,
					// The listing's LENGTH is what counts, not `total_count` — they
					// differ once a repository has more workflows than one page.
					workflows: [
						{
							id: 1,
							node_id: "W_1",
							name: "ci",
							path: ".github/workflows/ci.yml",
							state: "active",
							created_at: "2026-01-01T00:00:00Z",
							updated_at: "2026-01-01T00:00:00Z",
							url: "u",
							html_url: "h",
							badge_url: "b",
						},
						{
							id: 2,
							node_id: "W_2",
							name: "release",
							path: ".github/workflows/release.yml",
							state: "active",
							created_at: "2026-01-01T00:00:00Z",
							updated_at: "2026-01-01T00:00:00Z",
							url: "u",
							html_url: "h",
							badge_url: "b",
						},
					],
				},
			},
		});

		expect(out.lines.join("\n")).not.toContain("no workflow files");
		expect(out.routes).toContain("PATCH /repos/{owner}/{repo}/code-scanning/default-setup");
	});

	it("drops `actions` when the repository has NO workflow files", async () => {
		// `actions` is not a repository language, so `listRepoLanguages` can never
		// confirm it — but GitHub validates it against workflow files and answers
		// 422 for the whole request. Passing it through unconditionally, which is
		// what this used to do, cost three sandbox repositories their entire
		// code-scanning setup.
		const withActions = config({
			code_scanning: { oss: { state: "configured", languages: ["actions"] } },
			groups: { g: { repos: ["widget"], code_scanning: ["oss"] } },
		} as unknown as Partial<Config>);

		const out = await runPhase(codeScanningPhase, context({ config: withActions }), {
			responses: {
				"GET /repos/{owner}/{repo}/languages": {},
				"GET /repos/{owner}/{repo}/actions/workflows": { total_count: 0, workflows: [] },
			},
		});

		expect(out.lines.join("\n")).toContain("no workflow files");
		// Nothing left to configure, so no PATCH at all.
		expect(out.routes).not.toContain("PATCH /repos/{owner}/{repo}/code-scanning/default-setup");
	});

	it("does not count workflows when `actions` is not configured", async () => {
		// The check is paid for only by configs that use the field it guards.
		const out = await runPhase(codeScanningPhase, context({ config: codeScanningConfig }), {
			responses: { "GET /repos/{owner}/{repo}/languages": { Go: 2 } },
		});

		expect(out.routes).not.toContain("GET /repos/{owner}/{repo}/actions/workflows");
	});

	it("maps repository languages onto CodeQL names", async () => {
		const out = await runPhase(codeScanningPhase, context({ config: codeScanningConfig }), {
			// Both map onto javascript-typescript; Go maps onto go.
			responses: { "GET /repos/{owner}/{repo}/languages": { JavaScript: 1, Go: 2 } },
		});

		expect(out.lines.join("\n")).not.toContain("not detected in repository");
	});

	it("no baseline applies; matching baseline does not", async () => {
		const responses = { "GET /repos/{owner}/{repo}/languages": { TypeScript: 1, Go: 2 } };

		const first = await runPhase(codeScanningPhase, context({ config: codeScanningConfig }), { responses });
		expect(first.routes).toContain("PATCH /repos/{owner}/{repo}/code-scanning/default-setup");
		const print = printOf(first, "code_scanning", "default-setup") as string;

		const second = await runPhase(codeScanningPhase, context({ config: codeScanningConfig }), {
			responses,
			seed: [{ kind: "code_scanning", name: "default-setup", fingerprint: print }],
		});
		expect(second.routes).not.toContain("PATCH /repos/{owner}/{repo}/code-scanning/default-setup");
	});

	it("stale baseline applies again", async () => {
		const out = await runPhase(codeScanningPhase, context({ config: codeScanningConfig }), {
			responses: { "GET /repos/{owner}/{repo}/languages": { TypeScript: 1, Go: 2 } },
			seed: [{ kind: "code_scanning", name: "default-setup", fingerprint: "stale" }],
		});

		expect(out.routes).toContain("PATCH /repos/{owner}/{repo}/code-scanning/default-setup");
	});

	it("sends nothing when every configured language was filtered out", async () => {
		// This used to assert the PATCH still went — and that was pinning a bug.
		// `state: configured` with an empty language list is a request GitHub
		// cannot satisfy: it answers 422 exactly as it does for a language the
		// repository does not have, which is the failure the filtering exists to
		// prevent, reached from the other direction.
		const out = await runPhase(codeScanningPhase, context({ config: codeScanningConfig }), {
			responses: { "GET /repos/{owner}/{repo}/languages": {} },
		});

		expect(out.lines.join("\n")).toContain("not detected in repository");
		expect(out.lines.join("\n")).toContain("no configured language is present");
		expect(out.routes).not.toContain("PATCH /repos/{owner}/{repo}/code-scanning/default-setup");
		expect(out.result.changes).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// environments
// ---------------------------------------------------------------------------

const environmentsConfig = config({
	environments: { production: { wait_timer: 15 }, staging: { wait_timer: 0 } },
	groups: { g: { repos: ["widget"], environments: ["production", "staging"] } },
} as unknown as Partial<Config>);

describe("environments phase", () => {
	it("creates each referenced environment", async () => {
		const out = await runPhase(environmentsPhase, context({ config: environmentsConfig }));

		const puts = out.routes.filter((r) => r === "PUT /repos/{owner}/{repo}/environments/{environment_name}");
		expect(puts).toHaveLength(2);
		expect(out.result.changes.map((c) => c.name).sort()).toEqual(["production", "staging"]);
	});

	it("treats each environment as its own drift resource", async () => {
		const first = await runPhase(environmentsPhase, context({ config: environmentsConfig }));
		const productionPrint = printOf(first, "environment", "production") as string;

		// Only production has a matching baseline, so only staging is written.
		const out = await runPhase(environmentsPhase, context({ config: environmentsConfig }), {
			seed: [{ kind: "environment", name: "production", fingerprint: productionPrint }],
		});

		expect(out.result.changes.map((c) => c.name)).toEqual(["staging"]);
		expect(out.routes).toHaveLength(1);
	});

	it("stale baseline applies again", async () => {
		const out = await runPhase(environmentsPhase, context({ config: environmentsConfig }), {
			seed: [{ kind: "environment", name: "production", fingerprint: "stale" }],
		});

		expect(out.result.changes.map((c) => c.name).sort()).toEqual(["production", "staging"]);
	});

	it("skips a referenced environment with no definition", async () => {
		const dangling = config({
			environments: { production: { wait_timer: 5 } },
			groups: { g: { repos: ["widget"], environments: ["production", "ghost"] } },
		} as unknown as Partial<Config>);

		const out = await runPhase(environmentsPhase, context({ config: dangling }));

		expect(out.result.changes.map((c) => c.name)).toEqual(["production"]);
		// Not an error here — danglingReferences owns cross-reference checking.
		expect(out.result.errors).toHaveLength(0);
	});

	it("a dry run writes nothing and records nothing", async () => {
		const out = await runPhase(environmentsPhase, context({ config: environmentsConfig, dryRun: true }));

		expect(out.routes).toEqual([]);
		expect(out.recorded.size).toBe(0);
		expect(out.result.changes).toHaveLength(2);
	});
});

// ---------------------------------------------------------------------------
// variables
// ---------------------------------------------------------------------------

const variablesConfig = config({
	variables: { common: { value: { NODE_ENV: "production", FLAGS: { a: 1 } } } },
	groups: { g: { repos: ["widget"], variables: { actions: ["common"] } } },
} as unknown as Partial<Config>);

describe("variables phase", () => {
	const empty = { "GET /repos/{owner}/{repo}/actions/variables": { variables: [] } };

	it("JSON-stringifies a non-string value and uses a string as-is", async () => {
		const out = await runPhase(variablesPhase, context({ config: variablesConfig }), { responses: empty });

		expect(out.result.changes.map((c) => c.name).sort()).toEqual(["FLAGS", "NODE_ENV"]);
		// Both went out; the object one had to be serialised to reach the API.
		expect(out.routes.filter((r) => r === "POST /repos/{owner}/{repo}/actions/variables")).toHaveLength(2);
	});

	it("detects a variable EDITED out of band and overwrites it", async () => {
		// The case presence-only comparison could never see: the variable is
		// still there, the baseline still matches what we applied, and the value
		// on GitHub is somebody else's.
		const edited = {
			"GET /repos/{owner}/{repo}/actions/variables": {
				variables: [
					{ name: "NODE_ENV", value: "tampered-in-the-ui" },
					{ name: "FLAGS", value: JSON.stringify({ a: 1 }) },
				],
			},
			// Present in the listing, so present to the by-name read too. Leaving
			// this at the suite default would model a variable that exists in the
			// collection and 404s individually, and the write would go out as a
			// POST — which GitHub rejects for a variable that already exists.
			"GET /repos/{owner}/{repo}/actions/variables/{name}": { name: "NODE_ENV", value: "tampered-in-the-ui" },
		};

		const out = await runPhase(variablesPhase, context({ config: variablesConfig }), {
			responses: edited,
			seed: [
				// What we last applied — matching the config, so the only divergence
				// is what somebody changed on GitHub.
				{ kind: "variable", name: "NODE_ENV", fingerprint: fingerprint("production") },
				{ kind: "variable", name: "FLAGS", fingerprint: fingerprint(JSON.stringify({ a: 1 })) },
			],
		});

		const overwritten = out.result.changes.find((c) => c.name === "NODE_ENV");
		expect(overwritten?.action).toBe("drift-overwritten");
		expect(out.lines.join("\n")).toContain("changed outside reposets");
		// FLAGS was untouched, so it is left alone.
		expect(out.result.changes).toHaveLength(1);
		// An existing variable is updated, never created — the two are different
		// endpoints and neither tolerates the other's case.
		expect(out.routes).toContain("PATCH /repos/{owner}/{repo}/actions/variables/{name}");
		expect(out.routes).not.toContain("POST /repos/{owner}/{repo}/actions/variables");
	});

	it("detects a variable deleted out of band and restores it", async () => {
		// Baseline says we applied it; live says it is gone. That is drift, and
		// it is the branch that exists only because fingerprints are persisted.
		const first = await runPhase(variablesPhase, context({ config: variablesConfig }), { responses: empty });
		const print = printOf(first, "variable", "NODE_ENV") as string;

		const out = await runPhase(variablesPhase, context({ config: variablesConfig }), {
			responses: empty,
			seed: [{ kind: "variable", name: "NODE_ENV", fingerprint: print }],
		});

		const restored = out.result.changes.find((c) => c.name === "NODE_ENV");
		expect(restored?.action).toBe("drift-overwritten");
		expect(out.lines.join("\n")).toContain("changed outside reposets");
	});

	it("leaves a variable alone when it is present and matches the baseline", async () => {
		const first = await runPhase(variablesPhase, context({ config: variablesConfig }), { responses: empty });
		const print = printOf(first, "variable", "NODE_ENV") as string;

		const present = {
			"GET /repos/{owner}/{repo}/actions/variables": {
				variables: [
					{ name: "NODE_ENV", value: "production" },
					{ name: "FLAGS", value: JSON.stringify({ a: 1 }) },
				],
			},
		};
		const out = await runPhase(variablesPhase, context({ config: variablesConfig }), {
			responses: present,
			seed: [
				{ kind: "variable", name: "NODE_ENV", fingerprint: print },
				{ kind: "variable", name: "FLAGS", fingerprint: printOf(first, "variable", "FLAGS") as string },
			],
		});

		expect(out.result.changes).toHaveLength(0);
		expect(out.routes).toEqual(["GET /repos/{owner}/{repo}/actions/variables"]);
	});

	it("namespaces environment variables so they cannot collide with repository ones", async () => {
		const envConfig = config({
			variables: { common: { value: { LEVEL: "high" } } },
			groups: { g: { repos: ["widget"], variables: { actions: ["common"], environments: { prod: ["common"] } } } },
		} as unknown as Partial<Config>);

		const out = await runPhase(variablesPhase, context({ config: envConfig }), {
			responses: {
				"GET /repos/{owner}/{repo}/actions/variables": { variables: [] },
				"GET /repos/{owner}/{repo}/environments/{environment_name}/variables": { variables: [] },
			},
		});

		expect(out.result.changes.map((c) => c.name).sort()).toEqual(["LEVEL", "prod/LEVEL"]);
	});

	it("reports a missing credential label without naming a value", async () => {
		const resolved = config({
			variables: { creds: { resolved: { TOKEN: "MISSING_LABEL" } } },
			groups: { g: { repos: ["widget"], variables: { actions: ["creds"] } } },
		} as unknown as Partial<Config>);

		const out = await runPhase(variablesPhase, context({ config: resolved }), { responses: empty });

		expect(out.result.errors[0]?.message).toContain("MISSING_LABEL");
		expect(out.routes).toEqual([]);
	});

	it("resolves a file-backed variable group against configDir", async () => {
		const dir = mkdtempSync(join(tmpdir(), "reposets-var-file-"));
		try {
			writeFileSync(join(dir, "level.txt"), "high\n");
			const fileBacked = config({
				variables: { fromFile: { file: { LEVEL: "./level.txt" } } },
				groups: { g: { repos: ["widget"], variables: { actions: ["fromFile"] } } },
			} as unknown as Partial<Config>);

			const out = await runPhase(variablesPhase, context({ config: fileBacked, configDir: dir }), {
				responses: empty,
			});

			expect(out.result.errors).toHaveLength(0);
			expect(out.result.changes.map((c) => c.name)).toEqual(["LEVEL"]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("a dry run writes nothing and records nothing", async () => {
		const out = await runPhase(variablesPhase, context({ config: variablesConfig, dryRun: true }), {
			responses: empty,
		});

		expect(out.routes).toEqual(["GET /repos/{owner}/{repo}/actions/variables"]);
		expect(out.recorded.size).toBe(0);
		expect(out.result.changes).toHaveLength(2);
	});

	it("never lets a resolved value reach a log line", async () => {
		const SECRET = "vv-DO-NOT-LEAK-9f3a";
		const withCred = config({
			variables: { creds: { resolved: { TOKEN: "LABEL" } } },
			groups: { g: { repos: ["widget"], variables: { actions: ["creds"] } } },
		} as unknown as Partial<Config>);

		const ctx = context({ config: withCred });
		const out = await runPhase(
			variablesPhase,
			{ ...ctx, credentials: new Map([["LABEL", Redacted.make(SECRET, { label: "LABEL" })]]) },
			{ responses: empty },
		);

		expect(out.result.changes).toHaveLength(1);
		expect(out.lines.join("\n")).not.toContain(SECRET);
		// It did reach the API, unwrapped exactly once.
		expect(JSON.stringify(out.routes)).not.toContain(SECRET);
	});
});

// ---------------------------------------------------------------------------
// secrets
// ---------------------------------------------------------------------------

const PUBLIC_KEY = { key: Buffer.alloc(32, 7).toString("base64"), key_id: "key-1" };

const secretsConfig = config({
	secrets: { deploy: { value: { TOKEN: "s3cr3t", OTHER: "v" } } },
	groups: { g: { repos: ["widget"], secrets: { actions: ["deploy"] } } },
} as unknown as Partial<Config>);

const secretResponses = {
	"GET /repos/{owner}/{repo}/actions/secrets": { secrets: [] },
	"GET /repos/{owner}/{repo}/actions/secrets/public-key": PUBLIC_KEY,
};

describe("secrets phase", () => {
	it("seals each secret and never lets the plaintext reach a log or the journal", async () => {
		const out = await runPhase(secretsPhase, context({ config: secretsConfig }), { responses: secretResponses });

		expect(out.result.changes.map((c) => c.name).sort()).toEqual(["actions/OTHER", "actions/TOKEN"]);
		// The journal records names and scopes only.
		expect(JSON.stringify(out.result)).not.toContain("s3cr3t");
		expect(out.lines.join("\n")).not.toContain("s3cr3t");
		// And the value that crossed the wire is a sealed box, not the plaintext.
		expect(out.routes).toContain("PUT /repos/{owner}/{repo}/actions/secrets/{secret_name}");
	});

	it("detects a secret deleted out of band and restores it", async () => {
		const first = await runPhase(secretsPhase, context({ config: secretsConfig }), { responses: secretResponses });
		const print = printOf(first, "secret", "actions/TOKEN") as string;

		const out = await runPhase(secretsPhase, context({ config: secretsConfig }), {
			responses: secretResponses,
			seed: [{ kind: "secret", name: "actions/TOKEN", fingerprint: print }],
		});

		const restored = out.result.changes.find((c) => c.name === "actions/TOKEN");
		expect(restored?.action).toBe("drift-overwritten");
		expect(out.lines.join("\n")).toContain("changed outside reposets");
	});

	it("leaves a present secret alone when the config has not moved", async () => {
		const first = await runPhase(secretsPhase, context({ config: secretsConfig }), { responses: secretResponses });

		const present = {
			...secretResponses,
			"GET /repos/{owner}/{repo}/actions/secrets": { secrets: [{ name: "TOKEN" }, { name: "OTHER" }] },
		};

		const out = await runPhase(secretsPhase, context({ config: secretsConfig }), {
			responses: present,
			seed: [
				{ kind: "secret", name: "actions/TOKEN", fingerprint: printOf(first, "secret", "actions/TOKEN") as string },
				{ kind: "secret", name: "actions/OTHER", fingerprint: printOf(first, "secret", "actions/OTHER") as string },
			],
		});

		expect(out.result.changes).toHaveLength(0);
	});

	it("re-writes a present secret when the configured value changes", async () => {
		// Presence-only drift still catches a CONFIG change: desired moves away
		// from the baseline even though live is assumed to match it.
		const present = {
			...secretResponses,
			"GET /repos/{owner}/{repo}/actions/secrets": { secrets: [{ name: "TOKEN" }, { name: "OTHER" }] },
		};

		const out = await runPhase(secretsPhase, context({ config: secretsConfig }), {
			responses: present,
			seed: [{ kind: "secret", name: "actions/TOKEN", fingerprint: fingerprint("an-older-value") }],
		});

		const rewritten = out.result.changes.find((c) => c.name === "actions/TOKEN");
		expect(rewritten?.action).toBe("updated");
	});

	it("namespaces each scope so the same name in two stores does not collide", async () => {
		const multi = config({
			secrets: { deploy: { value: { TOKEN: "s3cr3t" } } },
			groups: { g: { repos: ["widget"], secrets: { actions: ["deploy"], dependabot: ["deploy"] } } },
		} as unknown as Partial<Config>);

		const out = await runPhase(secretsPhase, context({ config: multi }), {
			responses: {
				...secretResponses,
				"GET /repos/{owner}/{repo}/dependabot/secrets": { secrets: [] },
				"GET /repos/{owner}/{repo}/dependabot/secrets/public-key": PUBLIC_KEY,
			},
		});

		expect(out.result.changes.map((c) => c.name).sort()).toEqual(["actions/TOKEN", "dependabot/TOKEN"]);
	});

	it("writes environment secrets to the environment store", async () => {
		const envConfig = config({
			secrets: { deploy: { value: { TOKEN: "s3cr3t" } } },
			groups: { g: { repos: ["widget"], secrets: { environments: { prod: ["deploy"] } } } },
		} as unknown as Partial<Config>);

		const out = await runPhase(secretsPhase, context({ config: envConfig }), {
			responses: {
				"GET /repos/{owner}/{repo}/environments/{environment_name}/secrets": { secrets: [] },
				"GET /repos/{owner}/{repo}/environments/{environment_name}/secrets/public-key": PUBLIC_KEY,
			},
		});

		expect(out.result.changes.map((c) => c.name)).toEqual(["env:prod/TOKEN"]);
		expect(out.routes).toContain("PUT /repos/{owner}/{repo}/environments/{environment_name}/secrets/{secret_name}");
	});

	it("a dry run reads but never writes", async () => {
		const out = await runPhase(secretsPhase, context({ config: secretsConfig, dryRun: true }), {
			responses: secretResponses,
		});

		expect(out.routes).toEqual(["GET /repos/{owner}/{repo}/actions/secrets"]);
		expect(out.recorded.size).toBe(0);
		expect(out.result.changes).toHaveLength(2);
	});
});

describe("file-backed resource groups", () => {
	it("resolves a file path against configDir, not the working directory", async () => {
		const dir = mkdtempSync(join(tmpdir(), "reposets-file-"));
		try {
			writeFileSync(join(dir, "token.txt"), "from-the-file\n");
			const fileConfig = config({
				secrets: { fromFile: { file: { TOKEN: "./token.txt" } } },
				groups: { g: { repos: ["widget"], secrets: { actions: ["fromFile"] } } },
			} as unknown as Partial<Config>);

			const out = await runPhase(secretsPhase, context({ config: fileConfig, configDir: dir }), {
				responses: secretResponses,
			});

			expect(out.result.errors).toHaveLength(0);
			expect(out.result.changes.map((c) => c.name)).toEqual(["actions/TOKEN"]);
			// Trailing newline trimmed, and the contents never printed.
			expect(out.lines.join("\n")).not.toContain("from-the-file");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("reports an unreadable file by path, never by contents", async () => {
		const fileConfig = config({
			secrets: { fromFile: { file: { TOKEN: "./nope.txt" } } },
			groups: { g: { repos: ["widget"], secrets: { actions: ["fromFile"] } } },
		} as unknown as Partial<Config>);

		const out = await runPhase(secretsPhase, context({ config: fileConfig, configDir: "/tmp/reposets-absent" }), {
			responses: secretResponses,
		});

		expect(out.result.errors).toHaveLength(1);
		expect(out.result.errors[0]?.message).toContain("nope.txt");
		expect(out.routes).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// rulesets
// ---------------------------------------------------------------------------

const rulesetsConfig = config({
	rulesets: {
		main: { name: "main", type: "branch", enforcement: "active", targets: "default", deletion: true },
	},
	groups: { g: { repos: ["widget"], rulesets: ["main"] } },
} as unknown as Partial<Config>);

describe("rulesets phase", () => {
	const none = { "GET /repos/{owner}/{repo}/rulesets": [] };

	it("creates a ruleset that is not there, expanding shorthands", async () => {
		const out = await runPhase(rulesetsPhase, context({ config: rulesetsConfig }), { responses: none });

		expect(out.routes).toContain("POST /repos/{owner}/{repo}/rulesets");
		expect(out.result.changes.map((c) => c.name)).toEqual(["main"]);
	});

	it("detects a ruleset deleted out of band and restores it", async () => {
		const first = await runPhase(rulesetsPhase, context({ config: rulesetsConfig }), { responses: none });
		const print = printOf(first, "ruleset", "main") as string;

		const out = await runPhase(rulesetsPhase, context({ config: rulesetsConfig }), {
			responses: none,
			seed: [{ kind: "ruleset", name: "main", fingerprint: print }],
		});

		expect(out.result.changes[0]?.action).toBe("drift-overwritten");
		expect(out.lines.join("\n")).toContain("changed outside reposets");
	});

	it("leaves a present ruleset alone when the config has not moved", async () => {
		const first = await runPhase(rulesetsPhase, context({ config: rulesetsConfig }), { responses: none });

		const out = await runPhase(rulesetsPhase, context({ config: rulesetsConfig }), {
			responses: { "GET /repos/{owner}/{repo}/rulesets": [{ id: 1, name: "main" }] },
			seed: [{ kind: "ruleset", name: "main", fingerprint: printOf(first, "ruleset", "main") as string }],
		});

		expect(out.result.changes).toHaveLength(0);
	});

	it("creates the repository's own ruleset rather than overwriting an inherited one", async () => {
		const out = await runPhase(rulesetsPhase, context({ config: rulesetsConfig }), {
			responses: {
				"GET /repos/{owner}/{repo}/rulesets": [{ id: 9, name: "main", source_type: "Organization" }],
			},
		});

		// The PHASE is right: it filters org rulesets out of the live map, so an
		// inherited `main` does not make the repository's own look present, and
		// it decides to apply.
		expect(out.result.changes.map((c) => c.name)).toEqual(["main"]);

		// And so is the service now. It filters `source_type` before matching by
		// name, so an inherited `main` is not treated as this repository's own: it
		// POSTs a new repository-level ruleset instead of PUTting over the
		// organization's. v3 matched on name alone and would rewrite org policy
		// from a repository-scoped config.
		expect(out.routes).toContain("POST /repos/{owner}/{repo}/rulesets");
		expect(out.routes).not.toContain("PUT /repos/{owner}/{repo}/rulesets/{ruleset_id}");
		// Nothing may carry the organization's ruleset id.
		expect(out.requests.some((r) => r.params.ruleset_id === 9)).toBe(false);
	});

	it("resolves a { resolved } bypass actor through the cache", async () => {
		const withActor = config({
			rulesets: {
				main: {
					name: "main",
					type: "branch",
					enforcement: "active",
					bypass_actors: [{ actor_type: "Team", actor_id: { resolved: "TEAM_LABEL" }, bypass_mode: "always" }],
				},
			},
			groups: { g: { repos: ["widget"], rulesets: ["main"] } },
		} as unknown as Partial<Config>);

		const ctx = context({ config: withActor });
		const out = await runPhase(
			rulesetsPhase,
			{ ...ctx, credentials: new Map([["TEAM_LABEL", Redacted.make("4242", { label: "TEAM_LABEL" })]]) },
			{ responses: none },
		);

		expect(out.result.errors).toHaveLength(0);
		const post = out.requests.find((r) => r.route === "POST /repos/{owner}/{repo}/rulesets");
		expect(JSON.stringify(post?.params)).toContain("4242");
	});

	it("reports a missing credential label without failing the run", async () => {
		const withActor = config({
			rulesets: {
				main: {
					name: "main",
					type: "branch",
					enforcement: "active",
					status_checks: { required: [{ context: "ci", integration_id: { resolved: "ABSENT_LABEL" } }] },
				},
			},
			groups: { g: { repos: ["widget"], rulesets: ["main"] } },
		} as unknown as Partial<Config>);

		const out = await runPhase(rulesetsPhase, context({ config: withActor }), { responses: none });

		expect(out.result.errors[0]?.message).toContain("ABSENT_LABEL");
	});

	it("a dry run reads but never writes", async () => {
		const out = await runPhase(rulesetsPhase, context({ config: rulesetsConfig, dryRun: true }), { responses: none });

		expect(out.routes).toEqual(["GET /repos/{owner}/{repo}/rulesets"]);
		expect(out.recorded.size).toBe(0);
		expect(out.result.changes).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// cleanup
// ---------------------------------------------------------------------------

/** A group whose every cleanup scope is off, for overriding one at a time. */
const noCleanup = {
	secrets: { actions: false, dependabot: false, codespaces: false, environments: false },
	variables: { actions: false, environments: false },
	rulesets: false,
	environments: false,
} as const;

const cleanupConfig = (group: Record<string, unknown>, rest: Partial<Config> = {}): Config =>
	config({ groups: { g: { repos: ["widget"], ...group } }, ...rest } as unknown as Partial<Config>);

describe("cleanup phase", () => {
	it("declines when no scope is enabled, and when --no-cleanup is passed", async () => {
		const built = await Effect.runPromise(
			cleanupPhase.pipe(
				Effect.provide(
					Layer.mergeAll(
						RepositorySecret.layer,
						RepositoryVariable.layer,
						WorkflowDispatch.layer,
						Ruleset.layer,
						DeploymentEnvironment.layer,
						RepoCacheLive,
						AppliedStateLive,
						SyncLoggerLive({ dryRun: false, debug: true }),
					).pipe(Layer.provideMerge(AppTest), Layer.provideMerge(recorder().layer)),
				),
			) as Effect.Effect<Phase>,
		);

		expect(built.appliesTo(context({ config: cleanupConfig({}) }))).toBe(false);
		expect(built.appliesTo(context({ config: cleanupConfig({ cleanup: noCleanup }) }))).toBe(false);

		const enabled = cleanupConfig({ cleanup: { ...noCleanup, environments: true } });
		expect(built.appliesTo(context({ config: enabled }))).toBe(true);
		// The flag is what makes it decline, nothing else about the context.
		expect(built.appliesTo(context({ config: enabled, noCleanup: true }))).toBe(false);
	});

	it("costs no request for a scope that is off", async () => {
		const out = await runPhase(
			cleanupPhase,
			context({ config: cleanupConfig({ cleanup: { ...noCleanup, environments: true } }) }),
			{ responses: { "GET /repos/{owner}/{repo}/environments": { environments: [] } } },
		);

		// Only the one enabled scope is listed; secrets, variables and rulesets
		// are never read.
		expect(out.routes).toEqual(["GET /repos/{owner}/{repo}/environments"]);
	});

	it("deletes an undeclared secret and keeps a declared one", async () => {
		const out = await runPhase(
			cleanupPhase,
			context({
				config: cleanupConfig(
					{
						secrets: { actions: ["core"] },
						cleanup: { ...noCleanup, secrets: { ...noCleanup.secrets, actions: true } },
					},
					{ secrets: { core: { value: { KEEP: "x" } } } },
				),
			}),
			{
				responses: {
					"GET /repos/{owner}/{repo}/actions/secrets": { secrets: [{ name: "KEEP" }, { name: "STALE" }] },
				},
			},
		);

		expect(out.result.changes).toEqual([
			{ repo: "acme/widget", kind: "secret", name: "actions/STALE", action: "deleted" },
		]);
		const deleted = out.requests.filter(
			(r) => r.route === "DELETE /repos/{owner}/{repo}/actions/secrets/{secret_name}",
		);
		expect(deleted.map((r) => r.params.secret_name)).toEqual(["STALE"]);
	});

	it("honours a preserve list", async () => {
		const out = await runPhase(
			cleanupPhase,
			context({
				config: cleanupConfig({
					cleanup: { ...noCleanup, variables: { actions: { preserve: ["LEGACY"] }, environments: false } },
				}),
			}),
			{
				responses: {
					"GET /repos/{owner}/{repo}/actions/variables": {
						variables: [
							{ name: "LEGACY", value: "1" },
							{ name: "STALE", value: "2" },
						],
					},
				},
			},
		);

		expect(out.result.changes.map((c) => c.name)).toEqual(["STALE"]);
	});

	it("never deletes a ruleset inherited from the organization", async () => {
		const out = await runPhase(
			cleanupPhase,
			context({ config: cleanupConfig({ cleanup: { ...noCleanup, rulesets: true } }) }),
			{
				responses: {
					"GET /repos/{owner}/{repo}/rulesets": [
						{ id: 1, name: "ours", source_type: "Repository" },
						{ id: 2, name: "org-wide", source_type: "Organization" },
					],
				},
			},
		);

		// Nothing is declared, so both would be undeclared — the org's is excluded
		// before that question is even asked.
		expect(out.result.changes.map((c) => c.name)).toEqual(["ours"]);
		const deleted = out.requests.filter((r) => r.route === "DELETE /repos/{owner}/{repo}/rulesets/{ruleset_id}");
		expect(deleted.map((r) => r.params.ruleset_id)).toEqual([1]);
	});

	it("forgets the applied-state row for every deletion", async () => {
		const out = await runPhase(
			cleanupPhase,
			context({ config: cleanupConfig({ cleanup: { ...noCleanup, environments: true } }) }),
			{
				responses: { "GET /repos/{owner}/{repo}/environments": { environments: [{ name: "stale" }] } },
				seed: [
					{ kind: "environment", name: "stale", fingerprint: "old" },
					{ kind: "environment", name: "kept-elsewhere", fingerprint: "keep" },
				],
			},
		);

		expect(printOf(out, "environment", "stale")).toBeUndefined();
		// Only the deleted resource's row goes.
		expect(printOf(out, "environment", "kept-elsewhere")).toBe("keep");
	});

	it("deletes nothing on a dry run, but reports and remembers", async () => {
		const out = await runPhase(
			cleanupPhase,
			context({ config: cleanupConfig({ cleanup: { ...noCleanup, environments: true } }), dryRun: true }),
			{
				responses: { "GET /repos/{owner}/{repo}/environments": { environments: [{ name: "stale" }] } },
				seed: [{ kind: "environment", name: "stale", fingerprint: "old" }],
			},
		);

		expect(out.routes).toEqual(["GET /repos/{owner}/{repo}/environments"]);
		expect(out.result.changes.map((c) => c.name)).toEqual(["stale"]);
		// The row survives a run that deleted nothing.
		expect(printOf(out, "environment", "stale")).toBe("old");
	});

	it("records a failed deletion and carries on", async () => {
		const out = await runPhase(
			cleanupPhase,
			context({ config: cleanupConfig({ cleanup: { ...noCleanup, environments: true } }) }),
			{
				responses: {
					"GET /repos/{owner}/{repo}/environments": { environments: [{ name: "a" }, { name: "b" }] },
					"DELETE /repos/{owner}/{repo}/environments/{environment_name}": GitHubError.notFound(
						"Environments.deleteEnvironment",
						"environment a",
					),
				},
			},
		);

		expect(out.result.errors).toHaveLength(2);
		expect(out.result.changes).toHaveLength(0);
	});

	it("reads names from a { file } group without opening the file", async () => {
		const out = await runPhase(
			cleanupPhase,
			context({
				config: cleanupConfig(
					{
						secrets: { actions: ["fromDisk"] },
						cleanup: { ...noCleanup, secrets: { ...noCleanup.secrets, actions: true } },
					},
					{ secrets: { fromDisk: { file: { KEEP: "/nonexistent/path/that/would/throw" } } } },
				),
			}),
			{
				responses: {
					"GET /repos/{owner}/{repo}/actions/secrets": { secrets: [{ name: "KEEP" }, { name: "STALE" }] },
				},
			},
		);

		// The unreadable path is never touched: KEEP is declared by name alone.
		expect(out.result.errors).toEqual([]);
		expect(out.result.changes.map((c) => c.name)).toEqual(["actions/STALE"]);
	});
});

describe("code-scanning, and GitHub's own synthetic workflow", () => {
	const withActions = config({
		code_scanning: { oss: { state: "configured", languages: ["actions"] } },
		groups: { g: { repos: ["widget"], code_scanning: ["oss"] } },
	} as unknown as Partial<Config>);

	const workflow = (name: string, path: string, state = "active") => ({
		id: 1,
		node_id: "W_1",
		name,
		path,
		state,
		created_at: "2026-01-01T00:00:00Z",
		updated_at: "2026-01-01T00:00:00Z",
		url: "u",
		html_url: "h",
		badge_url: "b",
	});

	it("does not let its own CodeQL workflow satisfy the actions check", async () => {
		// Configuring default setup makes GitHub add `CodeQL` at
		// `dynamic/github-code-scanning/codeql`. Counting it means a repository
		// with no real workflows drops `actions` once, then passes it forever
		// after on the strength of a workflow this phase caused to exist.
		const out = await runPhase(codeScanningPhase, context({ config: withActions }), {
			responses: {
				"GET /repos/{owner}/{repo}/languages": {},
				"GET /repos/{owner}/{repo}/actions/workflows": {
					total_count: 1,
					workflows: [workflow("CodeQL", "dynamic/github-code-scanning/codeql")],
				},
			},
		});

		expect(out.lines.join("\n")).toContain("no workflow files");
		expect(out.routes).not.toContain("PATCH /repos/{owner}/{repo}/code-scanning/default-setup");
	});

	it("still counts a real workflow file alongside it", async () => {
		const out = await runPhase(codeScanningPhase, context({ config: withActions }), {
			responses: {
				"GET /repos/{owner}/{repo}/languages": {},
				"GET /repos/{owner}/{repo}/actions/workflows": {
					total_count: 2,
					workflows: [
						workflow("CodeQL", "dynamic/github-code-scanning/codeql"),
						workflow("ci", ".github/workflows/ci.yml"),
					],
				},
				"PATCH /repos/{owner}/{repo}/code-scanning/default-setup": {},
			},
		});

		expect(out.lines.join("\n")).not.toContain("no workflow files");
		expect(out.routes).toContain("PATCH /repos/{owner}/{repo}/code-scanning/default-setup");
	});

	it("counts a disabled workflow, because GitHub does", async () => {
		// Verified against the live API on an otherwise-empty repository: one
		// workflow in `disabled_manually` is accepted, zero workflows is 422, and
		// the synthetic CodeQL workflow alone is 422. So the rule is the file's
		// PATH, never its state — filtering to `active` here would reproduce the
		// 422 this whole check exists to avoid, on exactly the repositories that
		// park a workflow rather than delete it.
		const out = await runPhase(codeScanningPhase, context({ config: withActions }), {
			responses: {
				"GET /repos/{owner}/{repo}/languages": {},
				"GET /repos/{owner}/{repo}/actions/workflows": {
					total_count: 1,
					workflows: [workflow("ci", ".github/workflows/ci.yml", "disabled_manually")],
				},
				"PATCH /repos/{owner}/{repo}/code-scanning/default-setup": {},
			},
		});

		expect(out.lines.join("\n")).not.toContain("no workflow files");
		expect(out.routes).toContain("PATCH /repos/{owner}/{repo}/code-scanning/default-setup");
	});
});
