import type { GitHubError, Repo, SecretScope } from "@effected/github";
import {
	DeploymentEnvironment,
	RepositorySecret,
	RepositoryVariable,
	Ruleset as RulesetService,
} from "@effected/github";
import { Effect } from "effect";
import type { CleanupScope } from "../../schemas/common.js";
import { SyncLogger } from "../../services/SyncLogger.js";
import { AppliedState } from "../../store/AppliedState.js";
import type { ChangeRecord } from "../../store/SyncJournal.js";
import type { Phase, PhaseResult, RepoContext } from "../phase.js";
import { emptyResult } from "../phase.js";
import { capture, declaredNames, read } from "./resource.js";

/** The secret stores that live on the repository rather than an environment. */
const SECRET_SCOPES: ReadonlyArray<SecretScope> = ["actions", "dependabot", "codespaces"];

/**
 * One live resource, and how to remove it.
 *
 * @remarks
 * `remove` is a closure rather than a name because the delete calls do not
 * agree on what identifies a resource: a ruleset is deleted by its numeric id
 * while everything else is deleted by name. Carrying the prepared effect keeps
 * that difference inside the one function that knows about it.
 */
interface Sweepable {
	/** The resource's own name, as it is matched against the declared set. */
	readonly name: string;
	/**
	 * Delete it.
	 *
	 * @remarks
	 * A **thunk**, not a prepared effect. `GitHubClient.layerFixture` records a
	 * call when the request function is *invoked*, not when the effect it returns
	 * is run — so building a delete for every live resource and running only some
	 * of them records deletions that never happened. A thunk means nothing is
	 * built until it is about to be performed.
	 */
	readonly remove: () => Effect.Effect<void, GitHubError, Repo>;
}

/**
 * Which live resources a scope permits deleting.
 *
 * @remarks
 * Total over the three-way union, and the reason it is a separate pure function
 * is that it is the only place the policy is decided — every sweep below routes
 * through it, so `preserve` cannot be honoured in one scope and forgotten in
 * another.
 */
const undeclared = (
	live: ReadonlyArray<Sweepable>,
	declared: ReadonlySet<string>,
	scope: CleanupScope,
): ReadonlyArray<Sweepable> => {
	if (scope === false) return [];
	const preserved = scope === true ? new Set<string>() : new Set(scope.preserve);
	return live.filter((entry) => !declared.has(entry.name) && !preserved.has(entry.name));
};

/** Whether any scope in a group's cleanup config is turned on. */
const anyEnabled = (cleanup: RepoContext["config"]["groups"][string]["cleanup"]): boolean => {
	if (cleanup === undefined) return false;
	const scopes: ReadonlyArray<CleanupScope> = [
		cleanup.secrets.actions,
		cleanup.secrets.dependabot,
		cleanup.secrets.codespaces,
		cleanup.secrets.environments,
		cleanup.variables.actions,
		cleanup.variables.environments,
		cleanup.rulesets,
		cleanup.environments,
	];
	return scopes.some((scope) => scope !== false);
};

/**
 * Delete undeclared resources.
 *
 * @remarks
 * This phase is the only one that removes anything, and it runs last because
 * every other phase's writes define what "declared" means.
 *
 * **An enabled scope with nothing declared deletes everything in that scope.**
 * That is the literal reading of "delete what the config does not declare", and
 * it is deliberate rather than an oversight: a group that turns on
 * `cleanup.secrets.actions` and references no secret groups is saying this
 * repository should have no Actions secrets, which is a legitimate thing to
 * say and the only way to say it. It is also the most destructive thing in this
 * program, so every deletion is named in the output and `--dry-run` lists them
 * without touching anything.
 *
 * **An organization's rulesets are never deleted.** `listRulesets` returns
 * rulesets inherited from the org alongside the repository's own, and they are
 * not this repository's to remove — deleting one would change policy for every
 * repository in the organization. They are filtered out before anything is
 * considered undeclared, and a test pins it.
 *
 * **Every deletion forgets its applied-state row.** Leaving the row behind
 * would make the next run compare a recreated resource against a fingerprint
 * from before the deletion and report drift that nobody caused.
 *
 * Nothing here reads a secret value. Deciding what to delete needs names, which
 * {@link declaredNames} takes from the config without opening a file.
 *
 * @public
 */
export const cleanupPhase = Effect.gen(function* () {
	const secrets = yield* RepositorySecret;
	const variables = yield* RepositoryVariable;
	const rulesets = yield* RulesetService;
	const environments = yield* DeploymentEnvironment;
	const applied = yield* AppliedState;
	const logger = yield* SyncLogger;

	/**
	 * Sweep one scope.
	 *
	 * @remarks
	 * A disabled scope returns before the listing, so cleanup that is off costs
	 * no round trip — the same reason `appliesTo` exists at the phase level.
	 */
	const sweep = (
		ctx: RepoContext,
		options: {
			readonly scope: CleanupScope;
			/** The applied-state kind, which must match what the writing phase recorded. */
			readonly kind: string;
			/** The word the summary line uses: "actions secret", "environment". */
			readonly resource: string;
			readonly declared: ReadonlySet<string>;
			/**
			 * List what is there.
			 *
			 * @remarks
			 * A thunk for the same reason {@link Sweepable.remove} is one, and it
			 * carries the guarantee this phase most needs to keep: **a disabled scope
			 * issues no request at all**, which is only true if the listing is never
			 * even constructed.
			 */
			readonly live: () => Effect.Effect<ReadonlyArray<Sweepable>, GitHubError, Repo>;
			/**
			 * The applied-state name for a live resource.
			 *
			 * @remarks
			 * Must agree with the writing phase's own naming — `actions/TOKEN` for a
			 * repository secret, `env:prod/TOKEN` for an environment's — or the row
			 * is not the one that gets forgotten.
			 */
			readonly appliedName: (name: string) => string;
		},
	): Effect.Effect<PhaseResult, never, Repo> =>
		Effect.gen(function* () {
			if (options.scope === false) return emptyResult;

			const listing = yield* read(options.live());
			if ("failed" in listing) {
				return { changes: [], errors: [{ context: `list ${options.resource}s`, message: listing.failed }] };
			}

			const targets = undeclared(listing.value, options.declared, options.scope);
			if (targets.length === 0) return emptyResult;

			const changes: ChangeRecord[] = [];
			const errors: Array<{ readonly context: string; readonly message: string }> = [];
			const deleted: string[] = [];

			for (const target of targets) {
				if (!ctx.dryRun) {
					const failure = yield* capture(`delete ${options.resource} ${target.name}`, target.remove());
					if (failure !== undefined) {
						errors.push(failure);
						continue;
					}

					// The row must go with the resource: a later run that recreates it
					// would otherwise compare against a fingerprint from before the
					// deletion and report drift nobody caused.
					yield* applied
						.forget({ repo: ctx.slug, kind: options.kind, name: options.appliedName(target.name) })
						.pipe(Effect.ignore);
				}

				deleted.push(target.name);
				changes.push({
					repo: ctx.slug,
					kind: options.kind,
					name: options.appliedName(target.name),
					action: "deleted",
				});
			}

			if (deleted.length > 0) {
				yield* logger.cleanupSummary(options.resource, deleted.length, deleted);
			}

			return { changes, errors };
		});

	const run = (ctx: RepoContext): Effect.Effect<PhaseResult, never, Repo> =>
		Effect.gen(function* () {
			const group = ctx.config.groups[ctx.group];
			const cleanup = group?.cleanup;
			if (group === undefined || cleanup === undefined) return emptyResult;

			const results: PhaseResult[] = [];

			// --- secrets, per repository-level store -----------------------------
			for (const scope of SECRET_SCOPES) {
				results.push(
					yield* sweep(ctx, {
						scope: cleanup.secrets[scope],
						kind: "secret",
						resource: `${scope} secret`,
						declared: declaredNames(group.secrets?.[scope] ?? [], ctx.config.secrets),
						live: () =>
							secrets.list(scope).pipe(
								Effect.map((list) =>
									list.map((entry) => ({
										name: entry.name,
										remove: () => secrets.delete(entry.name, scope),
									})),
								),
							),
						appliedName: (name) => `${scope}/${name}`,
					}),
				);
			}

			// --- secrets, per environment ----------------------------------------
			for (const [environment, refs] of Object.entries(group.secrets?.environments ?? {})) {
				results.push(
					yield* sweep(ctx, {
						scope: cleanup.secrets.environments,
						kind: "secret",
						resource: `${environment} environment secret`,
						declared: declaredNames(refs, ctx.config.secrets),
						live: () =>
							secrets.listForEnvironment(environment).pipe(
								Effect.map((list) =>
									list.map((entry) => ({
										name: entry.name,
										remove: () => secrets.deleteForEnvironment(environment, entry.name),
									})),
								),
							),
						appliedName: (name) => `env:${environment}/${name}`,
					}),
				);
			}

			// --- variables, repository level --------------------------------------
			results.push(
				yield* sweep(ctx, {
					scope: cleanup.variables.actions,
					kind: "variable",
					resource: "variable",
					declared: declaredNames(group.variables?.actions ?? [], ctx.config.variables),
					live: () =>
						variables.list().pipe(
							Effect.map((list) =>
								list.map((entry) => ({
									name: entry.name,
									remove: () => variables.delete(entry.name),
								})),
							),
						),
					appliedName: (name) => name,
				}),
			);

			// --- variables, per environment ---------------------------------------
			for (const [environment, refs] of Object.entries(group.variables?.environments ?? {})) {
				results.push(
					yield* sweep(ctx, {
						scope: cleanup.variables.environments,
						kind: "variable",
						resource: `${environment} environment variable`,
						declared: declaredNames(refs, ctx.config.variables),
						live: () =>
							variables.listForEnvironment(environment).pipe(
								Effect.map((list) =>
									list.map((entry) => ({
										name: entry.name,
										remove: () => variables.deleteForEnvironment(environment, entry.name),
									})),
								),
							),
						appliedName: (name) => `${environment}/${name}`,
					}),
				);
			}

			// --- rulesets -----------------------------------------------------------
			const declaredRulesets = new Set(
				(group.rulesets ?? []).map((ref) => ctx.config.rulesets[ref]?.name).filter((name) => name !== undefined),
			);

			results.push(
				yield* sweep(ctx, {
					scope: cleanup.rulesets,
					kind: "ruleset",
					resource: "ruleset",
					declared: declaredRulesets,
					live: () =>
						rulesets.list().pipe(
							Effect.map((list) =>
								list
									// An inherited ruleset belongs to the organization. Deleting one
									// would rewrite policy for every repository the org owns, from a
									// repository-scoped config that never mentioned it.
									.filter((entry) => entry.source_type !== "Organization")
									.map((entry) => ({
										name: entry.name,
										remove: () => rulesets.delete(entry.id),
									})),
							),
						),
					appliedName: (name) => name,
				}),
			);

			// --- environments -------------------------------------------------------
			results.push(
				yield* sweep(ctx, {
					scope: cleanup.environments,
					kind: "environment",
					resource: "environment",
					declared: new Set(group.environments ?? []),
					live: () =>
						environments.list().pipe(
							Effect.map((list) =>
								list.map((entry) => ({
									name: entry.name,
									remove: () => environments.delete(entry.name),
								})),
							),
						),
					appliedName: (name) => name,
				}),
			);

			return {
				changes: results.flatMap((result) => result.changes),
				errors: results.flatMap((result) => result.errors),
			};
		});

	return {
		name: "cleanup",
		/**
		 * `--no-cleanup` declines here rather than inside `run`, so the flag costs
		 * nothing and reads as "this phase has nothing to do" — which is what the
		 * user asked for by passing it.
		 */
		appliesTo: (ctx) => !ctx.noCleanup && anyEnabled(ctx.config.groups[ctx.group]?.cleanup),
		run,
	} satisfies Phase;
});
