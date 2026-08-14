import { describe, expect, it } from "vitest";
import { danglingReferences } from "../../src/lib/config-refs.js";
import type { Config } from "../../src/schemas/config.js";

/**
 * The check v3 had, the rebuild dropped, and nothing replaced. Its absence was
 * silent by construction: every phase skips an unresolvable reference without
 * reporting it, citing the dropped validator by name as the thing that owned
 * the check, so a misspelled section synced nothing and `validate` printed
 * `Valid:`.
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

const group = (assignment: Record<string, unknown>) => ({
	g: { repos: ["r"], credentials: "me", ...assignment },
});

describe("danglingReferences", () => {
	it("flags a misspelled settings reference and shows what is defined", () => {
		const found = danglingReferences(
			config({
				settings: { defaults: {} },
				groups: group({ settings: ["defualt"] }),
			} as unknown as Partial<Config>),
		);

		expect(found).toHaveLength(1);
		expect(found[0]?.where).toBe("groups.g.settings");
		expect(found[0]?.name).toBe("defualt");
		// The near-miss is the whole value of the report: nearly every one of
		// these is a typo, and a typo is fixed by seeing the correct spelling.
		expect(found[0]?.defined).toEqual(["defaults"]);
	});

	it("checks every reference array a group can carry", () => {
		const found = danglingReferences(
			config({
				groups: group({
					settings: ["a"],
					rulesets: ["b"],
					environments: ["c"],
					security: ["d"],
					code_scanning: ["e"],
					secrets: { actions: ["f"], dependabot: ["g"], codespaces: ["h"] },
					variables: { actions: ["i"] },
				}),
			} as unknown as Partial<Config>),
		);

		// Nine references, nothing defined anywhere. A check that covered only
		// the arrays someone remembered would still pass a narrower test.
		expect(found.map((f) => f.name).sort()).toEqual(["a", "b", "c", "d", "e", "f", "g", "h", "i"]);
	});

	it("flags both halves of an environment-scoped assignment", () => {
		// Two references per entry — the environment keying the record and the
		// groups inside it — and either can dangle on its own.
		const found = danglingReferences(
			config({
				secrets: { app: { value: {} } },
				environments: { staging: {} },
				groups: group({ secrets: { environments: { nosuchenv: ["app"], staging: ["nosuchgroup"] } } }),
			} as unknown as Partial<Config>),
		);

		expect(found.map((f) => f.name).sort()).toEqual(["nosuchenv", "nosuchgroup"]);
	});

	it("says nothing when every reference resolves", () => {
		// The control. Without it this suite would pass against a function that
		// flagged every reference it was handed.
		const found = danglingReferences(
			config({
				settings: { defaults: {} },
				rulesets: { protect: {} },
				environments: { staging: {} },
				secrets: { app: { value: {} } },
				variables: { cfg: { value: {} } },
				groups: group({
					settings: ["defaults"],
					rulesets: ["protect"],
					environments: ["staging"],
					secrets: { actions: ["app"], environments: { staging: ["app"] } },
					variables: { actions: ["cfg"], environments: { staging: ["cfg"] } },
				}),
			} as unknown as Partial<Config>),
		);

		expect(found).toEqual([]);
	});

	it("does not flag a defined section no group references", () => {
		// Dead config, not an error — and a config may legitimately define
		// sections that only some groups take.
		const found = danglingReferences(
			config({
				settings: { defaults: {}, unused: {} },
				groups: group({ settings: ["defaults"] }),
			} as unknown as Partial<Config>),
		);

		expect(found).toEqual([]);
	});
});
