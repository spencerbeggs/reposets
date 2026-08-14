import type { RecordedCall } from "@effected/github";
import { GitHubClient } from "@effected/github";
import type { Layer } from "effect";

/**
 * Query helpers over a {@link GitHubClient.layerFixture} recording.
 *
 * @remarks
 * Ergonomics only — no client behaviour. The double this used to wrap is gone:
 * the resource services moved to `@effected/github`, and the fixture records
 * `request`, `requestDecoded` and `graphql` with their params.
 *
 * A route with **no fixture entry dies** rather than answering `{}`, so a write
 * whose response nothing reads still needs an entry. That is why the phase
 * suite declares its accepted writes once — see `WRITES_ACCEPTED`.
 */
export interface Recorder {
	readonly layer: Layer.Layer<GitHubClient>;
	/** Every call the fixture served, in order, whatever the surface. */
	readonly calls: ReadonlyArray<RecordedCall>;
	/** The REST routes hit, in order. */
	readonly routes: () => ReadonlyArray<string>;
	/** Every GraphQL call, in order. */
	readonly graphqls: () => ReadonlyArray<{ readonly document: string; readonly variables: Record<string, unknown> }>;
	/** The single recorded call for `route`, or a throw if it was not hit exactly once. */
	readonly only: (route: string) => RecordedCall;
}

/** Build a recording `GitHubClient` over the package's own fixture layer. */
/**
 * Routes the resource services read through `paginate`, and the key their
 * response wraps the items in.
 *
 * @remarks
 * These were single-page `request` reads until `@effected/github` found that
 * every one of them silently truncated at the first page — worst in the ruleset
 * existence check, where an unseen ruleset past page one turned an update into a
 * create.
 *
 * `layerFixture` keys `paginate` separately from `request`, which is what made
 * the change visible here: 33 tests failed with `no fixture for` rather than
 * passing against a stale stub. Routing them centrally keeps each test writing
 * the response shape GitHub actually returns.
 *
 * `null` means the response *is* the array.
 */
const PAGINATED: Readonly<Record<string, string | null>> = {
	"GET /repos/{owner}/{repo}/actions/secrets": "secrets",
	"GET /repos/{owner}/{repo}/dependabot/secrets": "secrets",
	"GET /repos/{owner}/{repo}/codespaces/secrets": "secrets",
	"GET /repos/{owner}/{repo}/environments/{environment_name}/secrets": "secrets",
	"GET /repos/{owner}/{repo}/actions/variables": "variables",
	"GET /repos/{owner}/{repo}/environments/{environment_name}/variables": "variables",
	"GET /repos/{owner}/{repo}/actions/workflows": "workflows",
	"GET /repos/{owner}/{repo}/environments": "environments",
	"GET /repos/{owner}/{repo}/rulesets": null,
};

export const recorder = (
	request: Readonly<Record<string, unknown>> = {},
	graphql: Readonly<Record<string, unknown>> = {},
): Recorder => {
	const requested: RecordedCall[] = [];

	const single: Record<string, unknown> = {};
	const paged: Record<string, ReadonlyArray<unknown>> = {};

	for (const [route, response] of Object.entries(request)) {
		const envelope = PAGINATED[route];
		if (envelope === undefined) {
			single[route] = response;
			continue;
		}
		const items = envelope === null ? response : (response as Record<string, unknown>)[envelope];
		paged[route] = Array.isArray(items) ? items : [];
	}

	const layer = GitHubClient.layerFixture({ request: single, graphql, paginate: paged, requested });

	const rest = (): ReadonlyArray<RecordedCall> => requested.filter((call) => call.kind !== "graphql");

	return {
		layer,
		calls: requested,
		routes: () => rest().map((call) => call.route),
		graphqls: () =>
			requested
				.filter((call) => call.kind === "graphql")
				.map((call) => ({ document: call.route, variables: call.params })),
		only: (route) => {
			const matches = rest().filter((call) => call.route === route);
			if (matches.length !== 1) {
				throw new Error(
					`expected exactly one call to "${route}", got ${matches.length}. Routes hit: ${rest()
						.map((call) => call.route)
						.join(", ")}`,
				);
			}
			return matches[0] as RecordedCall;
		},
	};
};
