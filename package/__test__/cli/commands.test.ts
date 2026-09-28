import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { App } from "@effected/app";
import { ConfigProvider, Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createHandler,
	listHandler as credentialsListHandler,
	deleteHandler,
} from "../../src/cli/commands/credentials.js";
import { describeIdentity, doctorHandler } from "../../src/cli/commands/doctor.js";
import { initHandler } from "../../src/cli/commands/init.js";
import { listHandler } from "../../src/cli/commands/list.js";
import { nukeHandler } from "../../src/cli/commands/nuke.js";
import { partitionByProfile, syncHandler } from "../../src/cli/commands/sync.js";
import { validateHandler } from "../../src/cli/commands/validate.js";
import { CredentialsFilesLive, makeConfigFilesLive } from "../../src/services/ConfigFiles.js";
import { Invocation } from "../../src/services/Invocation.js";
import { migrations } from "../../src/store/migrations.js";
import { PHASE_NAMES, selectPhases } from "../../src/sync/phase.js";
import { on, run, runOutcome, text } from "../utils/capture.js";

/**
 * These drive the command **handlers**, not the argv parser — the parser is
 * `effect/cli`'s and is not this repo's to test. What is worth testing
 * is what each handler reads, writes and prints.
 *
 * Output is captured through the shipped `CliLogger` over a recording
 * `Console` (see `../utils/capture.ts`), so both `Console.log` program output
 * and `Effect.log*` diagnostics are exercised, each tagged with the stream it
 * lands on — "doctor must not print a secret" is a claim about every stream,
 * not just stdout.
 */

let dir: string;
let home: string;
let previousCwd: string;

beforeEach(() => {
	previousCwd = process.cwd();
	dir = join(tmpdir(), `reposets-cli-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	home = join(dir, "home");
	mkdirSync(dir, { recursive: true });
	mkdirSync(home, { recursive: true });
	// Both config files resolve by walking UP from the working directory. Left
	// at the repo root, that walk climbs out of the temp fixture and finds this
	// repository's own reposets.*.toml — so a test would read the developer's
	// machine and pass or fail for reasons that have nothing to do with it.
	process.chdir(dir);
});

afterEach(() => {
	process.chdir(previousCwd);
	rmSync(dir, { recursive: true, force: true });
});

const AppLive = App.layer({ namespace: "reposets-cli-test", store: { migrations } });

/**
 * Every service the handlers require, over a temp XDG root.
 *
 * @remarks
 * No test touches `process.env`. The environment is one explicit record, built
 * per call (the fixture directory is minted per test), provided as the ambient
 * `ConfigProvider` — the one seam every reader uses: `@effected/xdg` for `HOME`
 * and `XDG_*`, the credential resolver and `doctor` for everything else. `extra`
 * adds to it — a service-account token, a credential variable — for one test
 * only. `Invocation` carries only the working directory and version.
 */
const layers = (
	configFlag: string | undefined,
	extra: Readonly<Record<string, string>> = {},
): Layer.Layer<never, unknown, never> => {
	const env: Record<string, string> = {
		HOME: home,
		XDG_CONFIG_HOME: join(home, ".config"),
		XDG_STATE_HOME: join(home, ".local/state"),
		XDG_CACHE_HOME: join(home, ".cache"),
		...extra,
	};
	return Layer.mergeAll(
		makeConfigFilesLive(configFlag),
		CredentialsFilesLive,
		Invocation.layer({ cwd: dir, version: "0.0.0-test" }),
	).pipe(
		Layer.provideMerge(AppLive),
		Layer.provideMerge(NodeServices.layer),
		Layer.provideMerge(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
	) as unknown as Layer.Layer<never, unknown, never>;
};

/**
 * Provide a handler's services.
 *
 * @remarks
 * The handlers are exported separately from the `Command`s they back, because
 * `effect/cli`'s `Command` does not expose its handler — there is no
 * `command.handler`, and `subcommands` yields `{ group, commands }` groupings
 * rather than anything invocable. Testing a handler through the argv parser
 * would test the parser; exporting the handler tests the command.
 */
const provided = (
	handler: Effect.Effect<void, unknown, never>,
	configFlag?: string,
	extra?: Readonly<Record<string, string>>,
): Effect.Effect<void, unknown, never> =>
	handler.pipe(Effect.provide(layers(configFlag, extra))) as Effect.Effect<void, unknown, never>;

const CONFIG = `[settings.defaults]
has_issues = true

[groups.my-projects]
repos = ["repo-one", "repo-two"]
credentials = "default"
settings = ["defaults"]
secrets = { actions = ["deploy"] }
`;

describe("phase selection degrades dangerously when a name is wrong", () => {
	const fake = PHASE_NAMES.map((name) => ({ name, appliesTo: () => true, run: () => undefined }) as never);
	const valid = (v: ReadonlyArray<string>): ReadonlySet<(typeof PHASE_NAMES)[number]> =>
		new Set(v.filter((x): x is (typeof PHASE_NAMES)[number] => (PHASE_NAMES as ReadonlyArray<string>).includes(x)));

	it("selects exactly the phase named", () => {
		expect(selectPhases(fake, { only: valid(["settings"]) }).map((p) => p.name)).toEqual(["settings"]);
	});

	it("treats an empty `only` as no filter — which is why the CLI must reject typos", () => {
		// This is the mechanism, pinned so it cannot change silently: an
		// unrecognised name filters down to an empty set, and an empty `only`
		// reads as "run everything". `sync` therefore refuses unknown names
		// before it reaches here rather than relying on this behaving.
		expect(selectPhases(fake, { only: valid([]) })).toHaveLength(PHASE_NAMES.length);
	});
});

describe("describeIdentity", () => {
	const user = { username: "acme", github_token: { env: "GH" } } as never;
	const org = { org: "acme-corp", github_token: { env: "GH" } } as never;

	it("confirms a username profile against the token's owner", () => {
		// The one exact check available for free — GET /user returns the account
		// that owns the token, and for a personal profile that IS the declared
		// owner.
		const line = describeIdentity("p", user, "acme");
		expect(line.ok).toBe(true);
		expect(line.text).toContain("matches username");
	});

	it("reports a username that does not match as an error", () => {
		const line = describeIdentity("p", user, "someone-else");
		expect(line.ok).toBe(false);
		expect(line.text).toContain('declares username = "acme"');
		expect(line.text).toContain("someone-else");
	});

	it("says a token is owned by a user without claiming it is the org", () => {
		// This is the wording that was wrong: "authenticates as spencerbeggs"
		// beside `org = "..."` reads as a contradiction, when in fact a
		// fine-grained token is always owned by a user.
		const line = describeIdentity("p", org, "acme");
		expect(line.ok).toBe(true);
		expect(line.text).toContain("owned by acme");
		expect(line.text).toContain("for org acme-corp");
		expect(line.text).not.toContain("authenticates as");
	});

	it("does not claim an org profile was verified against the org", () => {
		// Nothing in GET /user says whether the token reaches that organization,
		// so the line must not read as confirmation of something unchecked.
		const line = describeIdentity("p", org, "someone-else");
		expect(line.ok).toBe(true);
		expect(line.text).not.toContain("matches");
	});
});

describe("partitionByProfile", () => {
	const group = (credentials: string) => ({ credentials, repos: [] });

	it("groups by profile, in order of first appearance", () => {
		const partitions = partitionByProfile({
			alpha: group("org"),
			beta: group("personal"),
			gamma: group("org"),
		});

		// Order is the config's, not the profile's: a reader following the output
		// is following their own file.
		expect([...partitions.keys()]).toEqual(["org", "personal"]);
		expect(partitions.get("org")).toEqual(["alpha", "gamma"]);
		expect(partitions.get("personal")).toEqual(["beta"]);
	});

	it("a --group filter narrows to that group's profile alone", () => {
		const partitions = partitionByProfile({ alpha: group("org"), beta: group("personal") }, "beta");

		// The point of narrowing: `org`'s token is never resolved, so a run
		// targeting one group cannot fail on an unrelated profile's expired
		// secret.
		expect([...partitions.keys()]).toEqual(["personal"]);
		expect(partitions.get("personal")).toEqual(["beta"]);
	});

	it("a --group naming nothing yields an empty map, not every group", () => {
		// Reported by the caller as a typo. Falling through to "all groups" would
		// sync everything for a misspelled filter, which is the worst outcome
		// available to a flag whose job is narrowing a destructive operation.
		expect(partitionByProfile({ alpha: group("org") }, "typo").size).toBe(0);
	});

	it("cannot preserve config order for an integer-named group", () => {
		// Not a defect here, and not fixable here either: `config.groups` is a
		// plain object, and JS enumerates integer-like keys first in ascending
		// numeric order regardless of insertion. So a group named `2` is hoisted
		// before `alpha` by `Object.entries` before this function sees either.
		//
		// Asserted rather than glossed over, because the obvious reading of "in
		// order of first appearance" is that it always holds — it does for every
		// name anyone would actually write, and this is the exception.
		const partitions = partitionByProfile({ alpha: group("a"), 2: group("b") });
		expect([...partitions.keys()]).toEqual(["b", "a"]);
	});
});

describe("list", () => {
	/** A profile named `default`, acting as `acme`, to match CONFIG's group. */
	const CREDS = `[profiles.default]\nusername = "acme"\ngithub_token = { env = "GH" }\n`;

	it("prints the owner, groups and their assignments", async () => {
		writeFileSync(join(dir, "reposets.config.toml"), CONFIG);
		writeFileSync(join(dir, "reposets.credentials.toml"), CREDS);
		const lines = await run(provided(listHandler as never, join(dir, "reposets.config.toml")));
		const out = text(lines);

		// The owner comes from the profile, so listing a group means reading
		// both files — there is no owner in the config to fall back to.
		expect(out).toContain("[my-projects] (owner: acme, credentials: default)");
		expect(out).toContain("acme/repo-one");
		expect(out).toContain("settings: defaults");
		expect(out).toContain("secrets: actions:[deploy]");
	});

	it("omits collections a group does not assign", async () => {
		writeFileSync(join(dir, "reposets.config.toml"), CONFIG);
		writeFileSync(join(dir, "reposets.credentials.toml"), CREDS);
		const out = text(await run(provided(listHandler as never, join(dir, "reposets.config.toml"))));
		// No rulesets/environments/security in the fixture — and no empty labels.
		expect(out).not.toContain("rulesets:");
		expect(out).not.toContain("variables:");
	});

	it("takes each group's owner from its own profile", async () => {
		// Replaces a test for `group.owner`, which no longer exists. Two groups
		// under two profiles is now the only way to sync two owners, so this is
		// the shape that matters.
		writeFileSync(
			join(dir, "reposets.config.toml"),
			`[groups.mine]\nrepos = ["r"]\ncredentials = "personal"\n\n[groups.theirs]\nrepos = ["s"]\ncredentials = "work"\n`,
		);
		writeFileSync(
			join(dir, "reposets.credentials.toml"),
			`[profiles.personal]\nusername = "acme"\ngithub_token = { env = "GH" }\n\n[profiles.work]\norg = "other-org"\ngithub_token = { env = "GH" }\n`,
		);
		const out = text(await run(provided(listHandler as never, join(dir, "reposets.config.toml"))));

		expect(out).toContain("[mine] (owner: acme, credentials: personal)");
		expect(out).toContain("acme/r");
		expect(out).toContain("[theirs] (owner: other-org, credentials: work)");
		expect(out).toContain("other-org/s");
	});

	it("says so when a group names a profile that does not exist", async () => {
		// Without the profile there is no owner to print at all, so silence here
		// would render a group with no owner and read as a display bug rather
		// than the config error it is.
		writeFileSync(join(dir, "reposets.config.toml"), `[groups.g]\nrepos = ["r"]\ncredentials = "missing"\n`);
		writeFileSync(join(dir, "reposets.credentials.toml"), CREDS);
		const out = text(await run(provided(listHandler as never, join(dir, "reposets.config.toml"))));

		expect(out).toContain("credentials: missing — NOT FOUND");
	});
});

describe("doctor", () => {
	it("warns about a misspelled settings field, which no other gate can see", async () => {
		// `SettingsGroupSchema` has a rest schema, so an unrecognised field decodes
		// cleanly, gets PATCHed, is ignored by GitHub, and is reported as applied.
		// Strict decoding cannot object and the key sets never covered settings, so
		// before this the typo did nothing at all, silently, forever.
		writeFileSync(
			join(dir, "reposets.config.toml"),
			`[settings.defaults]\nhas_wikkis = false\n\n[groups.g]\nrepos = ["r"]\ncredentials = "me"\nsettings = ["defaults"]\n`,
		);
		const out = text(
			await run(provided(doctorHandler(join(dir, "reposets.config.toml")) as never, join(dir, "reposets.config.toml"))),
		);

		expect(out).toContain("unrecognised setting 'has_wikkis' in settings.defaults");
		expect(out).toContain("did you mean 'has_wiki'?");
		// A warning, not a rejection — pass-through is deliberate, and this cannot
		// tell a typo from a field newer than the schema.
		expect(out).toContain("Schema validation: passed");
	});

	it("stays quiet about settings fields the schema knows", async () => {
		// The control. Without it this would pass against a check that flagged
		// every settings field it was handed.
		writeFileSync(
			join(dir, "reposets.config.toml"),
			`[settings.defaults]\nhas_wiki = false\ndelete_branch_on_merge = true\n\n[groups.g]\nrepos = ["r"]\ncredentials = "me"\nsettings = ["defaults"]\n`,
		);
		const out = text(
			await run(provided(doctorHandler(join(dir, "reposets.config.toml")) as never, join(dir, "reposets.config.toml"))),
		);

		expect(out).not.toContain("unrecognised setting");
		expect(out).toContain("No unknown keys detected");
	});

	it("tells a pre-1.0 config where its removed keys went", async () => {
		// Every config written before 1.0 carries at least one of these, so this
		// is the upgrade path rather than an edge case. "unknown key" is the
		// wrong sentence for a key that moved, and the nearest-match hint is
		// actively misleading for one — `owner` is three edits from `repos`.
		writeFileSync(
			join(dir, "reposets.config.toml"),
			`owner = "acme"\nlog_level = "verbose"\n\n[groups.g]\nowner = "other"\nrepos = ["r"]\n`,
		);
		const out = text(
			await run(provided(doctorHandler(join(dir, "reposets.config.toml")) as never, join(dir, "reposets.config.toml"))),
		);

		expect(out).toContain("'owner' removed in 1.0");
		expect(out).toContain("credential profile");
		expect(out).toContain("'log_level' removed in 1.0");
		// A group's owner is a different fact from the top-level one, and says so.
		expect(out).toContain("'owner' in groups.g removed in 1.0");
		expect(out).toContain("cannot override it");
		// Never the typo hint for a key that was deliberately removed.
		expect(out).not.toContain("did you mean 'repos'?");
	});

	it("flags unknown keys and suggests the nearest match", async () => {
		writeFileSync(
			join(dir, "reposets.config.toml"),
			`settingz = {}\n\n[groups.g]\nrepos = ["r"]\ncredentials = "me"\nunknown_key = 1\n\n[groups.g.cleanup]\nrulesetz = true\n`,
		);
		const out = text(
			await run(provided(doctorHandler(join(dir, "reposets.config.toml")) as never, join(dir, "reposets.config.toml"))),
		);

		expect(out).toContain("unknown key 'settingz'");
		expect(out).toContain("did you mean 'settings'?");
		expect(out).toContain("unknown key 'unknown_key' in groups.g");
		expect(out).toContain("unknown key 'rulesetz' in groups.g.cleanup");
		expect(out).toContain("3 warning(s) found");
		// The config layer decodes strictly, so these keys are REJECTED, not
		// stripped. Doctor must say so — a run that reported only warnings would
		// imply the config loaded and merely had cosmetic problems.
		expect(out).toContain("Schema validation: FAILED");
	});

	it("still diagnoses a config the schema rejects", async () => {
		// The regression this pins: with `onExcessProperty: "error"`, discovery
		// fails on a typo'd config — and doctor used to bail with "No config
		// found", hiding the one diagnosis it exists to give.
		writeFileSync(
			join(dir, "reposets.config.toml"),
			`settingz = {}\n\n[groups.g]\nrepos = ["r"]\ncredentials = "me"\n`,
		);
		const out = text(
			await run(provided(doctorHandler(join(dir, "reposets.config.toml")) as never, join(dir, "reposets.config.toml"))),
		);

		expect(out).not.toContain("No config found");
		expect(out).toContain("Config: ");
		expect(out).toContain("did you mean 'settings'?");
	});

	it("reports a clean config with no warnings", async () => {
		writeFileSync(join(dir, "reposets.config.toml"), CONFIG);
		const out = text(
			await run(provided(doctorHandler(join(dir, "reposets.config.toml")) as never, join(dir, "reposets.config.toml"))),
		);
		expect(out).toContain("Schema validation: passed");
		expect(out).toContain("No unknown keys detected.");
	});

	it("lists the corrected token permissions and never GPG keys", async () => {
		writeFileSync(join(dir, "reposets.config.toml"), CONFIG);
		const out = text(
			await run(provided(doctorHandler(join(dir, "reposets.config.toml")) as never, join(dir, "reposets.config.toml"))),
		);

		// v3 told users to grant an account-wide scope reposets never uses.
		expect(out).not.toContain("GPG");
		for (const permission of [
			"Administration (Read and write)",
			"Secrets (Read and write)",
			"Variables (Read and write)",
			"Environments (Read and write)",
			"Dependabot secrets (Read and write)",
			"Code scanning alerts (Read and write)",
			"Dependabot alerts (Read and write)",
			"Secret scanning alerts (Read and write)",
			"Members (Read)",
		]) {
			expect(out).toContain(permission);
		}
		expect(out).toContain("Metadata: Read is mandatory");
	});

	it("reports which form each credential profile uses, and never a value", async () => {
		const SECRET = "ghp_DO_NOT_PRINT_THIS_9f3a";
		writeFileSync(join(dir, "reposets.config.toml"), CONFIG);
		writeFileSync(
			join(dir, "reposets.credentials.toml"),
			`[profiles.personal]\nusername = "acme"\ngithub_token = { env = "REPOSETS_DOCTOR_TEST" }\n\n[profiles.personal.resolve.op]\nNPM = "op://Private/npm/token"\n`,
		);
		const lines = await run(
			provided(doctorHandler(join(dir, "reposets.config.toml")) as never, join(dir, "reposets.config.toml"), {
				REPOSETS_DOCTOR_TEST: SECRET,
			}),
		);
		const out = text(lines);

		expect(out).toContain("Credentials: 1 profile(s)");
		// The variable NAME is an address and is printed.
		expect(out).toContain("env REPOSETS_DOCTOR_TEST");
		// Its VALUE is a secret and must not be, on any stream.
		expect(out).not.toContain(SECRET);
		expect(JSON.stringify(lines)).not.toContain(SECRET);
	});

	it("names the --config file, not a valid one nearer the working directory", async () => {
		// The bug: `locateConfig` only runs when discovery FAILED, which is
		// exactly when --config was pointing at the broken file. Walking from cwd
		// instead would report "Schema validation: FAILED" under the path of a
		// perfectly valid config — sending the user to the wrong file, by the one
		// command whose job is to say which file is wrong.
		const nested = join(dir, "nested");
		mkdirSync(nested, { recursive: true });

		// Valid, and nearest cwd — the decoy the walk would find.
		writeFileSync(join(dir, "reposets.config.toml"), CONFIG);
		// Invalid, and the one actually asked for.
		const requested = join(nested, "reposets.config.toml");
		writeFileSync(requested, `settingz = {}\n\n[groups.g]\nrepos = ["r"]\ncredentials = "me"\n`);

		const out = text(await run(provided(doctorHandler(requested) as never, requested)));

		expect(out).toContain(`Config: ${requested}`);
		expect(out).not.toContain(`Config: ${join(dir, "reposets.config.toml")}`);
		expect(out).toContain("Schema validation: FAILED");
		expect(out).toContain("did you mean 'settings'?");
	});

	it("accepts --config naming a directory", async () => {
		// `--config` may be a directory; the bare candidate is tried before the
		// joined one, so an existence check would match the directory itself and
		// doctor would report "Could not read <dir>". Found by running it.
		const nested = join(dir, "nested");
		mkdirSync(nested, { recursive: true });
		writeFileSync(
			join(nested, "reposets.config.toml"),
			`settingz = {}\n\n[groups.g]\nrepos = ["r"]\ncredentials = "me"\n`,
		);

		const out = text(await run(provided(doctorHandler(nested) as never, nested)));

		expect(out).toContain(`Config: ${join(nested, "reposets.config.toml")}`);
		expect(out).not.toContain("Could not read");
		expect(out).toContain("did you mean 'settings'?");
	});

	it("reports a credentials file that exists but does not decode", async () => {
		// Same failure class strict decoding exposed on the config side: without
		// this, an invalid credentials file reads as "no profiles configured" —
		// indistinguishable from having none, which is exactly what a leftover
		// `op_service_account_token` produces.
		writeFileSync(join(dir, "reposets.config.toml"), CONFIG);
		writeFileSync(
			join(dir, "reposets.credentials.toml"),
			`[profiles.p]\nusername = "acme"\ngithub_token = { env = "GH" }\nop_service_account_token = "ops_leftover"\n`,
		);
		const out = text(
			await run(provided(doctorHandler(join(dir, "reposets.config.toml")) as never, join(dir, "reposets.config.toml"))),
		);

		expect(out).toContain("Credentials: FAILED to load");
		expect(out).toContain("op_service_account_token");
		expect(out).not.toContain("Credentials: no profiles configured");
		// A broken credentials file must not suppress the rest of the diagnosis.
		expect(out).toContain("Required fine-grained token permissions");
		// And it must not print the stale token's value.
		expect(out).not.toContain("ops_leftover");
	});

	it("warns when op references exist but the service account token is absent", async () => {
		// The environment record carries no OP_SERVICE_ACCOUNT_TOKEN at all —
		// whatever the developer's shell exports never reaches the handler.
		writeFileSync(join(dir, "reposets.config.toml"), CONFIG);
		writeFileSync(
			join(dir, "reposets.credentials.toml"),
			`[profiles.p]\nusername = "acme"\ngithub_token = { op = "op://Private/gh/token" }\n`,
		);
		const out = text(
			await run(provided(doctorHandler(join(dir, "reposets.config.toml")) as never, join(dir, "reposets.config.toml"))),
		);
		expect(out).toContain("OP_SERVICE_ACCOUNT_TOKEN: NOT SET");
	});

	it("does not print the 1Password service account token when it is set", async () => {
		const SECRET = "ops_SERVICE_ACCOUNT_SECRET_VALUE";
		writeFileSync(join(dir, "reposets.config.toml"), CONFIG);
		writeFileSync(
			join(dir, "reposets.credentials.toml"),
			`[profiles.p]\nusername = "acme"\ngithub_token = { op = "op://Private/gh/token" }\n`,
		);
		const lines = await run(
			provided(doctorHandler(join(dir, "reposets.config.toml")) as never, join(dir, "reposets.config.toml"), {
				OP_SERVICE_ACCOUNT_TOKEN: SECRET,
			}),
		);
		expect(text(lines)).toContain("OP_SERVICE_ACCOUNT_TOKEN: set");
		expect(JSON.stringify(lines)).not.toContain(SECRET);
	});
});

describe("init", () => {
	it("scaffolds both files and a .gitignore into the project directory", async () => {
		const out = text(await run(provided(initHandler(true) as never)));
		expect(out).toContain("Created:");
		expect(readFileSync(join(dir, "reposets.config.toml"), "utf8")).toContain("reposets configuration");
		expect(readFileSync(join(dir, ".gitignore"), "utf8")).toContain("reposets.credentials.toml");
	});

	it("never writes a secret into the credentials template", async () => {
		await run(provided(initHandler(true) as never));
		const template = readFileSync(join(dir, "reposets.credentials.toml"), "utf8");
		// The v3 template showed `github_token = "ghp_your_token_here"`, which
		// taught the shape the schema no longer accepts.
		expect(template).not.toContain("ghp_");
		expect(template).not.toContain("op_service_account_token");
		expect(template).toContain('github_token = { op = "op://');
	});

	it("is safe to re-run and does not overwrite", async () => {
		await run(provided(initHandler(true) as never));
		writeFileSync(join(dir, "reposets.config.toml"), 'owner = "edited-by-hand"\n');
		const out = text(await run(provided(initHandler(true) as never)));
		expect(out).toContain("Already exists:");
		expect(readFileSync(join(dir, "reposets.config.toml"), "utf8")).toContain("edited-by-hand");
	});

	it("does not duplicate the .gitignore entry on a second run", async () => {
		await run(provided(initHandler(true) as never));
		await run(provided(initHandler(true) as never));
		const gitignore = readFileSync(join(dir, ".gitignore"), "utf8");
		expect(gitignore.split("reposets.credentials.toml").length - 1).toBe(1);
	});
});

describe("credentials", () => {
	const create = (input: { profile: string; op?: string; env?: string; username?: string; org?: string }) =>
		provided(
			createHandler({
				profile: input.profile,
				op: input.op,
				env: input.env,
				// Every profile must say who it acts as, so the helper supplies a
				// username unless a test is specifically about that choice.
				username: input.org === undefined ? (input.username ?? "tester") : undefined,
				org: input.org,
			}) as never,
		);

	it("stores an op reference", async () => {
		const out = text(await run(create({ profile: "personal", op: "op://V/i/f" })));
		expect(out).toContain("Created profile 'personal'");

		const listed = text(await run(provided(credentialsListHandler as never)));
		expect(listed).toContain("github_token: op op://V/i/f");
	});

	it("stores an env reference", async () => {
		await run(create({ profile: "ci", env: "REPOSETS_GH" }));
		const listed = text(await run(provided(credentialsListHandler as never)));
		expect(listed).toContain("github_token: env REPOSETS_GH");
	});

	it("refuses both --op and --env", async () => {
		const out = text(await run(create({ profile: "p", op: "op://V/i/f", env: "V" })));
		expect(out).toContain("exactly one of --op or --env");
	});

	it("refuses neither", async () => {
		const out = text(await run(create({ profile: "p" })));
		expect(out).toContain("A token value is never accepted");
	});

	it("refuses a duplicate profile", async () => {
		await run(create({ profile: "dup", op: "op://V/i/f" }));
		const out = text(await run(create({ profile: "dup", op: "op://V/i/f" })));
		expect(out).toContain("already exists");
	});

	it("writes back to the file it read, not a second one", async () => {
		// The bug this pins: `ConfigFileShape.save` resolves the XDG path rather
		// than the discovered one, so with a project-local credentials file
		// present, `create` wrote to XDG while `list` kept reading the local file
		// — a profile that existed but was invisible.
		writeFileSync(join(dir, "reposets.credentials.toml"), "[profiles]\n");
		await run(create({ profile: "roundtrip", op: "op://V/i/f" }));

		expect(readFileSync(join(dir, "reposets.credentials.toml"), "utf8")).toContain("op://V/i/f");
		const listed = text(await run(provided(credentialsListHandler as never)));
		expect(listed).toContain("github_token: op op://V/i/f");
	});

	it("deletes a profile", async () => {
		await run(create({ profile: "gone", op: "op://V/i/f" }));
		const out = text(await run(provided(deleteHandler("gone") as never)));
		expect(out).toContain("Deleted profile 'gone'");
	});
});

/**
 * The hazard for this command: a user pastes a real token where a reference
 * belongs. It must be refused — and refused *without repeating the value*,
 * because the log is the one place the mistake could still spread to.
 */
describe("credentials create never echoes a pasted secret", () => {
	const create = (input: { profile: string; op?: string; env?: string; username?: string; org?: string }) =>
		provided(
			createHandler({
				profile: input.profile,
				op: input.op,
				env: input.env,
				// Every profile must say who it acts as, so the helper supplies a
				// username unless a test is specifically about that choice.
				username: input.org === undefined ? (input.username ?? "tester") : undefined,
				org: input.org,
			}) as never,
		);

	const SECRET = "ghp_ACTUAL_TOKEN_VALUE_9f3a2b";

	it("rejects a token passed to --op without printing it", async () => {
		const lines = await run(create({ profile: "p", op: SECRET }));
		expect(text(lines)).toContain("Value not echoed");
		expect(JSON.stringify(lines)).not.toContain(SECRET);
	});

	it("rejects a token passed to --env without printing it", async () => {
		const lines = await run(create({ profile: "p", env: SECRET }));
		expect(text(lines)).toContain("Value not echoed");
		expect(JSON.stringify(lines)).not.toContain(SECRET);
	});

	it("rejects an over-long value that no variable name would be", async () => {
		const long = "x".repeat(80);
		const lines = await run(create({ profile: "p", env: long }));
		expect(text(lines)).toContain("references only");
		expect(JSON.stringify(lines)).not.toContain(long);
	});

	it("the echo detector can actually fail", () => {
		// Guard against the leak assertions rotting into no-ops.
		expect(JSON.stringify([{ text: `rejected: ${SECRET}` }])).toContain(SECRET);
	});
});

/**
 * The exit-code contract, per handler: a usage error exits 64 with its message
 * on stderr only; a finding exits 1 by succeeding; program output is on stdout.
 *
 * `runOutcome` stands in for `CliRuntime.main` — a `UserError` becomes 64, the
 * `CliExit` cell becomes the code — so these pin the handler's half of the
 * contract. The spawned-bin suite (`bin.e2e.test.ts`) pins the other half.
 */
describe("exit codes and streams", () => {
	const CREDS = `[profiles.default]\nusername = "acme"\ngithub_token = { env = "GH" }\n`;
	const configPath = (): string => join(dir, "reposets.config.toml");

	const syncWith = (input: { only?: ReadonlyArray<string>; group?: string }) =>
		syncHandler({
			dryRun: true,
			noCleanup: true,
			failOnDrift: false,
			group: input.group,
			repo: undefined,
			only: input.only ?? [],
			skip: [],
			debug: false,
		});

	it("validate writes its result to stdout and exits 0", async () => {
		writeFileSync(configPath(), CONFIG.replace('secrets = { actions = ["deploy"] }\n', ""));
		writeFileSync(join(dir, "reposets.credentials.toml"), CREDS);
		const outcome = await runOutcome(provided(validateHandler as never, configPath()));

		expect(outcome.exitCode).toBe(0);
		expect(on(outcome.lines, "stdout")[0]).toBe(`Valid: ${configPath()}`);
		expect(on(outcome.lines, "stderr")).toEqual([]);
	});

	it("validate reports a dangling reference on stderr and exits 1", async () => {
		// CONFIG's group asks for secret group `deploy`, which it never defines.
		writeFileSync(configPath(), CONFIG);
		writeFileSync(join(dir, "reposets.credentials.toml"), CREDS);
		const outcome = await runOutcome(provided(validateHandler as never, configPath()));

		expect(outcome.exitCode).toBe(1);
		expect(on(outcome.lines, "stderr").join("\n")).toContain("'deploy' does not exist");
		expect(on(outcome.lines, "stdout")).toEqual([]);
	});

	it("list writes the summary to stdout and nothing to stderr", async () => {
		writeFileSync(configPath(), CONFIG);
		writeFileSync(join(dir, "reposets.credentials.toml"), CREDS);
		const outcome = await runOutcome(provided(listHandler as never, configPath()));

		expect(outcome.exitCode).toBe(0);
		expect(on(outcome.lines, "stdout")).toContain("[my-projects] (owner: acme, credentials: default)");
		expect(on(outcome.lines, "stderr")).toEqual([]);
	});

	it("list with no config anywhere is a finding: stderr, exit 1", async () => {
		const outcome = await runOutcome(provided(listHandler as never));

		expect(outcome.exitCode).toBe(1);
		expect(on(outcome.lines, "stderr").join("\n")).toContain("No config file found");
		expect(on(outcome.lines, "stdout")).toEqual([]);
	});

	it("sync refuses an unknown phase as a usage error, before reading any config", async () => {
		// No config file exists at all: the phase check must not depend on one.
		const outcome = await runOutcome(provided(syncWith({ only: ["settings", "secrts"] }) as never));

		expect(outcome.exitCode).toBe(64);
		expect(on(outcome.lines, "stderr").join("\n")).toContain("Unknown phase name(s): secrts");
		expect(on(outcome.lines, "stdout")).toEqual([]);
	});

	it("sync refuses a --group that names nothing as a usage error", async () => {
		writeFileSync(configPath(), CONFIG.replace('secrets = { actions = ["deploy"] }\n', ""));
		writeFileSync(join(dir, "reposets.credentials.toml"), CREDS);
		const outcome = await runOutcome(provided(syncWith({ group: "nope" }) as never, configPath()));

		expect(outcome.exitCode).toBe(64);
		expect(on(outcome.lines, "stderr").join("\n")).toContain("No group named 'nope'");
	});

	it("sync with a dangling reference is a finding: exit 1, nothing synced", async () => {
		writeFileSync(configPath(), CONFIG);
		writeFileSync(join(dir, "reposets.credentials.toml"), CREDS);
		const outcome = await runOutcome(provided(syncWith({}) as never, configPath()));

		expect(outcome.exitCode).toBe(1);
		expect(on(outcome.lines, "stderr").join("\n")).toContain("Nothing was synced");
	});

	it("credentials create refuses both --op and --env with exit 64", async () => {
		const outcome = await runOutcome(
			provided(createHandler({ profile: "p", op: "op://V/i/f", env: "V", username: "u", org: undefined }) as never),
		);
		expect(outcome.exitCode).toBe(64);
		expect(on(outcome.lines, "stderr")).toEqual(["Provide exactly one of --op or --env, not both."]);
		expect(on(outcome.lines, "stdout")).toEqual([]);
	});

	it("credentials delete of a profile that does not exist exits 64", async () => {
		const outcome = await runOutcome(provided(deleteHandler("ghost") as never));
		expect(outcome.exitCode).toBe(64);
		expect(on(outcome.lines, "stderr")).toEqual(["Profile 'ghost' not found."]);
	});

	// A read-only directory is how these provoke a real write/remove failure.
	// Root ignores permission bits, so under root the failure never happens and
	// the tests would prove nothing — they skip instead.
	const isRoot = process.getuid?.() === 0;

	it("init exits 0 when every file is written", async () => {
		const outcome = await runOutcome(provided(initHandler(true) as never));
		expect(outcome.exitCode).toBe(0);
		expect(on(outcome.lines, "stderr").join("\n")).not.toContain("Could not write");
	});

	it.skipIf(isRoot)("init that cannot write a file is a failure: stderr, exit 1", async () => {
		const target = join(dir, "readonly");
		mkdirSync(target);
		chmodSync(target, 0o555);
		try {
			const outcome = await runOutcome(
				initHandler(true).pipe(
					Effect.provide(Invocation.layer({ cwd: target, version: "0.0.0-test" })),
					Effect.provide(layers(undefined)),
				) as never,
			);
			expect(outcome.exitCode).toBe(1);
			expect(on(outcome.lines, "stderr").join("\n")).toContain(
				`Could not write: ${join(target, "reposets.config.toml")}`,
			);
			expect(on(outcome.lines, "stdout").join("\n")).not.toContain("Created:");
		} finally {
			chmodSync(target, 0o755);
		}
	});

	it("nuke --force that removes everything exits 0", async () => {
		writeFileSync(join(dir, "reposets.config.toml"), CONFIG);
		const outcome = await runOutcome(provided(nukeHandler(true) as never));
		expect(outcome.exitCode).toBe(0);
		expect(on(outcome.lines, "stdout").join("\n")).toContain(`removed ${join(dir, "reposets.config.toml")}`);
	});

	it.skipIf(isRoot)("nuke --force that leaves a file behind is a failure: stderr, exit 1", async () => {
		const locked = join(dir, "locked");
		mkdirSync(locked);
		writeFileSync(join(locked, "reposets.config.toml"), CONFIG);
		chmodSync(locked, 0o555);
		try {
			const outcome = await runOutcome(
				nukeHandler(true).pipe(
					Effect.provide(Invocation.layer({ cwd: locked, version: "0.0.0-test" })),
					Effect.provide(layers(undefined)),
				) as never,
			);
			expect(outcome.exitCode).toBe(1);
			expect(on(outcome.lines, "stderr").join("\n")).toContain(
				`could not remove ${join(locked, "reposets.config.toml")}`,
			);
		} finally {
			chmodSync(locked, 0o755);
		}
	});
});
