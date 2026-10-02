import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, layer } from "@effect/vitest";
import type { Sandbox } from "@effected/cli/testing";
import { CliTest } from "@effected/cli/testing";
import { Effect, FileSystem, Path } from "effect";

/**
 * The exit-code and stream contract, against the bin that ships.
 *
 * @remarks
 * The handler suites pin what each command prints and which code it asks for.
 * Whether that becomes the right process exit code, with each line on the right
 * stream, is a property of the built artifact wired through `CliRuntime.main`
 * and the real Node platform layer — so these spawn `dist/dev/pkg/bin/reposets.js`
 * with `CliTest`.
 *
 * `CliTest.sandbox` mints a temp directory with a fresh `HOME` and
 * `XDG_*_HOME`, and passes nothing else from the host environment except the
 * `PATH` given here — so no run can read or write the developer's real config,
 * credentials or state database, and nothing here sets a `process.env` key.
 *
 * The root `globalSetup` builds the dev target before any suite runs. If the
 * bin is still missing (a build failure, or a filtered run that skipped setup),
 * the suite is skipped with that reason rather than failing on a spawn error
 * that names nothing useful.
 */
const BIN = fileURLToPath(new URL("../../dist/dev/pkg/bin/reposets.js", import.meta.url));
const BUILT = existsSync(BIN);

/** A config with one misspelled group key — strict decoding rejects it. */
const TYPO_CONFIG = `[groups.g]
repos = ["r"]
credentials = "p"
cleanp = true
`;

const VALID_CONFIG = `[groups.g]
repos = ["r"]
credentials = "p"
`;

const CREDENTIALS = `[profiles.p]
username = "acme"
github_token = { env = "GH" }
`;

/** Write `contents` into the sandbox and return its absolute path. */
const fixture = (sandbox: Sandbox, name: string, contents: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const file = path.join(sandbox.root, name);
		yield* fs.writeFileString(file, contents);
		return file;
	});

/** Spawn the bin inside a fresh sandbox. */
const reposets = (
	args: ReadonlyArray<string>,
	setup?: (sandbox: Sandbox) => Effect.Effect<ReadonlyArray<string>, unknown, FileSystem.FileSystem | Path.Path>,
) =>
	Effect.gen(function* () {
		const sandbox = yield* CliTest.sandbox({ path: process.env.PATH ?? "" });
		const extra = setup === undefined ? [] : yield* setup(sandbox);
		return yield* CliTest.run(BIN, [...args, ...extra], { sandbox, execPath: process.execPath });
	});

describe.skipIf(!BUILT)(`reposets bin (${BUILT ? "built" : `SKIPPED: ${BIN} not built — run pnpm run build`})`, () => {
	// Real processes and a real clock: `TestClock` would stall any timeout in
	// the child-process plumbing, so the test services are excluded.
	layer(NodeServices.layer, { excludeTestServices: true })((it) => {
		it.effect(
			"--help exits 0 with the help on stdout",
			() =>
				Effect.gen(function* () {
					const result = yield* reposets(["--help"]);
					assert.strictEqual(result.exitCode, 0);
					assert.include(result.stdout, "validate");
					assert.strictEqual(result.stderr, "");
				}).pipe(Effect.scoped),
			30_000,
		);

		it.effect(
			"an unknown subcommand is a usage error: exit 64, nothing on stdout",
			() =>
				Effect.gen(function* () {
					const result = yield* reposets(["bogus"]);
					assert.strictEqual(result.exitCode, 64);
					assert.strictEqual(result.stdout, "");
					assert.notStrictEqual(result.stderr, "");
				}).pipe(Effect.scoped),
			30_000,
		);

		it.effect(
			"an unknown flag is a usage error: exit 64, nothing on stdout",
			() =>
				Effect.gen(function* () {
					const result = yield* reposets(["validate", "--bogus"]);
					assert.strictEqual(result.exitCode, 64);
					assert.strictEqual(result.stdout, "");
					assert.include(result.stderr, "bogus");
				}).pipe(Effect.scoped),
			30_000,
		);

		it.effect(
			"an unknown --only phase is a usage error: exit 64, printed once, nothing on stdout",
			() =>
				Effect.gen(function* () {
					const result = yield* reposets(["sync", "--only", "nonsense"]);
					assert.strictEqual(result.exitCode, 64);
					assert.strictEqual(result.stdout, "");
					assert.strictEqual(result.stderr.split("Unknown phase name(s): nonsense").length - 1, 1);
				}).pipe(Effect.scoped),
			30_000,
		);

		it.effect(
			"validate on a config with an unknown key: exit 1, the issue and the doctor hint on stderr, stdout empty",
			() =>
				Effect.gen(function* () {
					const result = yield* reposets(["validate"], (sandbox) =>
						Effect.map(fixture(sandbox, "typo.toml", TYPO_CONFIG), (file) => ["--config", file]),
					);
					assert.strictEqual(result.exitCode, 1);
					assert.strictEqual(result.stdout, "");
					// The kit draws the issue as a tree of rejected keys; the hint is reposets' own.
					assert.include(result.stderr, "cleanp: unknown key");
					assert.strictEqual(result.stderr.split("Run 'reposets doctor' for suggested spellings.").length, 2);
				}).pipe(Effect.scoped),
			30_000,
		);

		it.effect(
			"validate on a valid config: exit 0, the result on stdout",
			() =>
				Effect.gen(function* () {
					const result = yield* reposets(["validate"], (sandbox) =>
						Effect.gen(function* () {
							yield* fixture(sandbox, "reposets.credentials.toml", CREDENTIALS);
							const file = yield* fixture(sandbox, "valid.toml", VALID_CONFIG);
							return ["--config", file];
						}),
					);
					assert.strictEqual(result.exitCode, 0);
					assert.match(result.stdout, /^Valid: .*valid\.toml\n {2}groups: 1\n$/);
					assert.strictEqual(result.stderr, "");
				}).pipe(Effect.scoped),
			30_000,
		);

		it.effect(
			"list on a valid config: exit 0, the summary on stdout",
			() =>
				Effect.gen(function* () {
					const result = yield* reposets(["list"], (sandbox) =>
						Effect.gen(function* () {
							yield* fixture(sandbox, "reposets.credentials.toml", CREDENTIALS);
							const file = yield* fixture(sandbox, "valid.toml", VALID_CONFIG);
							return ["--config", file];
						}),
					);
					assert.strictEqual(result.exitCode, 0);
					assert.include(result.stdout, "[g] (owner: acme, credentials: p)");
					assert.include(result.stdout, "  - acme/r");
					assert.strictEqual(result.stderr, "");
				}).pipe(Effect.scoped),
			30_000,
		);
	});
});
