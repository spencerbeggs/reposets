import { describe, expect, it } from "vitest";
import { undefinedCredentialLabels } from "../../src/lib/credential-labels.js";
import type { Config } from "../../src/schemas/config.js";
import type { Credentials } from "../../src/schemas/credentials.js";

/**
 * The sync-time equivalent compares against resolved *values*, so it can only
 * fire once a run has authenticated and reached the secrets phase — by which
 * point earlier phases have already written to GitHub. This compares against
 * the labels a profile declares, which needs neither network nor token.
 */

const config = (overrides: Partial<Config>): Config =>
	({
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

const creds = (resolve: Record<string, unknown>): Credentials =>
	({ profiles: { me: { username: "acme", github_token: { env: "GH" }, resolve } } }) as Credentials;

describe("undefinedCredentialLabels", () => {
	it("flags a resolved entry whose label the profile does not declare", () => {
		const found = undefinedCredentialLabels(
			config({
				secrets: { app: { resolved: { APP_ID: "SILK_APP_ID" } } },
				groups: { g: { repos: ["r"], credentials: "me", secrets: { actions: ["app"] } } },
			} as unknown as Partial<Config>),
			creds({ op: { SOMETHING_ELSE: "op://v/i/f" } }),
		);

		expect(found).toHaveLength(1);
		expect(found[0]?.label).toBe("SILK_APP_ID");
		expect(found[0]?.where).toBe("app.APP_ID");
	});

	it("accepts a label declared in any sub-group, including value", () => {
		// `value` is the sub-group the resolver used to ignore entirely, so a
		// check that overlooked it here would reproduce the same bug one layer up
		// and reject a config that works.
		for (const kind of ["op", "env", "file", "value"] as const) {
			const found = undefinedCredentialLabels(
				config({
					secrets: { app: { resolved: { APP_ID: "SILK_APP_ID" } } },
					groups: { g: { repos: ["r"], credentials: "me", secrets: { actions: ["app"] } } },
				} as unknown as Partial<Config>),
				creds({ [kind]: { SILK_APP_ID: "whatever" } }),
			);
			expect(found, `declared under ${kind}`).toEqual([]);
		}
	});

	it("reports a label once even when its group is assigned to several scopes", () => {
		// A real config assigned one secret group to both actions and dependabot
		// and got the same missing label reported twice.
		const found = undefinedCredentialLabels(
			config({
				secrets: { app: { resolved: { APP_ID: "MISSING" } } },
				groups: {
					g: { repos: ["r"], credentials: "me", secrets: { actions: ["app"], dependabot: ["app"] } },
				},
			} as unknown as Partial<Config>),
			creds({}),
		);

		expect(found).toHaveLength(1);
	});

	it("checks variable groups too", () => {
		const found = undefinedCredentialLabels(
			config({
				variables: { cfg: { resolved: { REGISTRIES: "MISSING" } } },
				groups: { g: { repos: ["r"], credentials: "me", variables: { actions: ["cfg"] } } },
			} as unknown as Partial<Config>),
			creds({}),
		);

		expect(found).toHaveLength(1);
		expect(found[0]?.where).toBe("cfg.REGISTRIES");
	});

	it("checks a secret group and a variable group sharing one name", () => {
		// A real config has `silk-v1` as a settings group, a secret group AND a
		// variable group. The first version of this used
		// `secrets[name] ?? variables[name]`, which checked whichever won and
		// silently skipped the other — so an undeclared label in the variable
		// group of a shared name was invisible.
		const found = undefinedCredentialLabels(
			config({
				secrets: { shared: { resolved: { FROM_SECRETS: "DECLARED" } } },
				variables: { shared: { resolved: { FROM_VARIABLES: "MISSING" } } },
				groups: {
					g: {
						repos: ["r"],
						credentials: "me",
						secrets: { actions: ["shared"] },
						variables: { actions: ["shared"] },
					},
				},
			} as unknown as Partial<Config>),
			creds({ value: { DECLARED: "x" } }),
		);

		expect(found).toHaveLength(1);
		expect(found[0]?.where).toBe("shared.FROM_VARIABLES");
	});

	it("ignores a resolved group no scope assigns", () => {
		// Same rule as the org-only checks: a definition is not an error until a
		// group references it, or a shared section becomes unfixable.
		const found = undefinedCredentialLabels(
			config({
				secrets: { unused: { resolved: { APP_ID: "MISSING" } } },
				groups: { g: { repos: ["r"], credentials: "me" } },
			} as unknown as Partial<Config>),
			creds({}),
		);

		expect(found).toEqual([]);
	});

	it("says nothing about non-resolved kinds", () => {
		const found = undefinedCredentialLabels(
			config({
				secrets: { inline: { value: { API_URL: "https://example.test" } } },
				groups: { g: { repos: ["r"], credentials: "me", secrets: { actions: ["inline"] } } },
			} as unknown as Partial<Config>),
			creds({}),
		);

		expect(found).toEqual([]);
	});
});
