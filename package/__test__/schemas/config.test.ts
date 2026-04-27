import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
	CodeScanningGroupSchema,
	CodeScanningLanguageSchema,
	ConfigSchema,
	GroupSchema,
	SecretScopesSchema,
	SecurityGroupSchema,
	VariableScopesSchema,
} from "../../src/schemas/config.js";

const decodeConfig = Schema.decodeUnknownSync(ConfigSchema);
const decodeGroup = Schema.decodeUnknownSync(GroupSchema);
const decodeSecretScopes = Schema.decodeUnknownSync(SecretScopesSchema);
const decodeVariableScopes = Schema.decodeUnknownSync(VariableScopesSchema);
const decodeSecurityGroup = Schema.decodeUnknownSync(SecurityGroupSchema);
const decodeCodeScanningGroup = Schema.decodeUnknownSync(CodeScanningGroupSchema);
const decodeCodeScanningLanguage = Schema.decodeUnknownSync(CodeScanningLanguageSchema);

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

describe("SecurityAndAnalysis (nested in SettingsGroupSchema)", () => {
	it("accepts security_and_analysis nested in a settings group", () => {
		const result = decodeConfig({
			settings: {
				oss: {
					security_and_analysis: {
						secret_scanning: "enabled",
						secret_scanning_push_protection: "enabled",
						dependabot_security_updates: "enabled",
					},
				},
			},
			groups: { g: { repos: ["r"] } },
		});
		const saa = result.settings.oss?.security_and_analysis;
		expect(saa?.secret_scanning).toBe("enabled");
		expect(saa?.secret_scanning_push_protection).toBe("enabled");
		expect(saa?.dependabot_security_updates).toBe("enabled");
	});

	it("rejects invalid status values", () => {
		expect(() =>
			decodeConfig({
				settings: { oss: { security_and_analysis: { secret_scanning: "on" } } },
				groups: { g: { repos: ["r"] } },
			}),
		).toThrow();
	});

	it("accepts delegated_bypass_reviewers with team and role variants", () => {
		const result = decodeConfig({
			settings: {
				oss: {
					security_and_analysis: {
						secret_scanning_delegated_bypass: "enabled",
						delegated_bypass_reviewers: [{ team: "security-team", mode: "ALWAYS" }, { role: "admin" }],
					},
				},
			},
			groups: { g: { repos: ["r"] } },
		});
		const reviewers = result.settings.oss?.security_and_analysis?.delegated_bypass_reviewers;
		expect(reviewers).toHaveLength(2);
		expect(reviewers?.[0]).toMatchObject({ team: "security-team", mode: "ALWAYS" });
		expect(reviewers?.[1]).toMatchObject({ role: "admin" });
	});

	it("rejects invalid reviewer mode", () => {
		expect(() =>
			decodeConfig({
				settings: {
					oss: {
						security_and_analysis: {
							delegated_bypass_reviewers: [{ team: "x", mode: "MAYBE" }],
						},
					},
				},
				groups: { g: { repos: ["r"] } },
			}),
		).toThrow();
	});
});

describe("SecurityGroupSchema", () => {
	it("accepts all toggles", () => {
		const result = decodeSecurityGroup({
			vulnerability_alerts: true,
			automated_security_fixes: true,
			private_vulnerability_reporting: false,
		});
		expect(result.vulnerability_alerts).toBe(true);
		expect(result.automated_security_fixes).toBe(true);
		expect(result.private_vulnerability_reporting).toBe(false);
	});

	it("accepts an empty group (all fields optional)", () => {
		const result = decodeSecurityGroup({});
		expect(result.vulnerability_alerts).toBeUndefined();
	});
});

describe("CodeScanningLanguageSchema", () => {
	it("accepts every documented default-setup language", () => {
		for (const lang of [
			"actions",
			"c-cpp",
			"csharp",
			"go",
			"java-kotlin",
			"javascript-typescript",
			"python",
			"ruby",
			"swift",
		]) {
			expect(decodeCodeScanningLanguage(lang)).toBe(lang);
		}
	});

	it("rejects rust (CodeQL supports it but default setup does not)", () => {
		expect(() => decodeCodeScanningLanguage("rust")).toThrow();
	});

	it("rejects arbitrary strings", () => {
		expect(() => decodeCodeScanningLanguage("kotlin")).toThrow();
	});
});

describe("CodeScanningGroupSchema", () => {
	it("accepts a fully-populated group", () => {
		const result = decodeCodeScanningGroup({
			state: "configured",
			languages: ["javascript-typescript", "python"],
			query_suite: "extended",
			threat_model: "remote",
			runner_type: "standard",
		});
		expect(result.state).toBe("configured");
		expect(result.languages).toEqual(["javascript-typescript", "python"]);
		expect(result.query_suite).toBe("extended");
	});

	it("accepts state = not-configured to disable scanning", () => {
		const result = decodeCodeScanningGroup({ state: "not-configured" });
		expect(result.state).toBe("not-configured");
	});

	it("accepts labeled runner with runner_label", () => {
		const result = decodeCodeScanningGroup({
			runner_type: "labeled",
			runner_label: "ubuntu-large",
		});
		expect(result.runner_type).toBe("labeled");
		expect(result.runner_label).toBe("ubuntu-large");
	});

	it("rejects unsupported query suite", () => {
		expect(() => decodeCodeScanningGroup({ query_suite: "minimal" })).toThrow();
	});
});

describe("ConfigSchema with security and code_scanning", () => {
	it("accepts top-level security and code_scanning groups", () => {
		const result = decodeConfig({
			security: {
				oss: { vulnerability_alerts: true, automated_security_fixes: true },
			},
			code_scanning: {
				oss: { state: "configured", languages: ["javascript-typescript"] },
			},
			groups: {
				g: { repos: ["r"], security: ["oss"], code_scanning: ["oss"] },
			},
		});
		expect(result.security?.oss?.vulnerability_alerts).toBe(true);
		expect(result.code_scanning?.oss?.state).toBe("configured");
		expect(result.groups.g?.security).toEqual(["oss"]);
		expect(result.groups.g?.code_scanning).toEqual(["oss"]);
	});

	it("applies empty defaults for security and code_scanning when omitted", () => {
		const result = decodeConfig({ groups: { g: { repos: ["r"] } } });
		expect(result.security).toEqual({});
		expect(result.code_scanning).toEqual({});
	});
});

describe("GroupSchema with security/code_scanning refs", () => {
	it("accepts security and code_scanning string arrays on a group", () => {
		const result = decodeGroup({
			repos: ["r"],
			security: ["oss-defaults"],
			code_scanning: ["oss-defaults"],
		});
		expect(result.security).toEqual(["oss-defaults"]);
		expect(result.code_scanning).toEqual(["oss-defaults"]);
	});
});
