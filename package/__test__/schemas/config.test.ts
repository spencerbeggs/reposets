import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { ConfigSchema, GroupSchema } from "../../src/schemas/config.js";

const decodeConfig = Schema.decodeUnknownSync(ConfigSchema);
const decodeGroup = Schema.decodeUnknownSync(GroupSchema);

describe("GroupSchema", () => {
	it("accepts minimal group", () => {
		const result = decodeGroup({ repos: ["repo-one"] });
		expect(result.repos).toEqual(["repo-one"]);
	});

	it("accepts full group", () => {
		const result = decodeGroup({
			owner: "savvy-web",
			repos: ["repo-one", "repo-two"],
			credentials: "work",
			settings: ["oss-defaults"],
			secrets: { actions: ["deploy"], dependabot: ["deploy"], codespaces: ["deploy"] },
			variables: { actions: ["common"] },
			rulesets: ["workflow"],
			cleanup: { rulesets: false },
		});
		expect(result.owner).toBe("savvy-web");
	});

	it("rejects group without repos", () => {
		expect(() => decodeGroup({})).toThrow();
	});
});

describe("ConfigSchema", () => {
	it("accepts minimal config", () => {
		const result = decodeConfig({
			groups: { mygroup: { repos: ["repo-one"] } },
		});
		expect(result.groups.mygroup.repos).toEqual(["repo-one"]);
	});

	it("accepts secrets with file kind", () => {
		const result = decodeConfig({
			secrets: { certs: { file: { APP_KEY: "./private/key" } } },
			groups: { g: { repos: ["r"] } },
		});
		expect("file" in result.secrets.certs).toBe(true);
	});

	it("accepts secrets with value kind", () => {
		const result = decodeConfig({
			secrets: { static: { value: { API_URL: "https://api.example.com" } } },
			groups: { g: { repos: ["r"] } },
		});
		expect("value" in result.secrets.static).toBe(true);
	});

	it("accepts secrets with resolved kind", () => {
		const result = decodeConfig({
			secrets: { creds: { resolved: { APP_ID: "SILK_APP_ID" } } },
			groups: { g: { repos: ["r"] } },
		});
		expect("resolved" in result.secrets.creds).toBe(true);
	});

	it("accepts variables with value kind", () => {
		const result = decodeConfig({
			variables: { turbo: { value: { DO_NOT_TRACK: "1" } } },
			groups: { g: { repos: ["r"] } },
		});
		expect("value" in result.variables.turbo).toBe(true);
	});

	it("accepts full config with new schema", () => {
		const result = decodeConfig({
			owner: "spencerbeggs",
			settings: { defaults: { has_wiki: false } },
			secrets: {
				"app-creds": { resolved: { APP_ID: "SILK_APP_ID" } },
				certs: { file: { CERT: "./private/cert.pem" } },
			},
			variables: {
				turbo: { value: { DO_NOT_TRACK: "1" } },
				bot: { resolved: { BOT_NAME: "SILK_BOT_NAME" } },
			},
			rulesets: {
				workflow: { name: "workflow", enforcement: "active", rules: [{ type: "deletion" }] },
			},
			groups: {
				silk: {
					repos: ["repo-one"],
					secrets: { actions: ["app-creds", "certs"] },
					variables: { actions: ["turbo", "bot"] },
					rulesets: ["workflow"],
				},
			},
		});
		expect(result.owner).toBe("spencerbeggs");
	});

	it("applies defaults for optional sections", () => {
		const result = decodeConfig({
			groups: { mygroup: { repos: ["repo-one"] } },
		});
		expect(result.settings).toEqual({});
		expect(result.secrets).toEqual({});
		expect(result.variables).toEqual({});
		expect(result.rulesets).toEqual({});
	});

	it("parses log_level field with valid values", () => {
		const result = decodeConfig({
			groups: { g: { repos: ["r"] } },
			log_level: "verbose",
		});
		expect(result.log_level).toBe("verbose");
	});

	it("defaults log_level to info when omitted", () => {
		const result = decodeConfig({
			groups: { g: { repos: ["r"] } },
		});
		expect(result.log_level).toBe("info");
	});

	it("rejects invalid log_level values", () => {
		expect(() =>
			decodeConfig({
				groups: { g: { repos: ["r"] } },
				log_level: "banana",
			}),
		).toThrow();
	});
});
