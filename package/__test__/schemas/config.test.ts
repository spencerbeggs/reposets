import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { ConfigSchema, RepoGroupSchema } from "../../src/schemas/config.js";

const decodeConfig = Schema.decodeUnknownSync(ConfigSchema);
const decodeRepoGroup = Schema.decodeUnknownSync(RepoGroupSchema);

describe("RepoGroupSchema", () => {
	it("accepts minimal repo group", () => {
		const result = decodeRepoGroup({ names: ["repo-one"] });
		expect(result.names).toEqual(["repo-one"]);
	});

	it("accepts full repo group", () => {
		const result = decodeRepoGroup({
			owner: "savvy-web",
			names: ["repo-one", "repo-two"],
			credentials: "work",
			settings: ["oss-defaults"],
			secrets: { actions: ["deploy"], dependabot: ["deploy"], codespaces: ["deploy"] },
			variables: { actions: ["common"] },
			rulesets: ["standard"],
			cleanup: { rulesets: false },
		});
		expect(result.owner).toBe("savvy-web");
		expect(result.credentials).toBe("work");
		expect(result.secrets?.actions).toEqual(["deploy"]);
		expect(result.variables?.actions).toEqual(["common"]);
	});

	it("rejects repo group without names", () => {
		expect(() => decodeRepoGroup({})).toThrow();
	});
});

describe("ConfigSchema", () => {
	it("accepts minimal config", () => {
		const result = decodeConfig({
			repos: { mygroup: { names: ["repo-one"] } },
		});
		expect(result.repos.mygroup.names).toEqual(["repo-one"]);
	});

	it("accepts full config", () => {
		const result = decodeConfig({
			owner: "spencerbeggs",
			settings: { "oss-defaults": { has_wiki: false, has_issues: true } },
			secrets: { deploy: { NPM_TOKEN: { op: "op://vault/item" } } },
			variables: { common: { NODE_ENV: { value: "production" } } },
			rulesets: { standard: { workflow: { file: "./rulesets/workflow.json" } } },
			cleanup: { secrets: true, variables: true },
			repos: {
				"oss-projects": {
					names: ["repo-one"],
					settings: ["oss-defaults"],
					secrets: { actions: ["deploy"] },
					variables: { actions: ["common"] },
					rulesets: ["standard"],
				},
			},
		});
		expect(result.owner).toBe("spencerbeggs");
		expect(result.settings?.["oss-defaults"]).toEqual({ has_wiki: false, has_issues: true });
	});

	it("applies defaults for optional sections", () => {
		const result = decodeConfig({
			repos: { mygroup: { names: ["repo-one"] } },
		});
		expect(result.settings).toEqual({});
		expect(result.secrets).toEqual({});
		expect(result.variables).toEqual({});
		expect(result.rulesets).toEqual({});
	});
});
