import type { OwnerType } from "@effected/github";
import type { CacheError } from "@effected/store";
import { Cache } from "@effected/store";
import { Context, Duration, Effect, Layer, Schema } from "effect";

export type { OwnerType };

/**
 * Team ids effectively never change: a team keeps its id across renames, and a
 * deleted team's id is never reissued.
 */
const TEAM_TTL = Duration.days(30);

/**
 * An account's type changes only when a user converts to an organization — a
 * one-way, deliberate, rare act.
 */
const OWNER_TTL = Duration.days(30);

/**
 * Short by design. The language breakdown gates which CodeQL languages get
 * configured, so a stale list silently under-configures code scanning on a repo
 * that just gained a language. Ten minutes covers a multi-repo run without
 * outliving it.
 */
const LANGUAGES_TTL = Duration.minutes(10);

const TeamId = Schema.fromJsonString(Schema.Int);
const Owner = Schema.fromJsonString(Schema.Literals(["User", "Organization"]));
const Languages = Schema.fromJsonString(Schema.Array(Schema.String));
const Private = Schema.fromJsonString(Schema.Boolean);
const Count = Schema.fromJsonString(Schema.Number);

/**
 * The cache's operations.
 *
 * @remarks
 * Every operation is read-through: it takes the key parts plus the `Effect`
 * that fetches on a miss, and returns either the cached value or the fetched
 * one. The caller never sees whether it hit.
 *
 * @public
 */
export interface RepoCacheShape {
	/**
	 * A team's numeric id, by org and team slug.
	 *
	 * @remarks
	 * Keyed `team:{org}/{slug}`, tagged `team`.
	 */
	readonly teamId: <E, R>(
		org: string,
		slug: string,
		onMiss: Effect.Effect<number, E, R>,
	) => Effect.Effect<number, E | CacheError, R>;
	/**
	 * Whether an account is a user or an organization.
	 *
	 * @remarks
	 * Keyed `owner:{owner}`, tagged `owner`.
	 */
	readonly ownerType: <E, R>(
		owner: string,
		onMiss: Effect.Effect<OwnerType, E, R>,
	) => Effect.Effect<OwnerType, E | CacheError, R>;
	/**
	 * The languages GitHub detects in a repository.
	 *
	 * @remarks
	 * Keyed `langs:{owner}/{repo}`, tagged `langs`. Held briefly — see
	 * {@link RepoCache}.
	 */
	readonly repoLanguages: <E, R>(
		owner: string,
		repo: string,
		onMiss: Effect.Effect<ReadonlyArray<string>, E, R>,
	) => Effect.Effect<ReadonlyArray<string>, E | CacheError, R>;

	/**
	 * Whether the repository is private.
	 *
	 * @remarks
	 * Read only when a settings group uses a field GitHub gates on visibility,
	 * so a config that never mentions one never pays for it.
	 *
	 * Keyed `private:{owner}/{repo}`, tagged `repo`. Held as briefly as
	 * languages: visibility changes rarely, but a stale `true` would send a
	 * field GitHub then rejects, which is the failure this exists to avoid.
	 */
	/**
	 * How many workflow files the repository has.
	 *
	 * @remarks
	 * Only consulted when a code-scanning group configures the `actions`
	 * language, which GitHub validates against workflow files rather than
	 * against repository languages.
	 *
	 * Keyed `workflows:{owner}/{repo}`, tagged `repo`.
	 */
	readonly repoWorkflows: <E, R>(
		owner: string,
		repo: string,
		onMiss: Effect.Effect<number, E, R>,
	) => Effect.Effect<number, E | CacheError, R>;

	readonly repoPrivate: <E, R>(
		owner: string,
		repo: string,
		onMiss: Effect.Effect<{ readonly private: boolean }, E, R>,
	) => Effect.Effect<boolean, E | CacheError, R>;
}

/**
 * The three GitHub lookups worth not repeating, held on disk between runs.
 *
 * @remarks
 * A sync run asks the same questions once per repo — what is this owner, what
 * is that team's id, what languages does this repo have — and the answers are
 * either immutable or slow-moving. Caching them on disk turns a group of twenty
 * repos from twenty round trips into one, and turns the second run of the day
 * into none.
 *
 * The read-through, the byte encoding and the decode-drift policy all live in
 * `@effected/store`'s `Cache.through` now. It takes a `Codec<A, string>` and
 * handles the last step to bytes itself, so nothing here touches a
 * `TextEncoder`. A stale entry that no longer decodes is treated as a miss and
 * overwritten — the package's documented contract, not a local choice.
 *
 * `CacheError` stays in the failure channel rather than being swallowed. A
 * cache whose database is unreadable is a real, reportable condition, and a
 * caller that would rather push through can say so with `Effect.catchTag`.
 *
 * TTLs are policy, not configuration: team ids and owner types are held for 30
 * days, repository languages for 10 minutes.
 *
 * @public
 */
export class RepoCache extends Context.Service<RepoCache, RepoCacheShape>()("reposets/RepoCache", {
	make: Effect.gen(function* () {
		const cache = yield* Cache;

		// `Cache.through` reads `Cache` from context rather than taking it as an
		// argument. Providing the instance captured here keeps it out of every
		// caller's `R` — this service already requires it, so asking again would
		// be asking twice for the same thing.
		const withCache = <A, E, R>(effect: Effect.Effect<A, E, R | Cache>): Effect.Effect<A, E, R> =>
			Effect.provideService(effect, Cache, cache);

		return {
			teamId: (org, slug, onMiss) =>
				withCache(Cache.through(`team:${org}/${slug}`, TeamId, { ttl: TEAM_TTL, tags: ["team"] })(onMiss)),

			ownerType: (owner, onMiss) =>
				withCache(Cache.through(`owner:${owner}`, Owner, { ttl: OWNER_TTL, tags: ["owner"] })(onMiss)),

			repoLanguages: (owner, repo, onMiss) =>
				withCache(Cache.through(`langs:${owner}/${repo}`, Languages, { ttl: LANGUAGES_TTL, tags: ["langs"] })(onMiss)),

			repoWorkflows: (owner, repo, onMiss) =>
				withCache(Cache.through(`workflows:${owner}/${repo}`, Count, { ttl: LANGUAGES_TTL, tags: ["repo"] })(onMiss)),

			repoPrivate: (owner, repo, onMiss) =>
				withCache(
					Cache.through(`private:${owner}/${repo}`, Private, { ttl: LANGUAGES_TTL, tags: ["repo"] })(
						// Only the flag is cached, never the whole repository payload:
						// it is large, it changes constantly, and none of the rest is
						// wanted here.
						Effect.map(onMiss, (repository) => repository.private),
					),
				),
		} satisfies RepoCacheShape;
	}),
}) {}

/**
 * Live cache, over the ambient {@link Cache}.
 *
 * @public
 */
export const RepoCacheLive: Layer.Layer<RepoCache, never, Cache> = Layer.effect(RepoCache, RepoCache.make);
