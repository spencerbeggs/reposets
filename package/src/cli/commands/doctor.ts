import { readFileSync } from "node:fs";
import { Command, Options } from "@effect/cli";
import { Effect } from "effect";
import { parse } from "smol-toml";
import { ReposetsConfigFile, makeConfigFilesLive } from "../../services/ConfigFiles.js";

const configOption = Options.file("config").pipe(
	Options.withDescription("Path to config directory or reposets.config.toml file"),
	Options.optional,
);

const KNOWN_CONFIG_KEYS = new Set([
	"owner",
	"log_level",
	"settings",
	"secrets",
	"variables",
	"rulesets",
	"environments",
	"security",
	"code_scanning",
	"groups",
]);
const KNOWN_GROUP_KEYS = new Set([
	"owner",
	"repos",
	"credentials",
	"settings",
	"secrets",
	"variables",
	"rulesets",
	"environments",
	"security",
	"code_scanning",
	"cleanup",
]);
const KNOWN_CLEANUP_KEYS = new Set(["secrets", "variables", "rulesets", "environments"]);
const KNOWN_CLEANUP_SECRETS_KEYS = new Set(["actions", "dependabot", "codespaces", "environments"]);
const KNOWN_CLEANUP_VARIABLES_KEYS = new Set(["actions", "environments"]);

function findClosestMatch(key: string, known: Set<string>): string | undefined {
	let best: string | undefined;
	let bestDist = Number.POSITIVE_INFINITY;

	for (const candidate of known) {
		const dist = levenshtein(key, candidate);
		if (dist < bestDist && dist <= 3) {
			bestDist = dist;
			best = candidate;
		}
	}
	return best;
}

function levenshtein(a: string, b: string): number {
	const matrix: number[][] = [];
	for (let i = 0; i <= a.length; i++) {
		matrix[i] = [i];
	}
	for (let j = 0; j <= b.length; j++) {
		matrix[0][j] = j;
	}
	for (let i = 1; i <= a.length; i++) {
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
		}
	}
	return matrix[a.length][b.length];
}

export const doctorCommand = Command.make("doctor", { config: configOption }, ({ config }) =>
	Effect.gen(function* () {
		const configFile = yield* ReposetsConfigFile;

		// Use discover to find and validate config; also get the file path for raw parsing
		const discoverResult = yield* Effect.either(configFile.discover);

		if (discoverResult._tag === "Left") {
			yield* Effect.logError("No config found. Run 'reposets init' to create one.");
			return;
		}

		const sources = discoverResult.right;
		if (sources.length === 0) {
			yield* Effect.logError("No config found. Run 'reposets init' to create one.");
			return;
		}

		const configPath = sources[0].path;

		// Raw TOML parsing for typo detection (schema validation strips unknown keys)
		let raw: Record<string, unknown>;
		try {
			const configToml = readFileSync(configPath, "utf-8");
			raw = parse(configToml);
		} catch (err) {
			yield* Effect.logError(`TOML parse error: ${err instanceof Error ? err.message : String(err)}`);
			return;
		}

		let warnings = 0;

		for (const key of Object.keys(raw)) {
			if (!KNOWN_CONFIG_KEYS.has(key)) {
				const suggestion = findClosestMatch(key, KNOWN_CONFIG_KEYS);
				const hint = suggestion ? ` -- did you mean '${suggestion}'?` : "";
				yield* Effect.log(`Warning: unknown top-level key '${key}'${hint}`);
				warnings++;
			}
		}

		const groups = raw.groups;
		if (groups && typeof groups === "object") {
			for (const [groupName, group] of Object.entries(groups as Record<string, unknown>)) {
				if (group && typeof group === "object") {
					for (const key of Object.keys(group as Record<string, unknown>)) {
						if (!KNOWN_GROUP_KEYS.has(key)) {
							const suggestion = findClosestMatch(key, KNOWN_GROUP_KEYS);
							const hint = suggestion ? ` -- did you mean '${suggestion}'?` : "";
							yield* Effect.log(`Warning: unknown key '${key}' in groups.${groupName}${hint}`);
							warnings++;
						}
					}
				}
			}
		}

		if (groups && typeof groups === "object") {
			for (const [groupName, group] of Object.entries(groups as Record<string, unknown>)) {
				if (!group || typeof group !== "object") continue;
				const cleanup = (group as Record<string, unknown>).cleanup;
				if (!cleanup || typeof cleanup !== "object") continue;
				const cleanupObj = cleanup as Record<string, unknown>;
				const prefix = `groups.${groupName}.cleanup`;
				for (const key of Object.keys(cleanupObj)) {
					if (!KNOWN_CLEANUP_KEYS.has(key)) {
						const suggestion = findClosestMatch(key, KNOWN_CLEANUP_KEYS);
						const hint = suggestion ? ` -- did you mean '${suggestion}'?` : "";
						yield* Effect.log(`Warning: unknown key '${key}' in ${prefix}${hint}`);
						warnings++;
					}
				}
				const secrets = cleanupObj.secrets;
				if (secrets && typeof secrets === "object") {
					for (const key of Object.keys(secrets as Record<string, unknown>)) {
						if (!KNOWN_CLEANUP_SECRETS_KEYS.has(key)) {
							const suggestion = findClosestMatch(key, KNOWN_CLEANUP_SECRETS_KEYS);
							const hint = suggestion ? ` -- did you mean '${suggestion}'?` : "";
							yield* Effect.log(`Warning: unknown key '${key}' in ${prefix}.secrets${hint}`);
							warnings++;
						}
					}
				}
				const variables = cleanupObj.variables;
				if (variables && typeof variables === "object") {
					for (const key of Object.keys(variables as Record<string, unknown>)) {
						if (!KNOWN_CLEANUP_VARIABLES_KEYS.has(key)) {
							const suggestion = findClosestMatch(key, KNOWN_CLEANUP_VARIABLES_KEYS);
							const hint = suggestion ? ` -- did you mean '${suggestion}'?` : "";
							yield* Effect.log(`Warning: unknown key '${key}' in ${prefix}.variables${hint}`);
							warnings++;
						}
					}
				}
			}
		}

		// Schema validation already passed via discover
		yield* Effect.log("Schema validation: passed");

		yield* Effect.log("\nRequired fine-grained token permissions:");
		yield* Effect.log("  Repository permissions > Administration (Read and write) -- settings sync");
		yield* Effect.log("  Repository permissions > Secrets (Read and write) -- Actions secrets");
		yield* Effect.log("  Repository permissions > Variables (Read and write) -- Actions variables");
		yield* Effect.log("  Repository permissions > Environments (Read and write) -- environment sync");
		yield* Effect.log("  Repository permissions > Code scanning alerts (Read and write) -- code_scanning sync");
		yield* Effect.log("  Repository permissions > Dependabot alerts (Read and write) -- security feature sync");
		yield* Effect.log(
			"  Repository permissions > Secret scanning alerts (Read and write) -- secret scanning delegation",
		);
		yield* Effect.log("  Account permissions > GPG keys (Read and write) -- secrets encryption key");
		yield* Effect.log("  Organization permissions > Members (Read) -- resolve team slugs (org-level only)");

		if (warnings === 0) {
			yield* Effect.log("\nNo unknown keys detected.");
		} else {
			yield* Effect.log(`\n${warnings} warning(s) found.`);
		}
	}).pipe(Effect.provide(makeConfigFilesLive(config))),
).pipe(Command.withDescription("Deep config diagnostics with typo detection"));
