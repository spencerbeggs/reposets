import { describe, expect, it } from "vitest";
import { orgOnlyViolations } from "../../src/lib/org-only.js";
import type { Config } from "../../src/schemas/config.js";
import type { Credentials } from "../../src/schemas/credentials.js";

/**
 * These are the checks that used to require a network call. The owner's type
 * was only knowable by asking GitHub, so `validate` could not make them and the
 * config error surfaced as a 422 partway through a sync instead.
 */

const config = (overrides: Partial<Config>): Config =>
	({
		log_level: "info",
		settings: {},
		secrets: {},
		variables: {},
		rulesets: {},
		environments: {},
		security: {},
		code_scanning: {},
		groups: {},
		...overrides,
	}) as Config;

const creds = (profiles: Record<string, unknown>): Credentials => ({ profiles }) as Credentials;

const personal = creds({ me: { username: "acme", github_token: { env: "GH" } } });
const organisation = creds({ me: { org: "acme-corp", github_token: { env: "GH" } } });

const groupWith = (assignment: Record<string, unknown>) => ({
	g: { repos: ["r"], credentials: "me", ...assignment },
});

describe("orgOnlyViolations", () => {
	it("flags a Team bypass actor assigned to a personal-account group", () => {
		const found = orgOnlyViolations(
			config({
				rulesets: { workflow: { bypass_actors: [{ actor_id: 1, actor_type: "Team", bypass_mode: "always" }] } },
				groups: groupWith({ rulesets: ["workflow"] }),
			} as unknown as Partial<Config>),
			personal,
		);

		expect(found).toHaveLength(1);
		expect(found[0]?.where).toBe("rulesets.workflow.bypass_actors");
		expect(found[0]?.profile).toBe("me");
	});

	it("flags a Team environment reviewer", () => {
		const found = orgOnlyViolations(
			config({
				environments: { staging: { reviewers: [{ id: 7, type: "Team" }] } },
				groups: groupWith({ environments: ["staging"] }),
			} as unknown as Partial<Config>),
			personal,
		);

		expect(found).toHaveLength(1);
		expect(found[0]?.where).toBe("environments.staging.reviewers");
	});

	it("flags delegated bypass settings", () => {
		const found = orgOnlyViolations(
			config({
				settings: { defaults: { secret_scanning_delegated_bypass: "enabled" } },
				groups: groupWith({ settings: ["defaults"] }),
			} as unknown as Partial<Config>),
			personal,
		);

		expect(found).toHaveLength(1);
		expect(found[0]?.where).toBe("settings.defaults.secret_scanning_delegated_bypass");
	});

	it("says nothing when the same config runs under an org profile", () => {
		// The control. Without it these tests would pass just as well against a
		// function that flagged every ruleset it was handed.
		const withTeam = config({
			rulesets: { workflow: { bypass_actors: [{ actor_id: 1, actor_type: "Team", bypass_mode: "always" }] } },
			groups: groupWith({ rulesets: ["workflow"] }),
		} as unknown as Partial<Config>);

		expect(orgOnlyViolations(withTeam, organisation)).toEqual([]);
	});

	it("ignores a definition no group references", () => {
		// A ruleset with a team actor is valid sitting in [rulesets.*] — it only
		// becomes an error when a personal-account group assigns it. Reporting the
		// definition would name a section shared across groups that the user
		// cannot change without breaking the groups that legitimately use it.
		const unreferenced = config({
			rulesets: { workflow: { bypass_actors: [{ actor_id: 1, actor_type: "Team", bypass_mode: "always" }] } },
			groups: groupWith({}),
		} as unknown as Partial<Config>);

		expect(orgOnlyViolations(unreferenced, personal)).toEqual([]);
	});

	it("stays quiet when the profile does not exist", () => {
		// An unknown profile is a different error with its own report. Guessing an
		// owner type here would produce a second diagnosis for one mistake.
		const found = orgOnlyViolations(
			config({
				rulesets: { workflow: { bypass_actors: [{ actor_id: 1, actor_type: "Team", bypass_mode: "always" }] } },
				groups: { g: { repos: ["r"], credentials: "absent", rulesets: ["workflow"] } },
			} as unknown as Partial<Config>),
			personal,
		);

		expect(found).toEqual([]);
	});

	it("reports a User bypass actor as fine", () => {
		const found = orgOnlyViolations(
			config({
				rulesets: {
					workflow: { bypass_actors: [{ actor_id: 1, actor_type: "RepositoryRole", bypass_mode: "always" }] },
				},
				groups: groupWith({ rulesets: ["workflow"] }),
			} as unknown as Partial<Config>),
			personal,
		);

		expect(found).toEqual([]);
	});
});
