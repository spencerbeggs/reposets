import { Effect } from "effect";
import { Command } from "effect/unstable/cli";
import type { Config } from "../../schemas/config.js";
import { profileOwner } from "../../schemas/credentials.js";
import { ReposetsConfigFile, ReposetsCredentialsFile } from "../../services/ConfigFiles.js";

/** `secrets` and `variables` render the same way; only the scope names differ. */
const scopeParts = (
	scopes: Config["groups"][string]["secrets"] | Config["groups"][string]["variables"],
): ReadonlyArray<string> => {
	if (scopes === undefined) return [];
	const parts: string[] = [];
	for (const scope of ["actions", "dependabot", "codespaces"] as const) {
		const groups = (scopes as Record<string, ReadonlyArray<string> | undefined>)[scope];
		if (groups !== undefined && groups.length > 0) {
			parts.push(`${scope}:[${groups.join(",")}]`);
		}
	}
	for (const [envName, envGroups] of Object.entries(scopes.environments ?? {})) {
		if (envGroups.length > 0) {
			parts.push(`environments.${envName}:[${envGroups.join(",")}]`);
		}
	}
	return parts;
};

/**
 * `reposets list` — what the config declares, per group.
 *
 * @remarks
 * A reading command: it decodes the config and prints its structure, touching
 * neither GitHub nor the store. Empty collections are omitted rather than
 * printed as `(none)` — a group that assigns nothing should read as a short
 * entry, not a wall of blanks.
 *
 * @public
 */
export const listHandler = Effect.gen(function* () {
	const configFile = yield* ReposetsConfigFile;
	const credentialsFile = yield* ReposetsCredentialsFile;
	const sources = yield* configFile.discover;

	if (sources.length === 0) {
		yield* Effect.logError("No config file found. Run 'reposets init' to create one.");
		return;
	}

	const config = yield* configFile.load;
	// The owner lives on the credential profile now, so summarising a group
	// means reading both files. Missing credentials are not fatal here: `list`
	// describes the config, and saying "profile not found" per group is more
	// useful than refusing to print anything.
	const credentials = yield* credentialsFile.loadOrDefault({ profiles: {} });

	for (const [groupName, group] of Object.entries(config.groups)) {
		const profile = credentials.profiles[group.credentials];
		// The profile is named here because it is the identity these repositories
		// are written to GitHub AS. A summary that lists what will be changed and
		// omits who it will be changed by leaves out the half that decides
		// whether the run can do it at all.
		const acts =
			profile === undefined
				? `credentials: ${group.credentials} — NOT FOUND`
				: `owner: ${profileOwner(profile).owner}, credentials: ${group.credentials}`;
		yield* Effect.log(`[${groupName}] (${acts})`);
		const owner = profile === undefined ? "(unknown)" : profileOwner(profile).owner;

		for (const repo of group.repos) {
			yield* Effect.log(`  - ${owner}/${repo}`);
		}

		for (const [label, names] of [
			["settings", group.settings],
			["environments", group.environments],
			["rulesets", group.rulesets],
			["security", group.security],
			["code_scanning", group.code_scanning],
		] as const) {
			if (names !== undefined && names.length > 0) {
				yield* Effect.log(`  ${label}: ${names.join(", ")}`);
			}
		}

		const secrets = scopeParts(group.secrets);
		if (secrets.length > 0) {
			yield* Effect.log(`  secrets: ${secrets.join(", ")}`);
		}

		const variables = scopeParts(group.variables);
		if (variables.length > 0) {
			yield* Effect.log(`  variables: ${variables.join(", ")}`);
		}

		yield* Effect.log("");
	}
});

/**
 * `reposets list`.
 *
 * @public
 */
export const listCommand = Command.make("list", {}, () => listHandler).pipe(
	Command.withDescription("Show a summary of the config: groups, repos and their assigned resources"),
);
