import type { Block } from "@effected/cli";
import { CliExit, CliMessage, Doc, Status } from "@effected/cli";
import { Effect } from "effect";
import { Command } from "effect/cli";
import { danglingReferences } from "../../lib/config-refs.js";
import { undefinedCredentialLabels } from "../../lib/credential-labels.js";
import { orgOnlyViolations } from "../../lib/org-only.js";
import { ReposetsConfigFile, ReposetsCredentialsFile } from "../../services/ConfigFiles.js";

/**
 * Findings grouped by the group that references them, as a document.
 *
 * @remarks
 * Grouped because that is the unit a reader fixes: every finding sits in a
 * `[groups.<name>]` table, and seeing all of one group's problems together is
 * one trip into the file rather than several. Each finding keeps its full
 * config path — the problem is reported where the reference is **used**, which
 * is where the edit goes. The optional `hint` closes the report with the fix
 * that applies to every finding in it.
 */
const findingsDoc = (
	findings: ReadonlyArray<{ readonly group: string; readonly text: string }>,
	hint?: string,
): ReadonlyArray<Block> => {
	const byGroup = new Map<string, Array<string>>();
	for (const finding of findings) {
		const existing = byGroup.get(finding.group);
		if (existing === undefined) byGroup.set(finding.group, [finding.text]);
		else existing.push(finding.text);
	}
	const sections = [...byGroup].map(([group, texts]) =>
		Doc.section(`[${group}]`, [
			Doc.list(
				texts.map((text) => Doc.paragraph(Doc.status(Status.core, "failure"), " ", text)),
				{ compact: true },
			),
		]),
	);
	return [Doc.section(undefined, hint === undefined ? sections : [...sections, Doc.paragraph(hint)])];
};

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
 * The success result goes to stdout as a `CliMessage.success` line. A
 * reference or credential problem is a finding, not a failure: an `Invalid:`
 * line (`CliMessage.failure`, which no log level silences) and the grouped
 * findings document go to stderr, and the command succeeds with
 * `CliExit.set(1)`. A file that does not decode fails `discover`, and the
 * entrypoint's renderer prints the issue lines and exits `1`.
 *
 * @public
 */
export const validateHandler = Effect.gen(function* () {
	const configFile = yield* ReposetsConfigFile;
	const credentialsFile = yield* ReposetsCredentialsFile;

	const sources = yield* configFile.discover;
	// No config anywhere is a finding, worded as `sync` and `list` word it —
	// without this, `load` failed with the kit's raw `ConfigFileNotFoundError`
	// report, the one command of the three that did not point at `init`.
	const source = sources[0];
	if (source === undefined) {
		yield* CliMessage.failure("No config found. Run 'reposets init' to create one.");
		return yield* CliExit.set(1);
	}
	const value = source.value;
	const where = source.path;
	// Credentials are read here for their OWNER declarations, not their
	// tokens — nothing is resolved and no network is touched. A missing or
	// unreadable credentials file simply means there is nothing to check
	// against, which must not fail a command about the config file.
	const credentials = yield* credentialsFile.loadOrDefault({ profiles: {} });

	const invalid = (doc: ReadonlyArray<Block>) =>
		Effect.gen(function* () {
			yield* CliMessage.failure(`Invalid: ${where}`);
			yield* Doc.print(doc, { stream: "stderr" });
			return yield* CliExit.set(1);
		});

	// Reference integrity first: a dangling reference means a group is asking
	// for a section that does not exist, which makes every later check about
	// resources that were never going to be applied.
	const dangling = danglingReferences(value);
	if (dangling.length > 0) {
		return yield* invalid(
			findingsDoc(
				dangling.map((ref) => ({
					group: ref.group,
					// `defined` is shown because nearly every one of these is a typo,
					// and a typo is fixed by seeing the correct spelling.
					text: `${ref.where}: '${ref.name}' does not exist — ${ref.defined.length === 0 ? "none defined" : `defined: ${ref.defined.join(", ")}`}`,
				})),
			),
		);
	}

	const labels = undefinedCredentialLabels(value, credentials);
	const violations = orgOnlyViolations(value, credentials);

	if (labels.length > 0) {
		return yield* invalid(
			findingsDoc(
				labels.map((label) => ({
					group: label.group,
					text: `${label.where}: credential label '${label.label}' is not declared in profile '${label.profile}'`,
				})),
				"Add it to that profile's [resolve] section in reposets.credentials.toml, or correct the name.",
			),
		);
	}

	if (violations.length > 0) {
		return yield* invalid(
			findingsDoc(
				violations.map((violation) => ({
					group: violation.group,
					text: `${violation.where}: ${violation.detail}, but profile '${violation.profile}' is a personal account`,
				})),
				"Either move these repositories to a profile declaring `org`, or drop the settings.",
			),
		);
	}

	// State the outcome first. Reaching this line means the schema accepted
	// the file and `danglingReferences` found no unresolvable references — but the
	// old output opened with "sources found: 1" and "owner: (not set)", which
	// reads as a complaint and never says whether the command passed.
	const groups = Object.keys(value.groups).length;
	yield* CliMessage.success(`Valid: ${where}`);
	yield* Doc.print([Doc.verbatim(`groups: ${groups === 0 ? "none declared yet" : String(groups)}`, { indent: 2 })]);
});

/**
 * The `validate` command.
 *
 * @public
 */
export const validateCommand = Command.make("validate", {}, () => validateHandler).pipe(
	Command.withDescription("Validate reposets.config.toml against the schema"),
);
