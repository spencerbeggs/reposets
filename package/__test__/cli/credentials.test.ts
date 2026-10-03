import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { CliUiTest } from "@effected/cli/ui/testing";
import { Console, Effect, Exit, Option } from "effect";
import { createHandler, deleteHandler, listHandler } from "../../src/cli/commands/credentials.js";
import { on, runOutcome } from "../utils/capture.js";
import type { InteractiveRun } from "./fixture.js";
import { interactive, useTempDirs, withServices } from "./fixture.js";

/**
 * The credentials commands' prompts. What they must keep from the flag path:
 * a token value is never stored and never repeated — not in a refusal, not in
 * the output, and not left on screen by a prompt it was pasted into — and a
 * run with nobody there is refused exactly as before.
 */

const temp = useTempDirs();

const SECRET = "ghp_ACTUAL_TOKEN_VALUE_9f3a2b";
/** What follows `SECRET`'s public prefix: the part that must never be drawn. */
const TAIL = SECRET.slice("ghp_".length);

/** Every byte and every view the session offers, so a leak on any of them fails. */
const views = (run: InteractiveRun) =>
	Effect.all([run.session.written, run.session.stdoutWritten, run.session.stderrWritten, run.session.transcript]);

const credentialsFile = (): string => join(temp.dir(), "reposets.credentials.toml");

/** Two profiles in a project-local credentials file, which discovery finds from the working directory. */
const seed = (): void => {
	writeFileSync(
		credentialsFile(),
		[
			"[profiles.personal]",
			'username = "me"',
			'github_token = { op = "op://Private/github/token" }',
			"",
			"[profiles.work]",
			'org = "acme"',
			'github_token = { env = "ACME_TOKEN" }',
			"",
		].join("\n"),
	);
};

type CreateInput = Parameters<typeof createHandler>[0];
const none: CreateInput = { profile: undefined, op: undefined, env: undefined, username: undefined, org: undefined };
const create = (input: Partial<CreateInput>) =>
	withServices(createHandler({ ...none, ...input }), temp.dir(), temp.home());
const remove = (profile: string | undefined) => withServices(deleteHandler(profile), temp.dir(), temp.home());
const list = () => withServices(listHandler, temp.dir(), temp.home());

describe("credentials create, not interactive", () => {
	it("refuses a missing --profile naming the flag: exit 64", async () => {
		const outcome = await runOutcome(create({ op: "op://V/i/f", username: "u" }));
		assert.strictEqual(outcome.exitCode, 64);
		assert.include(on(outcome.lines, "stderr").join("\n"), "--profile");
		assert.isFalse(existsSync(credentialsFile()));
	});

	it("refuses a missing reference exactly as before", async () => {
		const outcome = await runOutcome(create({ profile: "p", username: "u" }));
		assert.strictEqual(outcome.exitCode, 64);
		assert.include(on(outcome.lines, "stderr").join("\n"), "A token value is never accepted");
	});

	it("refuses a missing --username/--org exactly as before", async () => {
		const outcome = await runOutcome(create({ profile: "p", op: "op://V/i/f" }));
		assert.strictEqual(outcome.exitCode, 64);
		assert.include(on(outcome.lines, "stderr").join("\n"), "--username <you>");
	});

	it("with every flag, writes and confirms on stdout", async () => {
		const outcome = await runOutcome(create({ profile: "p", op: "op://V/i/f", org: "acme" }));
		assert.strictEqual(outcome.exitCode, 0);
		assert.include(
			on(outcome.lines, "stdout").join("\n"),
			"Created profile 'p' (org: acme, github_token: op op://V/i/f)",
		);
		assert.deepStrictEqual(on(outcome.lines, "stderr"), []);
	});
});

/** A real-shaped 1Password reference over the 60-character token heuristic. */
const LONG_REFERENCE = "op://Engineering Shared Vault/GitHub Production Deploy Token/credential";

/** Where a profile lands when no credentials file exists yet: the fixture's XDG config directory. */
const xdgCredentialsFile = (): string => join(temp.home(), ".config", "reposets-ui-test", "reposets.credentials.toml");

describe("credentials create accepts a long 1Password reference", () => {
	it("by flag: a reference over 60 characters is stored, not refused as a token", async () => {
		assert.isAbove(LONG_REFERENCE.length, 60);
		const outcome = await runOutcome(create({ profile: "p", op: LONG_REFERENCE, username: "u" }));
		assert.strictEqual(outcome.exitCode, 0);
		assert.include(readFileSync(xdgCredentialsFile(), "utf8"), LONG_REFERENCE);
	});

	it("by flag: a value over 60 characters that is not a reference is still refused", async () => {
		const long = "x".repeat(61);
		const outcome = await runOutcome(create({ profile: "p", env: long, username: "u" }));
		assert.strictEqual(outcome.exitCode, 64);
		assert.notInclude(outcome.lines.map((line) => line.text).join("\n"), long);
		assert.isFalse(existsSync(xdgCredentialsFile()));
	});

	it.effect("at the prompt: a reference over 60 characters is accepted", () =>
		Effect.gen(function* () {
			const run = yield* interactive(create({ profile: "p", username: "u" }));
			yield* (yield* run.next("Where is the GitHub token?")).press("enter");
			const ref = yield* run.next("1Password reference");
			yield* ref.type(LONG_REFERENCE);
			yield* ref.press("enter");
			assert.deepStrictEqual(yield* run.done, Exit.succeed(0));
			assert.include(yield* run.session.stdout, "Created profile 'p'");
		}).pipe(Effect.scoped),
	);
});

/** A real-shaped token: the `ghp_` prefix and a 36-character alphanumeric body. */
const BARE_TOKEN = `ghp_${"A1b2C3d4E5".repeat(3)}f6G7h8`;
/** A pre-prefix GitHub classic token that is also a valid environment-variable name. */
const LEGACY_TOKEN = `a${"0123456789abcdef".repeat(2)}0123456`;

describe("credentials create catches a token wherever it sits, without catching names", () => {
	const refused = async (input: Partial<CreateInput>, value: string): Promise<void> => {
		const outcome = await runOutcome(create({ profile: "p", username: "u", ...input }));
		assert.strictEqual(outcome.exitCode, 64);
		assert.notInclude(outcome.lines.map((line) => line.text).join("\n"), value);
		assert.isFalse(existsSync(xdgCredentialsFile()));
	};

	const accepted = async (input: Partial<CreateInput>, value: string): Promise<void> => {
		const outcome = await runOutcome(create({ profile: "p", username: "u", ...input }));
		assert.strictEqual(outcome.exitCode, 0);
		assert.include(readFileSync(xdgCredentialsFile(), "utf8"), value);
	};

	it("by flag: a token pasted inside a 1Password reference is refused", async () => {
		assert.strictEqual(BARE_TOKEN.length, 40);
		const reference = `op://Private/${BARE_TOKEN}/credential`;
		await refused({ op: reference }, BARE_TOKEN);
	});

	it("by flag: a 40-hex classic token is refused as an environment variable name", async () => {
		assert.strictEqual(LEGACY_TOKEN.length, 40);
		await refused({ env: LEGACY_TOKEN }, LEGACY_TOKEN);
	});

	it("by flag: a prefix inside an ordinary name is not a token", async () => {
		await accepted({ profile: "devops_team", env: "DEVOPS_TOKEN" }, "devops_team");
		await accepted({ profile: "desk-tool", op: "op://Vault/ops_deploy_credentials/field" }, "ops_deploy_credentials");
	});

	it.effect("at the prompt: a token pasted after a typed op:// prefix is masked and refused", () =>
		Effect.gen(function* () {
			const run = yield* interactive(create({ profile: "p", username: "u" }), {
				columns: 400,
				renderPath: "production",
			});
			yield* (yield* run.next("Where is the GitHub token?")).press("enter");
			const ref = yield* run.next("1Password reference");
			yield* ref.type("op://v/");
			yield* ref.chunk({ char: BARE_TOKEN });
			yield* ref.press("enter");
			assert.include(yield* run.session.transcript, "That looks like a token, not a reference — enter where it lives.");
			for (const frame of [yield* run.session.written, yield* run.session.transcript]) {
				assert.notInclude(frame, BARE_TOKEN);
			}
			yield* ref.press("escape");
			assert.deepStrictEqual(CliUiTest.cancelReason(yield* run.done), Option.some("escape"));
			assert.isFalse(existsSync(credentialsFile()));
		}).pipe(Effect.scoped),
	);
});

describe("credentials create, interactive", () => {
	it.effect("asks for everything missing, in order, and stores a reference", () =>
		Effect.gen(function* () {
			const run = yield* interactive(create({}));
			const name = yield* run.next("Profile name");
			yield* name.type("personal");
			yield* name.press("enter");
			yield* (yield* run.next("Who does this profile act as?")).press("enter");
			const user = yield* run.next("GitHub username");
			yield* user.type("octocat");
			yield* user.press("enter");
			yield* (yield* run.next("Where is the GitHub token?")).press("enter");
			const ref = yield* run.next("1Password reference");
			yield* ref.type("op://Private/github/token");
			yield* ref.press("enter");
			assert.deepStrictEqual(yield* run.done, Exit.succeed(0));
			assert.include(
				yield* run.session.stdout,
				"Created profile 'personal' (username: octocat, github_token: op op://Private/github/token)",
			);
			// No credentials file existed, so it is created in the XDG directory
			// (the fixture's `App.layer` namespace names it).
			const file = readFileSync(join(temp.home(), ".config", "reposets-ui-test", "reposets.credentials.toml"), "utf8");
			assert.include(file, "octocat");
			assert.include(file, "op://Private/github/token");
		}).pipe(Effect.scoped),
	);

	it.effect("an organization with an environment variable", () =>
		Effect.gen(function* () {
			const run = yield* interactive(create({ profile: "ci" }));
			yield* (yield* run.next("Who does this profile act as?")).press("down", "enter");
			const org = yield* run.next("Organization name");
			yield* org.type("acme");
			yield* org.press("enter");
			yield* (yield* run.next("Where is the GitHub token?")).press("down", "enter");
			const ref = yield* run.next("Environment variable name");
			yield* ref.type("1BAD");
			yield* ref.press("enter");
			assert.include(yield* ref.plainFrame, "Letters, digits and underscores only");
			yield* ref.press("backspace", "backspace", "backspace", "backspace");
			yield* ref.type("ACME_TOKEN");
			yield* ref.press("enter");
			assert.deepStrictEqual(yield* run.done, Exit.succeed(0));
			assert.include(yield* run.session.stdout, "(org: acme, github_token: env ACME_TOKEN)");
		}).pipe(Effect.scoped),
	);

	it.effect("flags given are not asked for", () =>
		Effect.gen(function* () {
			const run = yield* interactive(create({ profile: "p", username: "u" }));
			yield* (yield* run.next("Where is the GitHub token?")).press("enter");
			const ref = yield* run.next("1Password reference");
			yield* ref.type("op://V/i/f");
			yield* ref.press("enter");
			assert.deepStrictEqual(yield* run.done, Exit.succeed(0));
			assert.strictEqual(yield* run.session.mounts, 2);
		}).pipe(Effect.scoped),
	);

	it.effect("a profile name already taken is rejected at the prompt", () =>
		Effect.gen(function* () {
			seed();
			const run = yield* interactive(create({ username: "u", op: "op://V/i/f" }));
			const name = yield* run.next("Profile name");
			yield* name.type("work");
			yield* name.press("enter");
			assert.include(yield* name.plainFrame, "Profile 'work' already exists. Delete it first.");
			yield* name.type("2");
			yield* name.press("enter");
			assert.deepStrictEqual(yield* run.done, Exit.succeed(0));
			assert.include(readFileSync(credentialsFile(), "utf8"), "work2");
		}).pipe(Effect.scoped),
	);

	it.effect("conflicting flags are refused on a terminal too, before any question", () =>
		Effect.gen(function* () {
			const run = yield* interactive(create({ op: "op://V/i/f", env: "V" }));
			const exit = yield* run.done;
			assert.isTrue(Exit.isFailure(exit));
			assert.include(String(Exit.isFailure(exit) ? exit.cause : ""), "exactly one of --op or --env");
			assert.strictEqual(yield* run.session.mounts, 0);
		}).pipe(Effect.scoped),
	);

	it.effect("a secret passed by flag is refused before any question", () =>
		Effect.gen(function* () {
			const run = yield* interactive(create({ env: SECRET }));
			const exit = yield* run.done;
			assert.isTrue(Exit.isFailure(exit));
			assert.strictEqual(yield* run.session.mounts, 0);
			assert.notInclude(String(Exit.isFailure(exit) ? exit.cause : ""), SECRET);
		}).pipe(Effect.scoped),
	);

	it.effect("Esc on the first question cancels and writes nothing", () =>
		Effect.gen(function* () {
			const run = yield* interactive(create({}));
			yield* (yield* run.next("Profile name")).press("escape");
			assert.deepStrictEqual(CliUiTest.cancelReason(yield* run.done), Option.some("escape"));
			assert.strictEqual(yield* run.session.mounts, 1);
			assert.isFalse(existsSync(credentialsFile()));
		}).pipe(Effect.scoped),
	);
});

/**
 * The reference prompt is masked, so a token pasted into it is never drawn —
 * not in any frame the terminal was sent, on either stream, not in what stays
 * on it. `validate`
 * still gets the real text, so the token is refused with the flag path's
 * explanation and never written to either stream or the file.
 *
 * Every test here renders on the production path, as a real terminal does,
 * so `written` is every byte the terminal received and `clear: true` is
 * observable in `transcript`.
 */
describe("credentials create never echoes a secret pasted into the prompt", () => {
	const production = { columns: 400, renderPath: "production" } as const;

	for (const kind of ["1Password reference", "Environment variable name"] as const) {
		it.effect(`${kind}: a pasted token is masked in every frame, refused, never printed, never stored`, () =>
			Effect.gen(function* () {
				const run = yield* interactive(create({ profile: "p", username: "u" }), production);
				const source = yield* run.next("Where is the GitHub token?");
				yield* kind === "1Password reference" ? source.press("enter") : source.press("down", "enter");
				const ref = yield* run.next(kind);
				// A paste: the whole token in one write.
				yield* ref.chunk({ char: SECRET });
				yield* ref.press("enter");
				// `validate` saw the real text and refused it.
				assert.include(
					yield* run.session.transcript,
					"That looks like a token, not a reference — enter where it lives.",
				);
				// …while the frames drew only the mask: never the token, nor a
				// prefix of it long enough to identify it.
				const written = yield* run.session.written;
				assert.include(written, "•".repeat(SECRET.length));
				for (const frame of [
					written,
					yield* run.session.stdoutWritten,
					yield* run.session.stderrWritten,
					yield* run.session.transcript,
				]) {
					assert.notInclude(frame, SECRET);
					assert.notInclude(frame, "ghp_");
				}
				yield* ref.press("escape");
				assert.deepStrictEqual(CliUiTest.cancelReason(yield* run.done), Option.some("escape"));

				assert.notInclude(yield* run.session.written, "ghp_");
				assert.notInclude(yield* run.session.stdout, SECRET);
				assert.notInclude(yield* run.session.stderr, SECRET);
				assert.isFalse(existsSync(credentialsFile()));
			}).pipe(Effect.scoped),
		);
	}

	it.effect("a token typed by hand shows at most its public prefix before the mask trips", () =>
		Effect.gen(function* () {
			const run = yield* interactive(create({ profile: "p", username: "u" }), production);
			yield* (yield* run.next("Where is the GitHub token?")).press("enter");
			const ref = yield* run.next("1Password reference");
			yield* ref.type(SECRET);
			// `g`, `gh`, `ghp` are drawn before the rule recognises `ghp_`; from
			// there on the whole value is masked, so nothing past the prefix is.
			const written = yield* run.session.written;
			assert.notInclude(written, "ghp_");
			assert.notInclude(written, TAIL);
			assert.include(written, "•".repeat(SECRET.length));
			yield* ref.press("escape");
			yield* run.done;
		}).pipe(Effect.scoped),
	);

	for (const [kind, select, reference] of [
		["1Password reference", ["enter"], "op://Private/github/token"],
		["Environment variable name", ["down", "enter"], "ACME_TOKEN"],
	] as const) {
		it.effect(`${kind}: deleting a pasted token's prefix does not unmask the rest`, () =>
			Effect.gen(function* () {
				const run = yield* interactive(create({ profile: "p", username: "u" }), production);
				yield* (yield* run.next("Where is the GitHub token?")).press(...select);
				const ref = yield* run.next(kind);
				yield* ref.chunk({ char: SECRET });
				// "hp_ACTUAL…", then "ACTUAL…": no prefix left for the rule to see.
				yield* ref.press("home", "delete");
				yield* ref.press("delete", "delete", "delete");
				for (const view of yield* views(run)) {
					assert.notInclude(view, TAIL);
					assert.notInclude(view, "hp_ACTUAL");
				}
				yield* ref.press("escape");
				yield* run.done;
			}).pipe(Effect.scoped),
		);

		it.effect(`${kind}: emptying the field releases the mask`, () =>
			Effect.gen(function* () {
				const run = yield* interactive(create({ profile: "p", username: "u" }), production);
				yield* (yield* run.next("Where is the GitHub token?")).press(...select);
				const ref = yield* run.next(kind);
				yield* ref.chunk({ char: SECRET });
				yield* ref.press(...Array.from({ length: SECRET.length }, () => "backspace" as const));
				yield* ref.type(reference);
				assert.include(yield* run.session.written, reference);
				yield* ref.press("enter");
				assert.deepStrictEqual(yield* run.done, Exit.succeed(0));
				assert.notInclude(yield* run.session.written, TAIL);
			}).pipe(Effect.scoped),
		);

		it.effect(`${kind}: a real reference stays readable while typed`, () =>
			Effect.gen(function* () {
				const run = yield* interactive(create({ profile: "p", username: "u" }), production);
				yield* (yield* run.next("Where is the GitHub token?")).press(...select);
				const ref = yield* run.next(kind);
				yield* ref.type(reference);
				assert.include(yield* run.session.written, reference);
				assert.notInclude(yield* run.session.written, "•");
				yield* ref.press("enter");
				assert.deepStrictEqual(yield* run.done, Exit.succeed(0));
			}).pipe(Effect.scoped),
		);
	}

	it.effect("the frame detector can fail: an unmasked prompt's typed text does reach `written`", () =>
		Effect.gen(function* () {
			const run = yield* interactive(create({ username: "u", env: "ACME_TOKEN" }), production);
			const name = yield* run.next("Profile name");
			yield* name.type("visible_name");
			assert.include(yield* run.session.written, "visible_name");
			yield* name.press("escape");
			yield* run.done;
		}).pipe(Effect.scoped),
	);

	it.effect("a cleared prompt leaves nothing on the terminal, though it was drawn", () =>
		Effect.gen(function* () {
			const run = yield* interactive(create({ profile: "p", username: "u" }), production);
			yield* (yield* run.next("Where is the GitHub token?")).press("down", "enter");
			const ref = yield* run.next("Environment variable name");
			yield* ref.type("ACME_TOKEN");
			yield* ref.press("enter");
			assert.deepStrictEqual(yield* run.done, Exit.succeed(0));
			// Drawn: the terminal was sent the prompt.
			assert.include(yield* run.session.written, "Environment variable name");
			// Cleared: what stays on the terminal does not hold it.
			assert.notInclude(yield* run.session.transcript, "Environment variable name");
			// The accepted answer is recorded in the confirmation instead.
			assert.include(yield* run.session.stdout, "github_token: env ACME_TOKEN");
		}).pipe(Effect.scoped),
	);

	it.effect("the leak detector can fail: a program's write does reach the session's stdout", () =>
		Effect.gen(function* () {
			const run = yield* interactive(Console.log(`rejected: ${SECRET}`));
			assert.deepStrictEqual(yield* run.done, Exit.succeed(0));
			assert.include(yield* run.session.stdout, SECRET);
		}).pipe(Effect.scoped),
	);
});

/**
 * A token pasted into a *name* — the profile name, the username, the org — is
 * as bad as one pasted into the reference: the profile name becomes a TOML key,
 * the owner a stored value, and both are printed in the confirmation.
 */
describe("credentials create refuses a secret in any name, without echoing it", () => {
	for (const [flag, input] of [
		["--profile", { profile: SECRET, username: "u", op: "op://V/i/f" }],
		["--username", { profile: "p", username: SECRET, op: "op://V/i/f" }],
		["--org", { profile: "p", org: SECRET, op: "op://V/i/f" }],
	] as const) {
		it(`${flag} given a token: exit 64, the flag path's explanation, nothing stored or echoed`, async () => {
			const outcome = await runOutcome(create(input));
			assert.strictEqual(outcome.exitCode, 64);
			assert.include(on(outcome.lines, "stderr").join("\n"), "That looks like a credential value, not a reference.");
			assert.notInclude(JSON.stringify(outcome.lines), SECRET);
			assert.isFalse(existsSync(credentialsFile()));
		});
	}

	it.effect("--profile given a token on a terminal: refused before any question", () =>
		Effect.gen(function* () {
			const run = yield* interactive(create({ profile: SECRET }));
			const exit = yield* run.done;
			assert.isTrue(Exit.isFailure(exit));
			assert.strictEqual(yield* run.session.mounts, 0);
		}).pipe(Effect.scoped),
	);

	for (const [prompt, input, before] of [
		["Profile name", { username: "u", op: "op://V/i/f" }, undefined],
		["GitHub username", { profile: "p", op: "op://V/i/f" }, "enter"],
		["Organization name", { profile: "p", op: "op://V/i/f" }, "down"],
	] as const) {
		it.effect(`a token typed as the ${prompt} is refused in the screen, never printed, never stored`, () =>
			Effect.gen(function* () {
				// 80 columns, as a default terminal: the refusal must fit.
				const run = yield* interactive(create(input), { columns: 80 });
				if (before !== undefined) {
					const actsAs = yield* run.next("Who does this profile act as?");
					yield* before === "down" ? actsAs.press("down", "enter") : actsAs.press("enter");
				}
				const field = yield* run.next(prompt);
				yield* field.type(SECRET);
				yield* field.press("enter");
				assert.include(yield* field.plainFrame, "That looks like a token, not a name. It was not stored.");
				yield* field.press("escape");
				assert.deepStrictEqual(CliUiTest.cancelReason(yield* run.done), Option.some("escape"));
				assert.notInclude(yield* run.session.stdout, SECRET);
				assert.notInclude(yield* run.session.stderr, SECRET);
				assert.isFalse(existsSync(credentialsFile()));
			}).pipe(Effect.scoped),
		);
	}

	it.effect("the reference prompt's refusal fits an 80-column terminal", () =>
		Effect.gen(function* () {
			const run = yield* interactive(create({ profile: "p", username: "u" }), { columns: 80 });
			yield* (yield* run.next("Where is the GitHub token?")).press("enter");
			const ref = yield* run.next("1Password reference");
			yield* ref.type(SECRET);
			yield* ref.press("enter");
			assert.include(yield* ref.plainFrame, "That looks like a token, not a reference — enter where it lives.");
			yield* ref.press("escape");
			yield* run.done;
		}).pipe(Effect.scoped),
	);
});

describe("credentials delete", () => {
	it("refuses a missing --profile when not interactive: exit 64, names the flag", async () => {
		seed();
		const outcome = await runOutcome(remove(undefined));
		assert.strictEqual(outcome.exitCode, 64);
		assert.include(on(outcome.lines, "stderr").join("\n"), "--profile");
		assert.include(readFileSync(credentialsFile(), "utf8"), "[profiles.work]");
	});

	it("refuses a token passed to --profile without echoing it: exit 64", async () => {
		seed();
		const outcome = await runOutcome(remove(SECRET));
		assert.strictEqual(outcome.exitCode, 64);
		assert.notInclude(JSON.stringify(outcome.lines), SECRET);
	});

	it.effect("picks from the existing profiles, showing owner and reference", () =>
		Effect.gen(function* () {
			seed();
			const run = yield* interactive(remove(undefined));
			const picker = yield* run.next("Delete which profile?");
			// A `Select` shows the highlighted choice's detail only.
			assert.include(yield* picker.plainFrame, "me (user) · github_token: op op://Private/github/token");
			yield* picker.press("down");
			assert.include(yield* picker.plainFrame, "acme (organization) · github_token: env ACME_TOKEN");
			yield* picker.press("enter");
			assert.deepStrictEqual(yield* run.done, Exit.succeed(0));
			assert.include(yield* run.session.stdout, "Deleted profile 'work'");
			const file = readFileSync(credentialsFile(), "utf8");
			assert.notInclude(file, "acme");
			assert.include(file, "personal");
		}).pipe(Effect.scoped),
	);

	it.effect("with no profiles says so and succeeds without a screen", () =>
		Effect.gen(function* () {
			const run = yield* interactive(remove(undefined));
			assert.deepStrictEqual(yield* run.done, Exit.succeed(0));
			assert.strictEqual(yield* run.session.mounts, 0);
			assert.include(yield* run.session.stdout, "No credential profiles configured");
		}).pipe(Effect.scoped),
	);

	it.effect("Esc on the picker cancels and deletes nothing", () =>
		Effect.gen(function* () {
			seed();
			const run = yield* interactive(remove(undefined));
			yield* (yield* run.next("Delete which profile?")).press("escape");
			assert.deepStrictEqual(CliUiTest.cancelReason(yield* run.done), Option.some("escape"));
			assert.include(readFileSync(credentialsFile(), "utf8"), "[profiles.work]");
		}).pipe(Effect.scoped),
	);
});

describe("credentials list", () => {
	it("prints one plain section per profile on stdout", async () => {
		seed();
		const outcome = await runOutcome(list());
		const out = on(outcome.lines, "stdout").join("\n");
		assert.include(out, "[personal]");
		assert.include(out, "acts as: me (user)");
		assert.include(out, "github_token: env ACME_TOKEN");
		assert.notInclude(out, "\u001b[");
		assert.deepStrictEqual(on(outcome.lines, "stderr"), []);
	});
});
