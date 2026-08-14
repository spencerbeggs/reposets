import { Effect } from "effect";
import { Command } from "effect/unstable/cli";
import { danglingReferences } from "../../lib/config-refs.js";
import { undefinedCredentialLabels } from "../../lib/credential-labels.js";
import { orgOnlyViolations } from "../../lib/org-only.js";
import { ReposetsConfigFile, ReposetsCredentialsFile } from "../../services/ConfigFiles.js";

/**
 * `reposets validate` — discovers, decodes and reports the config file.
 *
 * @remarks
 * The walking skeleton's vertical slice. Running it exercises `App.layer` (for
 * `AppDirs`/`Xdg`), `AppConfig.layer` with a caller-supplied resolver chain,
 * `TomlCodec`, and Schema v4 decoding — so a green run proves the composition
 * the rebuild stands on.
 *
 * The handler simply *requires* `ReposetsConfigFile`; how it gets built from
 * `--config` is the root command's business, not this command's.
 *
 * @public
 */
export const validateCommand = Command.make("validate", {}, () =>
	Effect.gen(function* () {
		const configFile = yield* ReposetsConfigFile;
		const credentialsFile = yield* ReposetsCredentialsFile;

		const sources = yield* configFile.discover;
		const value = yield* configFile.load;
		// Credentials are read here for their OWNER declarations, not their
		// tokens — nothing is resolved and no network is touched. A missing or
		// unreadable credentials file simply means there is nothing to check
		// against, which must not fail a command about the config file.
		const credentials = yield* credentialsFile.loadOrDefault({ profiles: {} });

		// Reference integrity first: a dangling reference means a group is asking
		// for a section that does not exist, which makes every later check about
		// resources that were never going to be applied.
		const dangling = danglingReferences(value);
		if (dangling.length > 0) {
			yield* Effect.logError(`Invalid: ${sources[0]?.path ?? "config"}`);
			for (const ref of dangling) {
				const defined = ref.defined.length === 0 ? "none defined" : `defined: ${ref.defined.join(", ")}`;
				yield* Effect.logError(`  ${ref.where}: '${ref.name}' does not exist — ${defined}`);
			}
			yield* Effect.sync(() => {
				process.exitCode = 1;
			});
			return;
		}

		const labels = undefinedCredentialLabels(value, credentials);
		const violations = orgOnlyViolations(value, credentials);

		if (labels.length > 0) {
			yield* Effect.logError(`Invalid: ${sources[0]?.path ?? "config"}`);
			for (const label of labels) {
				yield* Effect.logError(
					`  [${label.group}] ${label.where}: credential label '${label.label}' is not declared in profile '${label.profile}'`,
				);
			}
			yield* Effect.logError("");
			yield* Effect.logError(
				"Add it to that profile's [resolve] section in reposets.credentials.toml, or correct the name.",
			);
			yield* Effect.sync(() => {
				process.exitCode = 1;
			});
			return;
		}

		if (violations.length > 0) {
			yield* Effect.logError(`Invalid: ${sources[0]?.path ?? "config"}`);
			for (const violation of violations) {
				yield* Effect.logError(
					`  [${violation.group}] ${violation.where}: ${violation.detail}, but profile '${violation.profile}' is a personal account`,
				);
			}
			yield* Effect.logError("");
			yield* Effect.logError("Either move these repositories to a profile declaring `org`, or drop the settings.");
			yield* Effect.sync(() => {
				process.exitCode = 1;
			});
			return;
		}

		// State the outcome first. Reaching this line means the schema accepted
		// the file and `danglingReferences` found no unresolvable references — but the
		// old output opened with "sources found: 1" and "owner: (not set)", which
		// reads as a complaint and never says whether the command passed.
		const groups = Object.keys(value.groups).length;
		yield* Effect.log(`Valid: ${sources[0]?.path ?? "config"}`);
		yield* Effect.log(`  groups: ${groups === 0 ? "none declared yet" : String(groups)}`);
	}),
).pipe(Command.withDescription("Validate reposets.config.toml against the schema"));
