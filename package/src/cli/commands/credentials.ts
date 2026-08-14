import { AppDirs } from "@effected/xdg";
import { Effect, Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import type { CredentialProfile, CredentialSource, Credentials } from "../../schemas/credentials.js";
import { profileOwner } from "../../schemas/credentials.js";
import { ReposetsCredentialsFile } from "../../services/ConfigFiles.js";

const EMPTY: Credentials = { profiles: {} };

const profileFlag = Flag.string("profile").pipe(Flag.withDescription("Credential profile name"));

const opFlag = Flag.string("op").pipe(
	Flag.withDescription('1Password secret reference, e.g. "op://Vault/item/field"'),
	Flag.optional,
);

const envFlag = Flag.string("env").pipe(
	Flag.withDescription('Name of an environment variable holding the token, e.g. "REPOSETS_GITHUB_TOKEN"'),
	Flag.optional,
);

const usernameFlag = Flag.string("username").pipe(
	Flag.withDescription("The personal account this profile acts as. Mutually exclusive with --org"),
	Flag.optional,
);

const orgFlag = Flag.string("org").pipe(
	Flag.withDescription("The organization this profile acts within. Mutually exclusive with --username"),
	Flag.optional,
);

/**
 * Recognisable credential prefixes, so an obvious paste-in-the-wrong-place is
 * caught rather than stored.
 *
 * @remarks
 * A heuristic, not a guarantee — `--env` legitimately takes a bare identifier
 * and a token can look like one. It costs nothing and catches the mistake this
 * command's entire premise is built to prevent.
 */
const SECRET_PREFIXES = ["ghp_", "gho_", "ghu_", "ghs_", "ghr_", "github_pat_", "ops_", "sk-", "xoxb-"];

const looksLikeSecret = (value: string): boolean =>
	SECRET_PREFIXES.some((prefix) => value.startsWith(prefix)) || value.length > 60;

/**
 * Write credentials back to the file they were read from.
 *
 * @remarks
 * `ConfigFileShape.save` resolves its own default path — the XDG one — rather
 * than the path `discover` found. With a project-local
 * `reposets.credentials.toml` present, that splits reads from writes: `create`
 * lands in XDG while `list` keeps reading the local file, so a profile is
 * created that the user cannot see and that sync will not use. Writing back to
 * the discovered source keeps one file authoritative, and falls back to `save`
 * only when there is genuinely nothing to update.
 */
const saveWhereRead = (
	file: {
		readonly discover: Effect.Effect<ReadonlyArray<{ readonly path: string }>, unknown>;
		readonly write: (value: Credentials, path: string) => Effect.Effect<void, unknown>;
		readonly save: (value: Credentials) => Effect.Effect<string, unknown>;
	},
	value: Credentials,
): Effect.Effect<string, unknown> =>
	Effect.gen(function* () {
		const sources = yield* file.discover.pipe(
			Effect.orElseSucceed(() => [] as ReadonlyArray<{ readonly path: string }>),
		);
		const existing = sources[0];
		if (existing === undefined) {
			return yield* file.save(value);
		}
		yield* file.write(value, existing.path);
		return existing.path;
	});

/** How a profile's `github_token` is sourced, for display. Never a value. */
const describeSource = (source: CredentialSource): string => ("op" in source ? `op ${source.op}` : `env ${source.env}`);

/**
 * `reposets credentials create` — record a *reference* to a GitHub token.
 *
 * @remarks
 * **This command never accepts a token.** v3 took `--github-token` and
 * `--op-token` and wrote both into the file; the schema now stores a reference
 * and nothing else, so there is no field to put a secret in and no prompt that
 * would read one. `--op` names a 1Password item, `--env` names an environment
 * variable — both are addresses, safe to appear in shell history and in this
 * command's own output.
 *
 * `op_service_account_token` is likewise not accepted: it comes from the
 * environment, so there is nothing to write here.
 *
 * @public
 */
export const createHandler = (input: {
	readonly profile: string;
	readonly op: string | undefined;
	readonly env: string | undefined;
	readonly username: string | undefined;
	readonly org: string | undefined;
}) =>
	Effect.gen(function* () {
		const { profile, op, env, username, org } = input;
		const appDirs = yield* AppDirs;
		yield* appDirs.ensureConfig;

		const credentialsFile = yield* ReposetsCredentialsFile;

		if (op !== undefined && env !== undefined) {
			yield* Effect.logError("Provide exactly one of --op or --env, not both.");
			return;
		}
		if (op === undefined && env === undefined) {
			yield* Effect.logError(
				'Provide a reference: --op "op://Vault/item/field" or --env REPOSETS_GITHUB_TOKEN. A token value is never accepted.',
			);
			return;
		}
		// Nothing supplied to this command is echoed back. A user who
		// mistakenly pastes a real token into --op or --env has already put it
		// in their shell history; repeating it into the log — and into
		// whatever the log is piped to — is the one thing this command can
		// still do to make that worse.
		if (op !== undefined && !op.startsWith("op://")) {
			yield* Effect.logError('--op must be a 1Password reference starting with "op://". Value not echoed.');
			return;
		}
		if (looksLikeSecret(op ?? env ?? "")) {
			yield* Effect.logError(
				"That looks like a credential value, not a reference. This command stores references only — " +
					'pass --op "op://Vault/item/field" or --env VAR_NAME. Value not echoed.',
			);
			return;
		}

		// Exactly one, checked here rather than left to the schema, so the
		// message names the flags the user typed instead of describing a union
		// they never see.
		if (username !== undefined && org !== undefined) {
			yield* Effect.logError("Provide exactly one of --username or --org, not both.");
			return;
		}
		if (username === undefined && org === undefined) {
			yield* Effect.logError(
				"Provide --username <you> for a personal account or --org <name> for an organization. " +
					"It is what the profile acts as, and it decides which settings are even valid.",
			);
			return;
		}

		const existing = yield* credentialsFile.loadOrDefault(EMPTY);
		if (existing.profiles[profile] !== undefined) {
			yield* Effect.logError(`Profile '${profile}' already exists. Delete it first.`);
			return;
		}

		const github_token = op !== undefined ? { op } : { env: env as string };
		const actsAs: CredentialProfile =
			username !== undefined ? { username, github_token } : { org: org as string, github_token };

		const path = yield* saveWhereRead(credentialsFile, {
			profiles: { ...existing.profiles, [profile]: actsAs },
		});

		yield* Effect.log(
			`Created profile '${profile}' (${username !== undefined ? `username: ${username}` : `org: ${org as string}`}, ` +
				`github_token: ${describeSource(github_token)}) in ${path}.`,
		);
	});

const createCommand = Command.make(
	"create",
	{ profile: profileFlag, op: opFlag, env: envFlag, username: usernameFlag, org: orgFlag },
	({ profile, op, env, username, org }) =>
		createHandler({
			profile,
			op: Option.getOrUndefined(op),
			env: Option.getOrUndefined(env),
			username: Option.getOrUndefined(username),
			org: Option.getOrUndefined(org),
		}),
).pipe(Command.withDescription("Add a credential profile holding a reference to a GitHub token"));

/**
 * `reposets credentials list` — the profiles and what they point at.
 *
 * @remarks
 * There is nothing to redact. The file holds references, so printing it in full
 * discloses which vault items and environment variables reposets reads, never
 * their contents — which is exactly what someone running this needs to see.
 *
 * @public
 */
export const listHandler = Effect.gen(function* () {
	const credentialsFile = yield* ReposetsCredentialsFile;
	const credentials = yield* credentialsFile.loadOrDefault(EMPTY);

	const names = Object.keys(credentials.profiles);
	if (names.length === 0) {
		yield* Effect.log("No credential profiles configured.");
		return;
	}

	for (const [name, profile] of Object.entries(credentials.profiles)) {
		const { owner, ownerType } = profileOwner(profile);
		yield* Effect.log(`[${name}]`);
		yield* Effect.log(`  acts as: ${owner} (${ownerType === "User" ? "user" : "organization"})`);
		yield* Effect.log(`  github_token: ${describeSource(profile.github_token)}`);
		for (const kind of ["op", "env", "file"] as const) {
			const entries = profile.resolve?.[kind];
			if (entries === undefined) continue;
			for (const [label, reference] of Object.entries(entries)) {
				yield* Effect.log(`  resolve.${kind}.${label}: ${reference}`);
			}
		}
		yield* Effect.log("");
	}
});

const listCommand = Command.make("list", {}, () => listHandler).pipe(
	Command.withDescription("List credential profiles and the references they hold"),
);

/**
 * `reposets credentials delete` — remove a profile.
 *
 * @public
 */
export const deleteHandler = (profile: string) =>
	Effect.gen(function* () {
		const appDirs = yield* AppDirs;
		yield* appDirs.ensureConfig;

		const credentialsFile = yield* ReposetsCredentialsFile;
		const credentials = yield* credentialsFile.loadOrDefault(EMPTY);

		if (credentials.profiles[profile] === undefined) {
			yield* Effect.logError(`Profile '${profile}' not found.`);
			return;
		}

		const { [profile]: _removed, ...remaining } = credentials.profiles;
		const path = yield* saveWhereRead(credentialsFile, { profiles: remaining });

		yield* Effect.log(`Deleted profile '${profile}' from ${path}.`);
	});

const deleteCommand = Command.make("delete", { profile: profileFlag }, ({ profile }) => deleteHandler(profile)).pipe(
	Command.withDescription("Remove a credential profile"),
);

/**
 * `reposets credentials` — manage `reposets.credentials.toml`.
 *
 * @public
 */
export const credentialsCommand = Command.make("credentials", {}, () => Effect.void).pipe(
	Command.withDescription("Manage credential profiles (references only — never token values)"),
	Command.withSubcommands([createCommand, listCommand, deleteCommand]),
);
