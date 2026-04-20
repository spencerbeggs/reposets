import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { ConfigSchema, GroupSchema, SecretScopesSchema, VariableScopesSchema } from "../../src/schemas/config.js";

const decodeConfig = Schema.decodeUnknownSync(ConfigSchema);
const decodeGroup = Schema.decodeUnknownSync(GroupSchema);
const decodeSecretScopes = Schema.decodeUnknownSync(SecretScopesSchema);
const decodeVariableScopes = Schema.decodeUnknownSync(VariableScopesSchema);

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

	it("accepts group-level cleanup with new three-way union structure", () => {
		const result = decodeGroup({
			repos: ["repo-one"],
			cleanup: {
				secrets: { actions: true, dependabot: false },
				variables: { actions: { preserve: ["KEEP_ME"] } },
				rulesets: false,
				environments: true,
			},
		});
		expect(result.cleanup?.secrets?.actions).toBe(true);
		expect(result.cleanup?.variables?.actions).toEqual({ preserve: ["KEEP_ME"] });
		expect(result.cleanup?.environments).toBe(true);
	});

	it("accepts environments array in group", () => {
		const result = decodeGroup({
			repos: ["repo-one"],
			environments: ["staging", "production"],
		});
		expect(result.environments).toEqual(["staging", "production"]);
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
				workflow: { name: "workflow", type: "branch", enforcement: "active", rules: [{ type: "deletion" }] },
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

	it("accepts top-level environments", () => {
		const result = decodeConfig({
			environments: {
				staging: { wait_timer: 5, prevent_self_review: true },
				production: { wait_timer: 30, deployment_branches: "protected" },
			},
			groups: { g: { repos: ["r"] } },
		});
		expect(result.environments).toHaveProperty("staging");
		expect(result.environments?.staging?.wait_timer).toBe(5);
		expect(result.environments).toHaveProperty("production");
	});

	it("applies empty object default for environments when omitted", () => {
		const result = decodeConfig({
			groups: { mygroup: { repos: ["repo-one"] } },
		});
		expect(result.environments).toEqual({});
	});

	it("does NOT have a global cleanup field", () => {
		const result = decodeConfig({
			groups: { g: { repos: ["r"] } },
		});
		expect("cleanup" in result).toBe(false);
	});
});

describe("SecretScopesSchema", () => {
	it("accepts environment-scoped secrets", () => {
		const result = decodeSecretScopes({
			actions: ["deploy"],
			environments: {
				staging: ["app-secrets"],
				production: ["app-secrets", "prod-secrets"],
			},
		});
		expect(result.environments).toHaveProperty("staging");
		expect(result.environments?.staging).toEqual(["app-secrets"]);
		expect(result.environments?.production).toEqual(["app-secrets", "prod-secrets"]);
	});

	it("accepts secret scopes without environments", () => {
		const result = decodeSecretScopes({ actions: ["deploy"], dependabot: ["deploy"] });
		expect(result.actions).toEqual(["deploy"]);
		expect(result.environments).toBeUndefined();
	});
});

describe("VariableScopesSchema", () => {
	it("accepts environment-scoped variables", () => {
		const result = decodeVariableScopes({
			actions: ["common"],
			environments: {
				staging: ["staging-vars"],
				production: ["prod-vars"],
			},
		});
		expect(result.environments).toHaveProperty("staging");
		expect(result.environments?.staging).toEqual(["staging-vars"]);
	});

	it("accepts variable scopes without environments", () => {
		const result = decodeVariableScopes({ actions: ["common"] });
		expect(result.actions).toEqual(["common"]);
		expect(result.environments).toBeUndefined();
	});
});
