import { GitHubRepository, Repo, RepoRef } from "@effected/github";
import type { Redacted } from "effect";
import { Context, Effect, Layer } from "effect";
import type { Config } from "../schemas/config.js";
import type { Credentials } from "../schemas/credentials.js";
import { profileOwner } from "../schemas/credentials.js";
import { CredentialResolver } from "../services/CredentialResolver.js";
import { SyncLogger } from "../services/SyncLogger.js";
import { RepoCache } from "../store/RepoCache.js";
import { SyncJournal } from "../store/SyncJournal.js";
import type { Phase, PhaseName, PhaseResult, RepoContext } from "./phase.js";
import { emptyResult, mergeResults, selectPhases } from "./phase.js";

/**
 * How one run is scoped.
 *
 * @public
 */
export interface SyncOptions {
	readonly dryRun: boolean;
	readonly noCleanup: boolean;
	readonly group?: string | undefined;
	readonly repo?: string | undefined;
	/** Run only these phases. Wins over {@link SyncOptions.skip}. */
	readonly only?: ReadonlySet<PhaseName> | undefined;
	/** Run everything except these phases. */
	readonly skip?: ReadonlySet<PhaseName> | undefined;
	/** Where relative `file` credential references resolve from. */
	readonly configDir: string;
	/**
	 * The journal run to record under.
	 *
	 * @remarks
	 * **The run boundary belongs to the command, not the engine** — a run is one
	 * `sync` invocation, and the engine may be invoked several times within one.
	 * Groups are partitioned by credential profile and each partition gets its
	 * own engine, because a token is fixed at `GitHubClient` construction and a
	 * second identity therefore means a second service graph. An engine that
	 * opened its own run would split one command across several `history` rows
	 * for a reason no reader of `history` can see.
	 */
	readonly runId: string;
}

/**
 * What a whole run did.
 *
 * @public
 */
export interface SyncReport {
	readonly runId: string;
	readonly repos: number;
	readonly changes: number;
	readonly drifted: number;
	readonly errors: number;
	/**
	 * The first error, and how many followed it — or `undefined` on success.
	 *
	 * @remarks
	 * Returned rather than written to the journal here because the caller owns
	 * the run and may run the engine more than once under it. A run over twenty
	 * repositories can fail twenty times for one reason, so the summary carries
	 * the first error and a count; the per-resource records carry the rest.
	 */
	readonly errorSummary?: string | undefined;
}

/**
 * The sync pipeline.
 *
 * @public
 */
export interface SyncEngineShape {
	readonly syncAll: (
		config: Config,
		credentials: Credentials,
		options: SyncOptions,
	) => Effect.Effect<SyncReport, never>;
}

/**
 * Runs the configured phases over every selected repository.
 *
 * @remarks
 * The engine owns sequencing and reporting; it knows nothing about what any
 * phase does. Phases are a list it walks — which is what lets `--only` and
 * `--skip` select a subset without the engine growing a branch per phase.
 *
 * It records changes into a run but does **not** open or close one: the run
 * boundary is the command's, since one `sync` may drive several engines when
 * its groups authenticate as different profiles.
 *
 * **A run never aborts on one repository's failure.** Phases return their errors
 * rather than raising them, so a rejected ruleset on the third repo does not
 * cost the remaining seventeen. Failures are logged inline, accumulated in the
 * journal, and summarised at the end.
 *
 * @public
 */
export class SyncEngine extends Context.Service<SyncEngine, SyncEngineShape>()("reposets/SyncEngine") {}

/**
 * Build the engine from a phase list.
 *
 * @remarks
 * The phases are a parameter rather than an import so the engine can be tested
 * against fakes, and so a phase's dependencies stay in the phase rather than
 * accumulating in the engine's `R`.
 *
 * @public
 */
export function SyncEngineLive<R>(
	makePhases: Effect.Effect<ReadonlyArray<Phase>, never, R>,
): Layer.Layer<SyncEngine, never, R | SyncJournal | SyncLogger | CredentialResolver | RepoCache | GitHubRepository> {
	return Layer.effect(
		SyncEngine,
		Effect.gen(function* () {
			const phases = yield* makePhases;
			const journal = yield* SyncJournal;
			const logger = yield* SyncLogger;
			const resolver = yield* CredentialResolver;
			const cache = yield* RepoCache;
			const repository = yield* GitHubRepository;

			const syncAll: SyncEngineShape["syncAll"] = (config, credentials, options) =>
				Effect.gen(function* () {
					const runId = options.runId;

					const selected = selectPhases(phases, {
						...(options.only === undefined ? {} : { only: options.only }),
						...(options.skip === undefined ? {} : { skip: options.skip }),
					});

					let repos = 0;
					let drifted = 0;
					const results: PhaseResult[] = [];

					for (const [groupName, group] of Object.entries(config.groups)) {
						if (options.group !== undefined && groupName !== options.group) continue;

						// `credentials` is required by the schema, so this is a lookup and
						// never a default. It used to fall back to the first profile in the
						// table when the field was absent, which made the identity a group
						// synced as depend on TOML key order.
						const profile = credentials.profiles[group.credentials];
						// The owner comes from the profile now: a token authenticates as an
						// identity, so the account is a property of the credential rather
						// than of the repositories. `config.owner` and `group.owner` are
						// gone, and with them the fallback chain that could put a group's
						// owner and its token on different accounts.
						const declared = profile === undefined ? undefined : profileOwner(profile);
						const owner = declared?.owner ?? "";
						const declaredType = declared?.ownerType ?? "Organization";

						const targeted =
							options.repo === undefined ? group.repos : group.repos.filter((repo) => repo === options.repo);
						yield* logger.groupStart(groupName, targeted.length, group.repos.length);

						// A `--repo` naming a repository this group does not have is
						// the ordinary case in any config with more than one group, so
						// it is not reported here — see the check after the loop. This
						// used to raise an error per non-matching group, which meant a
						// correct run over a multi-group config exited 1 and failed
						// exactly the CI gate the check exists to protect.
						if (options.repo !== undefined && targeted.length === 0) continue;

						// A group naming a profile that does not exist is an error, not an
						// empty credential set. Treated as the latter it syncs the group
						// with every resolved secret missing, which reads in the output as
						// "nothing to do" — a config typo that silently skips work and
						// still exits 0.
						if (profile === undefined) {
							const known = Object.keys(credentials.profiles);
							const message = `group '${groupName}' names credential profile '${group.credentials}', which does not exist (has: ${known.length === 0 ? "none" : known.join(", ")})`;
							results.push({ changes: [], errors: [{ context: `group ${groupName}`, message }] });
							yield* logger.syncError(`group ${groupName}`, message);
							continue;
						}

						// Resolved once per group: every repository in it shares the
						// profile, and resolving per repository would re-authenticate to
						// 1Password once per repo rather than once per group.
						const resolved = yield* resolver
							.resolveAll(profile, options.configDir)
							.pipe(Effect.orElseSucceed(() => new Map<string, Redacted.Redacted<string>>()));

						for (const repo of group.repos) {
							if (options.repo !== undefined && repo !== options.repo) continue;

							repos += 1;
							yield* logger.repoStart(owner, repo);

							// The one place that knows which repository is in play, and so
							// the one place `Repo` is discharged. Every resource service
							// resolves it per call rather than capturing it, which is what
							// lets one program act on many repositories.
							const ref = RepoRef.make({ owner, repo });

							// The profile DECLARES the owner type; this checks it.
							//
							// Cached across runs and processes — an owner's type changes
							// only when a user converts to an organization. The key is the
							// OWNER, so every repository in a group shares one request.
							//
							// Declaring it is what lets `validate` reject an org-only
							// construct with no network at all. Believing it unverified here
							// would be the same mistake this campaign kept finding: a
							// precondition satisfied by our own assumption, paid for later
							// as a 422 that takes a whole settings PATCH with it.
							//
							// On a failed read the declaration stands, which is strictly
							// better than the previous fallback — that assumed
							// "Organization" for everyone and could send org-only settings
							// to a personal account.
							const observed = yield* cache
								.ownerType(owner, repository.ownerType.pipe(Repo.provide(ref)))
								.pipe(Effect.orElseSucceed(() => declaredType));

							if (observed !== declaredType) {
								const message = `profile '${group.credentials}' declares ${
									declaredType === "User" ? `username = "${owner}"` : `org = "${owner}"`
								}, but GitHub reports ${owner} is ${observed === "User" ? "a user" : "an organization"}`;
								results.push({ changes: [], errors: [{ context: `${owner}/${repo}`, message }] });
								yield* logger.syncError(`${owner}/${repo}`, message);
								continue;
							}

							const ownerType = declaredType;

							const ctx: RepoContext = {
								owner,
								repo,
								slug: `${owner}/${repo}`,
								group: groupName,
								ownerType,
								config,
								credentials: resolved,
								runId,
								dryRun: options.dryRun,
								noCleanup: options.noCleanup,
								configDir: options.configDir,
							};

							for (const phase of selected) {
								if (!phase.appliesTo(ctx)) continue;

								const result = yield* phase.run(ctx).pipe(
									Repo.provide(ref),
									Effect.orElseSucceed(() => emptyResult),
								);
								results.push(result);

								for (const change of result.changes) {
									if (change.action === "drift-overwritten") drifted += 1;
									// Journalling must not fail a run: the record is valuable
									// and never worth aborting a sync over.
									yield* journal.recordChange(runId, change).pipe(Effect.ignore);
								}

								for (const error of result.errors) {
									yield* logger.syncError(error.context, error.message);
								}
							}
						}
					}

					// A `--repo` that matched NO group is a typo, and that is worth an
					// error: left alone it reports "Sync complete!" and exits 0 having
					// done nothing, so a CI job with a misspelled repository passes
					// green — the worst outcome available to a flag whose whole purpose
					// is narrowing a destructive operation.
					//
					// Judged across the whole run rather than per group, because
					// "absent from this group" and "absent from the config" are
					// different claims and only the second is a mistake.
					if (options.repo !== undefined && repos === 0) {
						const known = Object.entries(config.groups)
							.filter(([name]) => options.group === undefined || name === options.group)
							.flatMap(([, group]) => group.repos);
						const message = `no repository named '${options.repo}' in ${
							options.group === undefined ? "any configured group" : `group '${options.group}'`
						} (has: ${known.join(", ") || "none"})`;
						results.push({ changes: [], errors: [{ context: `--repo ${options.repo}`, message }] });
						yield* logger.syncError(`--repo ${options.repo}`, message);
					}

					const merged = mergeResults(results);

					// `finishRun` has always accepted an error and never used to be sent
					// one, so every partial run recorded that it failed and not why —
					// which is the only thing anyone opens a failed run to find out.
					const errorSummary =
						merged.errors.length === 0
							? undefined
							: merged.errors.length === 1
								? `${merged.errors[0]?.context}: ${merged.errors[0]?.message}`
								: `${merged.errors.length} errors, first: ${merged.errors[0]?.context}: ${merged.errors[0]?.message}`;

					return {
						runId,
						repos,
						changes: merged.changes.length,
						drifted,
						errors: merged.errors.length,
						errorSummary,
					};
				});

			return { syncAll } satisfies SyncEngineShape;
		}),
	);
}
