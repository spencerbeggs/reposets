import type { Cancelled, CliTheme } from "@effected/cli";
import { CliInteractive, CliMessage, Doc } from "@effected/cli";
import type { Screen } from "@effected/cli/ui";
import { CliUi, Select, TextInput } from "@effected/cli/ui";
import { AppDirs } from "@effected/xdg";
import { Effect, Option } from "effect";
import { CliError, Command, Flag } from "effect/cli";
import type { CredentialProfile, CredentialSource, Credentials } from "../../schemas/credentials.js";
import { profileOwner } from "../../schemas/credentials.js";
import { ReposetsCredentialsFile } from "../../services/ConfigFiles.js";

const EMPTY: Credentials = { profiles: {} };

/**
 * Optional on both `create` and `delete`: an interactive run asks for a
 * missing name, a non-interactive one is refused with a message naming the
 * flag, exactly as a missing required flag would be (exit 64).
 */
const profileFlag = Flag.String("profile").pipe(
	Flag.optional,
	Flag.withDescription("Credential profile name. Asked when omitted on a terminal"),
);

const opFlag = Flag.String("op").pipe(
	Flag.optional,
	Flag.withDescription('1Password secret reference, e.g. "op://Vault/item/field"'),
);

const envFlag = Flag.String("env").pipe(
	Flag.optional,
	Flag.withDescription('Name of an environment variable holding the token, e.g. "REPOSETS_GITHUB_TOKEN"'),
);

const usernameFlag = Flag.String("username").pipe(
	Flag.optional,
	Flag.withDescription("The personal account this profile acts as. Mutually exclusive with --org"),
);

const orgFlag = Flag.String("org").pipe(
	Flag.optional,
	Flag.withDescription("The organization this profile acts within. Mutually exclusive with --username"),
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

/**
 * Whether a value looks like a pasted token rather than a reference or a name.
 *
 * @remarks
 * A known token prefix, or anything longer than 60 characters. The length rule
 * catches the tokens that carry no recognisable prefix, but it never applies to
 * an `op://` value: that is a 1Password reference by construction, none of the
 * token prefixes begins that way, and a real reference crosses 60 characters
 * easily once a vault or item name has spaces in it
 * (`op://Engineering Shared Vault/GitHub Production Deploy Token/credential`).
 */
const looksLikeSecret = (value: string): boolean =>
	SECRET_PREFIXES.some((prefix) => value.startsWith(prefix)) || (!value.startsWith("op://") && value.length > 60);

/**
 * The explanation for a flag value {@link looksLikeSecret} catches — in any
 * flag, since a token pasted into `--profile` or `--username` would otherwise
 * be stored as a TOML key and printed back in the confirmation. It never
 * contains the value.
 */
const LOOKS_LIKE_SECRET =
	"That looks like a credential value, not a reference. This command stores references only — " +
	'pass --op "op://Vault/item/field" or --env VAR_NAME. Value not echoed.';

/**
 * The prompt path's versions of {@link LOOKS_LIKE_SECRET}.
 *
 * @remarks
 * Shorter, because a widget truncates its validation line to the terminal and
 * the flag path's explanation loses its point at 80 columns; and phrased for
 * someone typing into a field rather than passing a flag. Neither contains
 * the value.
 */
const SECRET_IN_REFERENCE = "That looks like a token, not a reference — enter where it lives.";
const SECRET_IN_NAME = "That looks like a token, not a name. It was not stored.";

/** What `--env` names, and what the prompt accepts for it: a shell variable identifier. */
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

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

/**
 * Refuse an invocation the user got wrong.
 *
 * @remarks
 * Every refusal in this module is a usage error — the flags asked for
 * something invalid — so it fails with `CliError.UserError` and exits 64.
 * `Command.runWith` prints the message once, on stderr. The messages never
 * echo a supplied value, for the reason given in {@link createHandler}.
 */
const refuse = (message: string): Effect.Effect<never, CliError.UserError> =>
	Effect.fail(new CliError.UserError({ cause: message }));

/** How a profile's `github_token` is sourced, for display. Never a value. */
const describeSource = (source: CredentialSource): string => ("op" in source ? `op ${source.op}` : `env ${source.env}`);

/**
 * Show a screen, mapping "nobody is there to answer" to a refusal.
 *
 * @remarks
 * The handlers decide interactivity up front with `CliInteractive` and refuse
 * before any screen when a run cannot prompt, so the `NotInteractive` mapped
 * here is defensive: should a screen ever be reached in such a run, it is the
 * same usage error (exit 64) naming the flag that would have answered it.
 * A cancel is the kit's `Cancelled` and is left alone, so `CliRuntime.main`
 * renders it as one line and exits 130.
 */
const ask = <A>(
	screen: Screen<A>,
	refusal: string,
	options?: { readonly clear?: boolean },
): Effect.Effect<A, Cancelled | CliError.UserError, CliTheme> =>
	CliUi.run(screen, options).pipe(Effect.catchTag("NotInteractive", () => refuse(refusal)));

const MISSING_REFERENCE =
	'Provide a reference: --op "op://Vault/item/field" or --env REPOSETS_GITHUB_TOKEN. A token value is never accepted.';
const MISSING_ACTS_AS =
	"Provide --username <you> for a personal account or --org <name> for an organization. " +
	"It is what the profile acts as, and it decides which settings are even valid.";
const MISSING_PROFILE = "Provide --profile <name>: the name a group's 'credentials' field refers to.";

/**
 * Validate a token reference typed at the prompt.
 *
 * @remarks
 * The secret check runs first and on both kinds, so a pasted token is called
 * a token rather than getting a complaint about its shape. Every message here
 * fits a narrow terminal, is shown inside the screen, and none contains the
 * typed value.
 */
const validateReference =
	(kind: "op" | "env") =>
	(value: string): string | undefined => {
		if (value === "") return "A reference is required.";
		if (looksLikeSecret(value)) return SECRET_IN_REFERENCE;
		if (kind === "op" && !value.startsWith("op://")) {
			return 'A 1Password reference starts with "op://".';
		}
		if (kind === "env" && !ENV_NAME.test(value)) {
			return "Letters, digits and underscores only, not starting with a digit.";
		}
		return undefined;
	};

/**
 * A name typed at a prompt: anything but blank, and never a token.
 *
 * @remarks
 * A profile name becomes a TOML key and an owner name a stored value, and both
 * are printed in the confirmation — so a token pasted into either field would
 * be written to disk and echoed, the exact outcome the reference prompt
 * guards against.
 */
const validName =
	(what: string) =>
	(value: string): string | undefined =>
		value.trim() === "" ? `${what} is required.` : looksLikeSecret(value) ? SECRET_IN_NAME : undefined;

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
 * Whatever the flags leave out, an interactive run asks for, in order: the
 * profile name, who it acts as (personal account or organization, then the
 * name), and where the token is (1Password or an environment variable, then
 * the reference). The flags given are validated **before** any question, so a
 * person is never walked through a wizard only to be refused for a flag; two
 * conflicting flags (`--op` with `--env`, `--username` with `--org`) are
 * refused even on a terminal, since there is no question that resolves them.
 * A non-interactive run is refused exactly as before, the message naming the
 * flag to pass (exit 64).
 *
 * A token can be pasted into any text field, not only the reference: every
 * value — each flag and each typed answer — is checked with `looksLikeSecret`
 * and refused without being repeated, so nothing token-shaped becomes a
 * profile key, an owner or a reference, or reaches the confirmation line. The
 * text prompts' frames are cleared when they close, so a token typed and then
 * abandoned is not left in the terminal's scrollback; the accepted answers are
 * recorded in the confirmation line instead. While a value is being typed it
 * is visible — the kit's `TextInput` has no masked mode.
 *
 * `op_service_account_token` is likewise not accepted: it comes from the
 * environment, so there is nothing to write here.
 *
 * @public
 */
export const createHandler = (input: {
	readonly profile: string | undefined;
	readonly op: string | undefined;
	readonly env: string | undefined;
	readonly username: string | undefined;
	readonly org: string | undefined;
}) =>
	Effect.gen(function* () {
		const { op, env, username, org } = input;
		const appDirs = yield* AppDirs;
		yield* appDirs.ensureConfig;

		const credentialsFile = yield* ReposetsCredentialsFile;

		if (op !== undefined && env !== undefined) {
			return yield* refuse("Provide exactly one of --op or --env, not both.");
		}
		const interactive = yield* CliInteractive;
		if (op === undefined && env === undefined && !interactive) {
			return yield* refuse(MISSING_REFERENCE);
		}
		// Nothing supplied to this command is echoed back. A user who
		// mistakenly pastes a real token into --op or --env has already put it
		// in their shell history; repeating it into the log — and into
		// whatever the log is piped to — is the one thing this command can
		// still do to make that worse.
		if (op !== undefined && !op.startsWith("op://")) {
			return yield* refuse('--op must be a 1Password reference starting with "op://". Value not echoed.');
		}
		if ([op, env, input.profile, username, org].some((value) => value !== undefined && looksLikeSecret(value))) {
			return yield* refuse(LOOKS_LIKE_SECRET);
		}

		// Exactly one, checked here rather than left to the schema, so the
		// message names the flags the user typed instead of describing a union
		// they never see.
		if (username !== undefined && org !== undefined) {
			return yield* refuse("Provide exactly one of --username or --org, not both.");
		}
		if (username === undefined && org === undefined && !interactive) {
			return yield* refuse(MISSING_ACTS_AS);
		}
		if (input.profile === undefined && !interactive) {
			return yield* refuse(MISSING_PROFILE);
		}

		const existing = yield* credentialsFile.loadOrDefault(EMPTY);
		const taken = (name: string): string | undefined =>
			existing.profiles[name] === undefined ? undefined : `Profile '${name}' already exists. Delete it first.`;

		if (input.profile !== undefined) {
			const problem = taken(input.profile);
			if (problem !== undefined) return yield* refuse(problem);
		}

		// Every flag given is valid; ask for what is missing, in order.
		const profile =
			input.profile ??
			(yield* ask(
				TextInput.screen({
					message: "Profile name",
					placeholder: "personal",
					validate: (value) => validName("A profile name")(value) ?? taken(value),
				}),
				MISSING_PROFILE,
				{ clear: true },
			));

		const actsAs: { readonly username: string } | { readonly org: string } =
			username !== undefined
				? { username }
				: org !== undefined
					? { org }
					: yield* Effect.gen(function* () {
							const kind = yield* ask(
								Select.screen<"username" | "org">({
									message: "Who does this profile act as?",
									choices: [
										{ label: "A personal account", value: "username", detail: "repositories you own" },
										{ label: "An organization", value: "org", detail: "repositories an organization owns" },
									],
								}),
								MISSING_ACTS_AS,
							);
							const what = kind === "username" ? "GitHub username" : "Organization name";
							const name = yield* ask(
								TextInput.screen({ message: what, validate: validName(`A ${what.toLowerCase()}`) }),
								MISSING_ACTS_AS,
								{ clear: true },
							);
							return kind === "username" ? { username: name } : { org: name };
						});

		const github_token: CredentialSource =
			op !== undefined
				? { op }
				: env !== undefined
					? { env }
					: yield* Effect.gen(function* () {
							const kind = yield* ask(
								Select.screen<"op" | "env">({
									message: "Where is the GitHub token?",
									choices: [
										{ label: "1Password", value: "op", detail: "an op:// secret reference" },
										{ label: "An environment variable", value: "env", detail: "e.g. in CI" },
									],
								}),
								MISSING_REFERENCE,
							);
							// Cleared on close: see the remarks on why.
							const reference = yield* ask(
								TextInput.screen({
									message: kind === "op" ? "1Password reference" : "Environment variable name",
									placeholder: kind === "op" ? "op://Vault/item/field" : "REPOSETS_GITHUB_TOKEN",
									validate: validateReference(kind),
								}),
								MISSING_REFERENCE,
								{ clear: true },
							);
							return kind === "op" ? { op: reference } : { env: reference };
						});

		const record: CredentialProfile = { ...actsAs, github_token };
		const path = yield* saveWhereRead(credentialsFile, {
			profiles: { ...existing.profiles, [profile]: record },
		});

		const { owner, ownerType } = profileOwner(record);
		yield* CliMessage.success(
			`Created profile '${profile}' (${ownerType === "User" ? "username" : "org"}: ${owner}, ` +
				`github_token: ${describeSource(github_token)}) in ${path}.`,
		);
	});

const createCommand = Command.make(
	"create",
	{ profile: profileFlag, op: opFlag, env: envFlag, username: usernameFlag, org: orgFlag },
	({ profile, op, env, username, org }) =>
		createHandler({
			profile: Option.getOrUndefined(profile),
			op: Option.getOrUndefined(op),
			env: Option.getOrUndefined(env),
			username: Option.getOrUndefined(username),
			org: Option.getOrUndefined(org),
		}),
).pipe(Command.withDescription("Add a credential profile holding a reference to a GitHub token"));

/** Who a profile acts as, for display. */
const describeOwner = (profile: CredentialProfile): string => {
	const { owner, ownerType } = profileOwner(profile);
	return `${owner} (${ownerType === "User" ? "user" : "organization"})`;
};

/**
 * `reposets credentials list` — the profiles and what they point at.
 *
 * @remarks
 * There is nothing to redact. The file holds references, so printing it in full
 * discloses which vault items and environment variables reposets reads, never
 * their contents — which is exactly what someone running this needs to see.
 *
 * Printed as one document, a section per profile, so the audience decides the
 * rendering: plain for an agent or a pipe, styled on a terminal.
 *
 * @public
 */
export const listHandler = Effect.gen(function* () {
	const credentialsFile = yield* ReposetsCredentialsFile;
	const credentials = yield* credentialsFile.loadOrDefault(EMPTY);

	const entries = Object.entries(credentials.profiles);
	if (entries.length === 0) {
		yield* CliMessage.info("No credential profiles configured.");
		return;
	}

	yield* Doc.print(
		entries.map(([name, profile]) => {
			const lines: Array<string> = [
				`acts as: ${describeOwner(profile)}`,
				`github_token: ${describeSource(profile.github_token)}`,
			];
			for (const kind of ["op", "env", "file"] as const) {
				const resolved = profile.resolve?.[kind];
				if (resolved === undefined) continue;
				for (const [label, reference] of Object.entries(resolved)) {
					lines.push(`resolve.${kind}.${label}: ${reference}`);
				}
			}
			return Doc.section(`[${name}]`, [Doc.lines(lines)]);
		}),
	);
});

const listCommand = Command.make("list", {}, () => listHandler).pipe(
	Command.withDescription("List credential profiles and the references they hold"),
);

/**
 * `reposets credentials delete` — remove a profile.
 *
 * @remarks
 * Without `--profile`, an interactive run picks from the existing profiles —
 * each shown with who it acts as and its token reference, never a value — and
 * a non-interactive run is refused naming `--profile` (exit 64). With no
 * profiles at all there is nothing to pick, which is said and succeeds.
 *
 * @param profile - the profile to remove, or `undefined` when the flag was omitted
 *
 * @public
 */
export const deleteHandler = (profile: string | undefined) =>
	Effect.gen(function* () {
		const appDirs = yield* AppDirs;
		yield* appDirs.ensureConfig;

		if (profile === undefined && !(yield* CliInteractive)) {
			return yield* refuse("Provide --profile <name>: the profile to delete.");
		}
		// "Profile '…' not found" would repeat it.
		if (profile !== undefined && looksLikeSecret(profile)) {
			return yield* refuse(LOOKS_LIKE_SECRET);
		}

		const credentialsFile = yield* ReposetsCredentialsFile;
		const credentials = yield* credentialsFile.loadOrDefault(EMPTY);

		const entries = Object.entries(credentials.profiles);
		if (profile === undefined && entries.length === 0) {
			yield* CliMessage.info("No credential profiles configured — nothing to delete.");
			return;
		}

		const name =
			profile ??
			(yield* ask(
				Select.screen({
					message: "Delete which profile?",
					choices: entries.map(([key, value]) => ({
						label: key,
						value: key,
						detail: `${describeOwner(value)} · github_token: ${describeSource(value.github_token)}`,
					})),
				}),
				"Provide --profile <name>: the profile to delete.",
			));

		if (credentials.profiles[name] === undefined) {
			return yield* refuse(`Profile '${name}' not found.`);
		}

		const { [name]: _removed, ...remaining } = credentials.profiles;
		const path = yield* saveWhereRead(credentialsFile, { profiles: remaining });

		yield* CliMessage.success(`Deleted profile '${name}' from ${path}.`);
	});

const deleteCommand = Command.make("delete", { profile: profileFlag }, ({ profile }) =>
	deleteHandler(Option.getOrUndefined(profile)),
).pipe(Command.withDescription("Remove a credential profile"));

/**
 * `reposets credentials` — manage `reposets.credentials.toml`.
 *
 * @public
 */
export const credentialsCommand = Command.make("credentials", {}, () => Effect.void).pipe(
	Command.withDescription("Manage credential profiles (references only — never token values)"),
	Command.withSubcommands([createCommand, listCommand, deleteCommand]),
);
