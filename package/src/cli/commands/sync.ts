import { CliExit } from "@effected/cli";
import type { ConfigReadError } from "@effected/config-file";
import {
	CodeScanning,
	DeploymentEnvironment,
	GitHubClient,
	GitHubRepository,
	RepositorySecret,
	RepositorySecurity,
	RepositoryVariable,
	Ruleset,
	WorkflowDispatch,
} from "@effected/github";
import type { Cache, Store } from "@effected/store";
import type { Crypto } from "effect";
import { Console, Effect, Layer, Option } from "effect";
import { CliError, Command, Flag } from "effect/cli";
import { danglingReferences } from "../../lib/config-refs.js";
import { ReposetsConfigFile, ReposetsCredentialsFile } from "../../services/ConfigFiles.js";
import { CredentialResolver, CredentialResolverLive } from "../../services/CredentialResolver.js";
import type { Invocation } from "../../services/Invocation.js";
import { OnePasswordClientLive } from "../../services/OnePasswordClient.js";
import { SyncLogger, SyncLoggerLive } from "../../services/SyncLogger.js";
import { AppliedStateLive } from "../../store/AppliedState.js";
import { RepoCacheLive } from "../../store/RepoCache.js";
import { SyncJournal, SyncJournalLive } from "../../store/SyncJournal.js";
import type { PhaseName } from "../../sync/phase.js";
import { PHASE_NAMES } from "../../sync/phase.js";
import { allPhases } from "../../sync/phases/index.js";
import { SyncEngine, SyncEngineLive } from "../../sync/SyncEngine.js";

const isPhaseName = (value: string): value is PhaseName => (PHASE_NAMES as ReadonlyArray<string>).includes(value);

const phaseSet = (values: ReadonlyArray<string>): ReadonlySet<PhaseName> => new Set(values.filter(isPhaseName));

/**
 * Phase names the user typed that do not exist.
 *
 * @remarks
 * Unrecognised names used to be filtered out silently, and an empty `only` set
 * reads downstream as "no filter" — so `--only nonsense` ran **all eight
 * phases**. The flag reached for to limit the blast radius of a destructive
 * command did the opposite of what it says, and reported success.
 *
 * Any unknown name is refused, including alongside valid ones: a typo in
 * `--only settings,secrts` means the user asked for two phases and would
 * otherwise get one, silently. That is a narrower wrong answer, not a safer one.
 */
const unknownPhases = (values: ReadonlyArray<string>): ReadonlyArray<string> => values.filter((v) => !isPhaseName(v));

/**
 * Group names by the credential profile they authenticate as.
 *
 * @remarks
 * A token is fixed at `GitHubClient` construction and every resource service is
 * built from that client, so a second identity is a second service graph and
 * there is no swapping one mid-run. Partitioning makes that explicit: a sync
 * under two identities really is two runs' worth of authority.
 *
 * Insertion order is the config's own order of first appearance, so output
 * still tracks the file a user is reading — with one exception inherited from
 * JS rather than chosen here: `config.groups` is a plain object, so a group
 * whose name parses as an integer is enumerated first whatever the file says.
 *
 * @param only - a `--group` filter. A name matching nothing yields an empty
 * map, which the caller reports rather than treating as "nothing to do".
 *
 * @public
 */
export const partitionByProfile = (
	groups: Readonly<Record<string, { readonly credentials: string }>>,
	only?: string | undefined,
): ReadonlyMap<string, ReadonlyArray<string>> => {
	const partitions = new Map<string, Array<string>>();
	for (const [groupName, group] of Object.entries(groups)) {
		if (only !== undefined && groupName !== only) continue;
		const existing = partitions.get(group.credentials);
		if (existing === undefined) partitions.set(group.credentials, [groupName]);
		else existing.push(groupName);
	}
	return partitions;
};

/**
 * `reposets sync` — apply the config to every selected repository.
 *
 * @remarks
 * The layer graph is built here rather than at the entrypoint because it
 * depends on values only known after the config and credentials have loaded:
 * the GitHub token, and the logger's tier and dry-run flag.
 *
 * @public
 */
export const syncHandler = (input: {
	readonly dryRun: boolean;
	readonly noCleanup: boolean;
	readonly failOnDrift: boolean;
	readonly group: string | undefined;
	readonly repo: string | undefined;
	readonly only: ReadonlyArray<string>;
	readonly skip: ReadonlyArray<string>;
	readonly debug: boolean;
}): Effect.Effect<
	void,
	ConfigReadError | CliError.UserError,
	ReposetsConfigFile | ReposetsCredentialsFile | Store | Cache | Crypto.Crypto | Invocation | CliExit
> =>
	Effect.gen(function* () {
		// Before anything else, and before the config is even read: a phase
		// filter that does not name a phase is a typo — a usage error, exit 64 —
		// and silently running everything is the worst available response.
		const badPhases = [...unknownPhases(input.only), ...unknownPhases(input.skip)];
		if (badPhases.length > 0) {
			return yield* Effect.fail(
				new CliError.UserError({
					cause: `Unknown phase name(s): ${badPhases.join(", ")}. Valid phases: ${PHASE_NAMES.join(", ")}. Nothing was synced.`,
				}),
			);
		}

		const configFile = yield* ReposetsConfigFile;
		const credentialsFile = yield* ReposetsCredentialsFile;

		// One read, and the failure is NOT swallowed. `discover` propagates a decode failure —
		// its error channel exists for that — so an earlier
		// `orElseSucceed(() => [])` here turned a config that was one key wrong
		// into "nothing found", and sent the user to `init` to create a second
		// one. It now fails the command, and the entrypoint's renderer prints the
		// error, the issue lines that name each rejected value, and the cause of a
		// TOML syntax error.
		const discovered = yield* configFile.discover;

		const source = discovered[0];
		if (source === undefined) {
			yield* Effect.logError("No config found. Run 'reposets init' to create one.");
			return yield* CliExit.set(1);
		}

		const config = source.value;
		const configDir = source.path.slice(0, source.path.lastIndexOf("/"));
		const credentials = yield* credentialsFile.loadOrDefault({ profiles: {} });

		// Refuse rather than silently skip. Every phase drops an unresolvable
		// reference without reporting it — deliberately, because a cross-reference
		// validator used to own this — so without a check here a misspelled
		// section name syncs nothing, reports nothing and exits 0. That is the
		// same failure as a `--repo` filter matching nothing, and it is worse in
		// a config file, where the typo persists across every future run.
		const dangling = danglingReferences(config);
		if (dangling.length > 0) {
			yield* Effect.logError("Config references sections that do not exist:");
			for (const ref of dangling) {
				const defined = ref.defined.length === 0 ? "none defined" : `defined: ${ref.defined.join(", ")}`;
				yield* Effect.logError(`  ${ref.where}: '${ref.name}' does not exist — ${defined}`);
			}
			yield* Effect.logError("");
			yield* Effect.logError("Nothing was synced. Fix the references or run 'reposets validate' for the full list.");
			return yield* CliExit.set(1);
		}

		const partitions = partitionByProfile(config.groups, input.group);

		if (partitions.size === 0) {
			// Two different mistakes. `--group` naming a group that does not exist
			// is the user asking for something invalid — a usage error, exit 64. A
			// config with no groups at all is a finding about the file — exit 1.
			if (input.group !== undefined) {
				return yield* Effect.fail(
					new CliError.UserError({
						cause: `No group named '${input.group}'. Configured: ${Object.keys(config.groups).join(", ") || "none"}`,
					}),
				);
			}
			yield* Effect.logError("No groups configured. Add a [groups.<name>] section to sync anything.");
			return yield* CliExit.set(1);
		}

		const resolverLayer = Layer.provide(CredentialResolverLive, OnePasswordClientLive);
		const loggerLayer = SyncLoggerLive({ dryRun: input.dryRun, debug: input.debug });

		// Built once and provided around the WHOLE loop rather than per
		// partition. Layers memoize per build, so providing these inside the
		// loop would mint a logger per profile — each with its own error tally,
		// so `finish()` would report one partition's errors and call it the run
		// — plus a separate journal and cache connection per profile.
		const sharedLayer = Layer.mergeAll(SyncJournalLive, AppliedStateLive, RepoCacheLive, resolverLayer, loggerLayer);

		const report = yield* Effect.gen(function* () {
			const journal = yield* SyncJournal;
			const logger = yield* SyncLogger;
			const resolver = yield* CredentialResolver;

			// The run boundary is the command's. One `sync` is one row in
			// `history` however many identities it used.
			const runId = yield* journal
				.startRun({ group: input.group, dryRun: input.dryRun })
				.pipe(Effect.orElseSucceed(() => "unrecorded"));

			let repos = 0;
			let changes = 0;
			let drifted = 0;
			let errors = 0;
			let firstError: string | undefined;

			for (const [profileName, groupNames] of partitions) {
				// One bad profile fails its own groups, never the command — the same
				// policy as an unresolvable token below, and the same reason: a
				// four-group sync should not be lost to the fourth group's typo
				// after the first three have already written to GitHub.
				//
				// Only the profiles the selected groups actually name are touched, so
				// a `--group` run is not held hostage by an unrelated profile whose
				// 1Password item was renamed.
				const profile = credentials.profiles[profileName];
				if (profile === undefined) {
					const known = Object.keys(credentials.profiles);
					const message = `credential profile '${profileName}' does not exist (has: ${known.join(", ") || "none — run 'reposets credentials create'"}); skipping ${groupNames.join(", ")}`;
					yield* logger.syncError(`profile ${profileName}`, message);
					errors += 1;
					firstError ??= `profile ${profileName}: ${message}`;
					continue;
				}

				// `result` rather than `orElseSucceed`, because the resolver already
				// knows exactly what went wrong and an earlier version of this
				// discarded it. `OP_SERVICE_ACCOUNT_TOKEN is not set` and `no item
				// found at that reference` have different fixes, and replacing both
				// with a message naming three possible causes made the commonest
				// one — the variable simply absent from this shell — the hardest to
				// read. The rendered error carries the op:// reference, which is an
				// address rather than a secret and which `doctor` already prints.
				const resolved = yield* resolver.resolveGitHubToken(profile).pipe(Effect.result);

				if (resolved._tag === "Failure") {
					// One unusable profile fails its own groups, not the command.
					// The alternative aborts a four-group sync because the fourth
					// group's token expired, after the first three had already run.
					// `.reason` rather than the whole error: its `message` prefixes
					// "Failed to resolve 'github_token' from op", and this line has
					// already said that in words the user recognises. The reason is
					// the only part that differs between causes.
					const message = `could not resolve the GitHub token for profile '${profileName}' — ${resolved.failure.reason}`;
					yield* logger.syncError(`profile ${profileName}`, message);
					errors += 1;
					firstError ??= `profile ${profileName}: ${message}`;
					continue;
				}

				const token = resolved.success;

				const services = Layer.mergeAll(
					GitHubRepository.layer,
					Ruleset.layer,
					RepositorySecurity.layer,
					CodeScanning.layer,
					DeploymentEnvironment.layer,
					RepositorySecret.layer,
					RepositoryVariable.layer,
					WorkflowDispatch.layer,
				).pipe(Layer.provideMerge(GitHubClient.layerFromToken({ token })));

				// The engine's remaining requirements — journal, logger, resolver,
				// cache — are satisfied from the ambient context this loop already
				// runs in, which is what keeps them shared across partitions.
				const engineLayer = SyncEngineLive(allPhases).pipe(Layer.provide(services));

				const scoped = {
					...config,
					groups: Object.fromEntries(groupNames.map((name) => [name, config.groups[name]])),
				} as typeof config;

				const partial = yield* Effect.gen(function* () {
					const engine = yield* SyncEngine;
					return yield* engine.syncAll(scoped, credentials, {
						runId,
						dryRun: input.dryRun,
						noCleanup: input.noCleanup,
						configDir,
						group: input.group,
						repo: input.repo,
						only: phaseSet(input.only),
						skip: phaseSet(input.skip),
					});
				}).pipe(Effect.provide(engineLayer));

				repos += partial.repos;
				changes += partial.changes;
				drifted += partial.drifted;
				errors += partial.errors;
				if (partial.errorSummary !== undefined) firstError ??= partial.errorSummary;
			}

			yield* journal.finishRun(runId, errors === 0 ? "success" : "partial", firstError).pipe(Effect.ignore);
			yield* logger.finish();

			return { repos, changes, drifted, errors };
		}).pipe(Effect.provide(sharedLayer));

		yield* Console.log(
			`${report.repos} repo(s), ${report.changes} change(s), ${report.drifted} drifted, ${report.errors} error(s)`,
		);

		// Drift is reported and converged by default; --fail-on-drift makes it a
		// CI signal without changing what the run did. Either is a finding: the
		// run itself succeeded, so it exits 1 through `CliExit`, not by failing.
		if (report.errors > 0 || (input.failOnDrift && report.drifted > 0)) {
			yield* CliExit.set(1);
		}
	});

/**
 * The `sync` command.
 *
 * @public
 */
export const syncCommand = Command.make(
	"sync",
	{
		dryRun: Flag.Boolean("dry-run").pipe(
			Flag.withDefault(false),
			Flag.withDescription("Report what would change without writing anything"),
		),
		noCleanup: Flag.Boolean("no-cleanup").pipe(
			Flag.withDefault(false),
			Flag.withDescription("Skip deletion of undeclared resources"),
		),
		failOnDrift: Flag.Boolean("fail-on-drift").pipe(
			Flag.withDefault(false),
			Flag.withDescription("Exit non-zero when a resource was changed outside reposets"),
		),
		group: Flag.String("group").pipe(Flag.optional, Flag.withDescription("Sync only this group")),
		repo: Flag.String("repo").pipe(Flag.optional, Flag.withDescription("Sync only this repository")),
		only: Flag.String("only").pipe(Flag.atLeast(0), Flag.withDescription("Run only these phases")),
		skip: Flag.String("skip").pipe(Flag.atLeast(0), Flag.withDescription("Skip these phases")),
		debug: Flag.Boolean("debug").pipe(
			Flag.withDefault(false),
			Flag.withDescription("Annotate output with value sources and the fingerprints behind a drift report"),
		),
	},
	(input) =>
		syncHandler({
			dryRun: input.dryRun,
			noCleanup: input.noCleanup,
			failOnDrift: input.failOnDrift,
			group: Option.getOrUndefined(input.group),
			repo: Option.getOrUndefined(input.repo),
			only: input.only,
			skip: input.skip,
			debug: input.debug,
		}),
).pipe(Command.withDescription("Apply the config to every repository in a group, or all groups"));
