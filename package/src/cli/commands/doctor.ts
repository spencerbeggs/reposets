import { cwd, env } from "node:process";
import { GitHubClient } from "@effected/github";
import { Toml } from "@effected/toml";
import { AppDirs } from "@effected/xdg";
import { Effect, FileSystem, Layer, Option, Path, Result } from "effect";
import { Command } from "effect/unstable/cli";
import { formatSchemaIssue } from "../../lib/schema-issues.js";
import { SettingsGroupSchema } from "../../schemas/config.js";
import type { CredentialProfile } from "../../schemas/credentials.js";
import { profileOwner } from "../../schemas/credentials.js";
import {
	CONFIG_FILENAME,
	CREDENTIALS_FILENAME,
	ReposetsConfigFile,
	ReposetsCredentialsFile,
} from "../../services/ConfigFiles.js";
import { CredentialResolver, CredentialResolverLive } from "../../services/CredentialResolver.js";
import { OP_SERVICE_ACCOUNT_TOKEN, OnePasswordClientLive } from "../../services/OnePasswordClient.js";
import { ConfigFlag } from "../flags.js";

const KNOWN_CONFIG_KEYS = new Set([
	"settings",
	"secrets",
	"variables",
	"rulesets",
	"environments",
	"security",
	"code_scanning",
	"groups",
]);
const KNOWN_GROUP_KEYS = new Set([
	"repos",
	"credentials",
	"settings",
	"secrets",
	"variables",
	"rulesets",
	"environments",
	"security",
	"code_scanning",
	"cleanup",
]);
/**
 * Keys 1.0 removed, and where each one went.
 *
 * @remarks
 * Every config written before 1.0 carries at least one of these, so this is the
 * upgrade path rather than an edge case. Strict decoding already rejects them —
 * the schema section says so — but "unknown key" is the wrong sentence for a key
 * that did not vanish so much as move, and the nearest-match hint is actively
 * misleading for one: `owner` is three edits from `repos`.
 *
 * Keyed by the same `where` suffix the warning uses, because `owner` was removed
 * from two places and means something different in each.
 */
const REMOVED_KEYS: Readonly<Record<string, string>> = {
	owner: "removed in 1.0 — the owner now belongs to the credential profile, which declares `username` or `org`",
	"owner (in groups)":
		"removed in 1.0 — a group's owner comes from the profile named by its `credentials`, so a group cannot override it",
	log_level:
		"removed in 1.0 — output is one level; use --debug for diagnostics, or core's --log-level to filter by severity",
};

/**
 * The settings fields the schema names, derived rather than listed.
 *
 * @remarks
 * `SettingsGroupSchema` is a struct **with a rest schema**, so an unrecognised
 * field is absorbed and passed through to GitHub deliberately — that is how a
 * setting GitHub adds tomorrow works without a release here.
 *
 * The cost is that a typo is indistinguishable from a new field: `has_wikkis`
 * decodes cleanly, gets PATCHed, is ignored by GitHub because it recognises no
 * such field, and is then **reported as applied**. Two gates miss it — strict
 * decoding cannot object, and doctor's hand-written key sets never covered
 * settings — so a misspelled setting silently does nothing for as long as it
 * stays in the file.
 *
 * A warning rather than an error, because pass-through is intentional and this
 * cannot tell a typo from a field newer than our schema. Read off the schema so
 * it cannot drift from it; a second hand-maintained list is how the first one
 * went stale.
 */
const KNOWN_SETTINGS_FIELDS: ReadonlySet<string> = new Set(
	Object.keys(
		(SettingsGroupSchema as unknown as { readonly schema: { readonly fields: Record<string, unknown> } }).schema.fields,
	),
);

const KNOWN_CLEANUP_KEYS = new Set(["secrets", "variables", "rulesets", "environments"]);
const KNOWN_CLEANUP_SECRETS_KEYS = new Set(["actions", "dependabot", "codespaces", "environments"]);
const KNOWN_CLEANUP_VARIABLES_KEYS = new Set(["actions", "environments"]);

/**
 * The fine-grained token permissions a full sync needs.
 *
 * @remarks
 * Corrected from v3, which listed `Account permissions > GPG keys` as the
 * "secrets encryption key" scope. That is wrong. The public keys used to seal
 * secrets come from repository-scoped endpoints
 * (`GET /repos/{o}/{r}/actions/secrets/public-key` and the dependabot,
 * codespaces and environment equivalents) and are covered by the corresponding
 * Secrets permissions. Account-level GPG keys governs `/user/gpg_keys` — a
 * user's commit-signing keys — which reposets never touches. Following the old
 * list granted an unnecessary account-wide scope and did not grant anything the
 * tool actually used.
 *
 * `Metadata: Read` is mandatory for every fine-grained token and is granted
 * automatically, so it is not listed as something to enable.
 */
const REQUIRED_PERMISSIONS: ReadonlyArray<readonly [string, string, string]> = [
	["Repository", "Administration (Read and write)", "settings sync"],
	["Repository", "Secrets (Read and write)", "Actions, Codespaces and environment secrets"],
	["Repository", "Variables (Read and write)", "Actions and environment variables"],
	["Repository", "Environments (Read and write)", "deployment environment sync"],
	["Repository", "Dependabot secrets (Read and write)", "Dependabot secrets"],
	["Repository", "Code scanning alerts (Read and write)", "CodeQL default setup"],
	// READ, not write. The code-scanning phase lists workflows to decide whether
	// the `actions` CodeQL language is settable; it never starts, stops, enables
	// or disables anything. Asking for write would grant the ability to disable
	// every workflow in a repository to a tool that only counts them — the same
	// mistake the account-level GPG entry made before it was corrected.
	["Repository", "Actions (Read)", "count workflow files for the CodeQL actions language"],
	["Repository", "Dependabot alerts (Read and write)", "vulnerability alerts and automated fixes"],
	["Repository", "Secret scanning alerts (Read and write)", "secret scanning and delegated bypass"],
	["Organization", "Members (Read)", "resolve team slugs (org-owned repos only)"],
];

const levenshtein = (a: string, b: string): number => {
	const matrix: number[][] = [];
	for (let i = 0; i <= a.length; i++) {
		matrix[i] = [i];
	}
	for (let j = 0; j <= b.length; j++) {
		(matrix[0] as number[])[j] = j;
	}
	for (let i = 1; i <= a.length; i++) {
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			const row = matrix[i] as number[];
			const prev = matrix[i - 1] as number[];
			row[j] = Math.min((prev[j] as number) + 1, (row[j - 1] as number) + 1, (prev[j - 1] as number) + cost);
		}
	}
	return (matrix[a.length] as number[])[b.length] as number;
};

/** The nearest known key within edit distance 3, if any. */
const findClosestMatch = (key: string, known: ReadonlySet<string>): string | undefined => {
	let best: string | undefined;
	let bestDist = Number.POSITIVE_INFINITY;
	for (const candidate of known) {
		const dist = levenshtein(key, candidate);
		if (dist < bestDist && dist <= 3) {
			bestDist = dist;
			best = candidate;
		}
	}
	return best;
};

/**
 * Find the config file without decoding it.
 *
 * @remarks
 * The same two tiers the loader uses — walk up from the working directory, then
 * the XDG config directory — but testing only for existence.
 *
 * This was written on the belief that `discover` skips a source that fails to
 * decode. **That was wrong** — it propagates, and a validation failure now
 * reports its own path and its structured issue. The duplication survives for a
 * different and narrower reason, measured rather than assumed:
 * `ConfigCodecError` carries `codec` and `operation` and **no path**, so a TOML
 * *syntax* error cannot name the file it failed to parse. That is the most
 * ordinary config mistake there is, and this command exists to say which file
 * is wrong — so it finds the file itself and parses it for the line and column.
 *
 * Delete this when the codec error carries a path.
 *
 * `appDirs.dirs.config` rather than `ensureConfig`: the latter *creates* the
 * directory, and a read-only diagnostic must not.
 */
const locateConfig = (
	fs: FileSystem.FileSystem,
	path: Path.Path,
	appDirs: AppDirs["Service"],
	configFlag: string | undefined,
): Effect.Effect<string | undefined> =>
	Effect.gen(function* () {
		const candidates: string[] = [];

		// `--config` first, mirroring the resolver order in `ConfigFiles.ts` so
		// the two agree about which file is under discussion. Without it the walk
		// below names whatever config is nearest cwd — and this fallback only
		// runs when discovery FAILED, which is exactly when `--config` was
		// pointing at the broken one. Reporting "Schema validation: FAILED" under
		// the path of a perfectly valid file sends the user to the wrong file, by
		// the one command whose job is to say which file is wrong.

		if (configFlag !== undefined) {
			candidates.push(configFlag, path.join(configFlag, CONFIG_FILENAME));
		}

		let dir = cwd();
		for (;;) {
			candidates.push(path.join(dir, CONFIG_FILENAME));
			const parent = path.dirname(dir);
			if (parent === dir) break;
			dir = parent;
		}
		candidates.push(path.join(appDirs.dirs.config, CONFIG_FILENAME));

		for (const candidate of candidates) {
			// `stat`, not `exists`: `--config` may name a DIRECTORY, and the bare
			// candidate is tried before the joined one, so an existence check
			// matches the directory itself and doctor then reports
			// "Could not read <dir>" instead of falling through to the file inside.
			const info = yield* fs.stat(candidate).pipe(Effect.option);
			if (info._tag === "Some" && info.value.type === "File") return candidate;
		}
		return undefined;
	});

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * `reposets doctor` — config diagnostics, typo detection, credential posture.
 *
 * @remarks
 * The typo pass reads the **raw** TOML rather than the decoded config, because
 * decoding silently drops keys the schema does not know. A misspelled
 * `has_issues` would validate cleanly and then do nothing; only the raw text
 * shows it.
 *
 * Nothing here prints a credential. The credentials section reports which
 * *form* each profile uses — `op://…` addresses and environment variable
 * *names* — and whether the 1Password service account variable is present. It
 * never resolves a reference, so there is no value in scope to leak.
 *
 * @public
 */
/**
 * What `GET /user` proves about a profile, worded for the kind it declares.
 *
 * @remarks
 * The endpoint returns the account that **owns** the token, which is a user even
 * for a token whose whole purpose is an organization. Reporting that as
 * "authenticates as spencerbeggs" next to a profile declaring `org = "..."`
 * reads as a contradiction, so the two kinds are worded differently.
 *
 * For a `username` profile the owner IS the declared owner, which makes this the
 * one exact check available for free: a typo becomes a named error here instead
 * of a 404 partway through a sync.
 *
 * For an `org` profile there is no equivalent. Nothing in `GET /user` says
 * whether the token reaches that organization — answering it needs a request
 * against the org, which a token without org read cannot make even when it can
 * administer every repository in it. So the absence of a check is deliberate,
 * and is not dressed up as reassurance.
 *
 * Extracted because both branches sit behind a live request: `doctor` builds its
 * own `GitHubClient` from the resolved token, so nothing outside it can reach
 * these lines.
 *
 * @public
 */
export const describeIdentity = (
	name: string,
	profile: CredentialProfile,
	login: string,
): { readonly ok: boolean; readonly text: string } => {
	const { owner, ownerType } = profileOwner(profile);

	if (ownerType !== "User") {
		return { ok: true, text: `Token [${name}]: resolved, owned by ${login}, for org ${owner}` };
	}

	return login === owner
		? { ok: true, text: `Token [${name}]: resolved, authenticates as ${login} — matches username` }
		: {
				ok: false,
				text: `Token [${name}]: resolved, but authenticates as ${login} while the profile declares username = "${owner}"`,
			};
};

export const doctorHandler = (configFlag: string | undefined) =>
	Effect.gen(function* () {
		const configFile = yield* ReposetsConfigFile;
		const credentialsFile = yield* ReposetsCredentialsFile;
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const appDirs = yield* AppDirs;

		// Discovery is best-effort by contract: a source that fails to decode is
		// skipped rather than reported. Now that decoding is strict, a config with a
		// typo therefore looks *absent* — and that is exactly the config this
		// command exists to explain. So discovery answers only "did it validate",
		// and finding the file is done independently: a diagnostic must not depend
		// on the machinery it is diagnosing.
		const discovered = yield* configFile.discover.pipe(Effect.result);
		const sources = discovered._tag === "Success" ? discovered.success : [];
		const schemaValid = discovered._tag === "Success" && sources.length > 0;

		// The structured issue, kept rather than discarded. `discover` propagates a
		// validation failure; an earlier `orElseSucceed(() => [])` here threw it
		// away and left this command guessing from a hand-written list of known
		// keys — which can only ever find a MISSPELLING. A wrongly shaped value
		// (`[variables.x] KEY = "v"` instead of `value = { KEY = "v" }`) produced
		// "FAILED" followed by "No unknown keys detected", which is a dead end from
		// the one command whose job is to end them.
		const validationIssue =
			discovered._tag === "Failure" ? (discovered.failure as { readonly issue?: unknown }).issue : undefined;

		const configPath = sources[0]?.path ?? (yield* locateConfig(fs, path, appDirs, configFlag));
		if (configPath === undefined) {
			yield* Effect.logError("No config found. Run 'reposets init' to create one.");
			return;
		}

		yield* Effect.log(`Config: ${configPath}`);

		const text = yield* fs.readFileString(configPath).pipe(Effect.option);
		if (text._tag === "None") {
			yield* Effect.logError(`Could not read ${configPath}`);
			return;
		}

		const parsed = Toml.parseResult(text.value);
		if (Result.isFailure(parsed)) {
			yield* Effect.logError(`TOML parse error: ${String(parsed.failure)}`);
			return;
		}

		const raw = isRecord(parsed.success) ? parsed.success : {};
		let warnings = 0;

		const checkKeys = (target: unknown, known: ReadonlySet<string>, where: string): Effect.Effect<void> =>
			Effect.gen(function* () {
				if (!isRecord(target)) return;
				for (const key of Object.keys(target)) {
					if (known.has(key)) continue;

					// A key that was removed is not a typo, and guessing a near match
					// for it sends the reader the wrong way — `owner` is three edits
					// from `repos`.
					const removedFrom = REMOVED_KEYS[where === "" ? key : `${key} (in groups)`] ?? REMOVED_KEYS[key];
					if (removedFrom !== undefined) {
						yield* Effect.log(`Warning: '${key}'${where} ${removedFrom}`);
						warnings += 1;
						continue;
					}

					const suggestion = findClosestMatch(key, known);
					const hint = suggestion === undefined ? "" : ` — did you mean '${suggestion}'?`;
					yield* Effect.log(`Warning: unknown key '${key}'${where}${hint}`);
					warnings += 1;
				}
			});

		yield* checkKeys(raw, KNOWN_CONFIG_KEYS, "");

		// Settings fields, which no gate covered. Warned about rather than
		// rejected: the rest schema passes unknown fields to GitHub on purpose.
		const settingsSection = isRecord(raw.settings) ? raw.settings : {};
		for (const [groupName, body] of Object.entries(settingsSection)) {
			if (!isRecord(body)) continue;
			for (const field of Object.keys(body)) {
				if (KNOWN_SETTINGS_FIELDS.has(field)) continue;
				const suggestion = findClosestMatch(field, KNOWN_SETTINGS_FIELDS);
				const hint =
					suggestion === undefined
						? " — it will be sent to GitHub as-is, which ignores fields it does not recognise"
						: ` — did you mean '${suggestion}'?`;
				yield* Effect.log(`Warning: unrecognised setting '${field}' in settings.${groupName}${hint}`);
				warnings += 1;
			}
		}

		const groups = raw.groups;
		if (isRecord(groups)) {
			for (const [groupName, group] of Object.entries(groups)) {
				yield* checkKeys(group, KNOWN_GROUP_KEYS, ` in groups.${groupName}`);
				if (!isRecord(group)) continue;
				const cleanup = group.cleanup;
				if (!isRecord(cleanup)) continue;
				const prefix = `groups.${groupName}.cleanup`;
				yield* checkKeys(cleanup, KNOWN_CLEANUP_KEYS, ` in ${prefix}`);
				yield* checkKeys(cleanup.secrets, KNOWN_CLEANUP_SECRETS_KEYS, ` in ${prefix}.secrets`);
				yield* checkKeys(cleanup.variables, KNOWN_CLEANUP_VARIABLES_KEYS, ` in ${prefix}.variables`);
			}
		}

		// Reaching `discover` without failing means the schema accepted it.
		if (schemaValid) {
			yield* Effect.log("Schema validation: passed");
		} else {
			yield* Effect.logError("Schema validation: FAILED — these values are rejected, not ignored");
			for (const line of formatSchemaIssue(validationIssue)) {
				yield* Effect.logError(`  ${line}`);
			}
		}

		// --- Credentials ------------------------------------------------------
		yield* Effect.log("");
		// Swallowing this failure would repeat the mistake strict decoding just
		// exposed on the config side: a credentials file that exists and does not
		// decode would report as "no profiles configured", indistinguishable from
		// having none. That is the case a leftover `op_service_account_token`
		// produces, and it is precisely what someone runs doctor to be told.
		const loaded = yield* credentialsFile.loadOrDefault({ profiles: {} }).pipe(Effect.result);

		const credentials = loaded._tag === "Success" ? loaded.success : { profiles: {} };
		const profileNames = Object.keys(credentials.profiles);

		if (loaded._tag === "Failure") {
			yield* Effect.logError(
				`Credentials: FAILED to load — ${String((loaded.failure as { message?: string }).message ?? loaded.failure)}`,
			);
			yield* Effect.logError(
				"  Unknown keys are rejected. `op_service_account_token` was removed — that token now comes from OP_SERVICE_ACCOUNT_TOKEN in the environment.",
			);
			// Falls through to the permissions section: a broken credentials file is
			// not a reason to withhold the rest of the diagnosis.
		} else if (profileNames.length === 0) {
			yield* Effect.log("Credentials: no profiles configured");
		} else {
			yield* Effect.log(`Credentials: ${profileNames.length} profile(s)`);
			let usesOnePassword = false;
			for (const [name, profile] of Object.entries(credentials.profiles)) {
				// A reference is an address, not a secret: safe to print, and the
				// only useful thing to print. Nothing is resolved here.
				const token =
					"op" in profile.github_token ? `op ${profile.github_token.op}` : `env ${profile.github_token.env}`;
				if ("op" in profile.github_token) usesOnePassword = true;

				const sections: string[] = [];
				for (const kind of ["op", "env", "file"] as const) {
					const entries = profile.resolve?.[kind];
					if (entries !== undefined && Object.keys(entries).length > 0) {
						sections.push(`${kind}:${Object.keys(entries).length}`);
						if (kind === "op") usesOnePassword = true;
					}
				}
				const resolveSummary = sections.length === 0 ? "" : `, resolve ${sections.join(" ")}`;
				yield* Effect.log(`  [${name}] github_token: ${token}${resolveSummary}`);
			}

			const hasServiceAccount = env[OP_SERVICE_ACCOUNT_TOKEN] !== undefined && env[OP_SERVICE_ACCOUNT_TOKEN] !== "";
			if (usesOnePassword) {
				yield* Effect.log(
					hasServiceAccount
						? `  ${OP_SERVICE_ACCOUNT_TOKEN}: set`
						: `  ${OP_SERVICE_ACCOUNT_TOKEN}: NOT SET — op:// references cannot be resolved`,
				);
			}
		}

		// --- Where everything lives -------------------------------------------
		//
		// Three files, three directories, three different rules for finding them.
		// Printing them is the cheapest way to end "which config is it reading?",
		// which is otherwise answered by guessing.
		yield* Effect.log("");
		yield* Effect.log(`Version: ${env.__PACKAGE_VERSION__ ?? "0.0.0 (dev build)"}`);
		// `discover` reports the sources the resolver chain actually found, which
		// is the only honest answer to "which credentials file is in play" — the
		// chain has three tiers and the answer is not guessable from cwd.
		//
		// Three outcomes, not two. An earlier `orElseSucceed(() => [])` collapsed
		// "failed to decode" into "found nothing", so a file that exists and does
		// not parse was reported as `(not created yet)` four lines after this
		// command had already said it failed to load — the same command
		// contradicting itself about the same file.
		const credentialDiscovery = yield* credentialsFile.discover.pipe(Effect.result);
		const credentialSources = credentialDiscovery._tag === "Success" ? credentialDiscovery.success : [];
		const credentialsLine =
			credentialDiscovery._tag === "Failure"
				? // No path here. The failure above names the file that actually
					// failed; printing the XDG default beside "failed to load" would
					// assert that a file which may not exist is the broken one, which
					// is the same guessing that produced "(not created yet)".
					"(failed to load — the error above names the file)"
				: credentialSources.length === 0
					? `${path.join(appDirs.dirs.config, CREDENTIALS_FILENAME)} (not created yet)`
					: (credentialSources[0]?.path ?? "");
		yield* Effect.log(`Credentials file: ${credentialsLine}`);
		yield* Effect.log(`State database: ${path.join(appDirs.dirs.state, "store.db")}`);

		// --- Does the token actually work? ------------------------------------
		//
		// Everything above reads files. This is the only part that asks GitHub
		// anything, and it exists because the sections above cannot distinguish a
		// working setup from three broken ones: a revoked token, an `op://` path
		// pointing at an item that is not there, and a service-account token
		// without access to the vault all produce exactly the output above.
		yield* Effect.log("");
		for (const [name, profile] of Object.entries(credentials.profiles)) {
			const resolverLayer = Layer.provide(CredentialResolverLive, OnePasswordClientLive);

			const resolved = yield* Effect.gen(function* () {
				const resolver = yield* CredentialResolver;
				return yield* resolver.resolveGitHubToken(profile);
			}).pipe(Effect.provide(resolverLayer), Effect.result);

			if (resolved._tag === "Failure") {
				yield* Effect.logError(`Token [${name}]: could not resolve — ${String(resolved.failure)}`);
				continue;
			}

			// `GET /user` is the cheapest question that proves the credential is
			// live: every token can read it, and a revoked or malformed one cannot.
			const identity = yield* Effect.gen(function* () {
				const client = yield* GitHubClient;
				return yield* client.request("GET /user", {});
			}).pipe(Effect.provide(GitHubClient.layerFromToken({ token: resolved.success })), Effect.result);

			if (identity._tag !== "Success") {
				yield* Effect.logError(`Token [${name}]: resolved but REJECTED by GitHub — ${String(identity.failure)}`);
				continue;
			}

			const line = describeIdentity(name, profile, identity.success.login);
			yield* line.ok ? Effect.log(line.text) : Effect.logError(line.text);
		}

		// --- Token permissions ------------------------------------------------
		yield* Effect.log("");
		yield* Effect.log("Required fine-grained token permissions:");
		for (const [scope, permission, why] of REQUIRED_PERMISSIONS) {
			yield* Effect.log(`  ${scope} > ${permission} — ${why}`);
		}
		yield* Effect.log("  (Metadata: Read is mandatory and granted automatically)");
		// Said plainly because the list above looks like a checklist that was
		// checked. GitHub reports a permission set for App installation tokens
		// only; a fine-grained PAT's scopes are not readable through the API, so
		// this is a requirement to compare against by hand.
		yield* Effect.log("  These are NOT verified — GitHub does not expose a fine-grained token's own scopes.");

		yield* Effect.log("");
		yield* Effect.log(warnings === 0 ? "No unknown keys detected." : `${warnings} warning(s) found.`);
	});

/**
 * `reposets doctor`.
 *
 * @public
 */
export const doctorCommand = Command.make("doctor", {}, () =>
	Effect.gen(function* () {
		// The flag is read here rather than inside the handler so the handler
		// stays a plain function of its inputs — testable without providing the
		// CLI's global-flag service, the same shape the credentials handlers use.
		const flag = yield* ConfigFlag;
		yield* doctorHandler(Option.getOrUndefined(flag));
	}),
).pipe(Command.withDescription("Diagnose the config: unknown keys, credential posture, required token permissions"));
