import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Command, Options } from "@effect/cli";
import { Console, Effect } from "effect";
import { parse } from "smol-toml";
import { resolveConfigDir } from "../../lib/config-path.js";
import { ConfigLoader } from "../../services/ConfigLoader.js";

const configOption = Options.file("config").pipe(
	Options.withDescription("Path to config directory or repo-sync.config.toml file"),
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
	"cleanup",
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
	"cleanup",
]);
const KNOWN_CLEANUP_KEYS = new Set([
	"secrets",
	"variables",
	"dependabot_secrets",
	"codespaces_secrets",
	"rulesets",
	"environments",
	"preserve",
]);

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
		const configFlag = config._tag === "Some" ? config.value : undefined;
		const configDir = resolveConfigDir({ configFlag });

		if (!configDir) {
			yield* Console.error("No config found. Run 'repo-sync init' to create one.");
			return;
		}

		const configPath = join(configDir, "repo-sync.config.toml");
		if (!existsSync(configPath)) {
			yield* Console.error(`Config file not found: ${configPath}`);
			return;
		}

		const configToml = readFileSync(configPath, "utf-8");

		let raw: Record<string, unknown>;
		try {
			raw = parse(configToml);
		} catch (err) {
			yield* Console.error(`TOML parse error: ${err instanceof Error ? err.message : String(err)}`);
			return;
		}

		let warnings = 0;

		for (const key of Object.keys(raw)) {
			if (!KNOWN_CONFIG_KEYS.has(key)) {
				const suggestion = findClosestMatch(key, KNOWN_CONFIG_KEYS);
				const hint = suggestion ? ` -- did you mean '${suggestion}'?` : "";
				yield* Console.log(`Warning: unknown top-level key '${key}'${hint}`);
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
							yield* Console.log(`Warning: unknown key '${key}' in groups.${groupName}${hint}`);
							warnings++;
						}
					}
				}
			}
		}

		const cleanup = raw.cleanup;
		if (cleanup && typeof cleanup === "object") {
			for (const key of Object.keys(cleanup as Record<string, unknown>)) {
				if (!KNOWN_CLEANUP_KEYS.has(key)) {
					const suggestion = findClosestMatch(key, KNOWN_CLEANUP_KEYS);
					const hint = suggestion ? ` -- did you mean '${suggestion}'?` : "";
					yield* Console.log(`Warning: unknown key '${key}' in cleanup${hint}`);
					warnings++;
				}
			}
		}

		const loader = yield* ConfigLoader;
		const result = yield* Effect.either(loader.parseConfig(configToml));
		if (result._tag === "Left") {
			yield* Console.error(`Schema validation failed: ${result.left.message}`);
		} else {
			yield* Console.log("Schema validation: passed");
		}

		yield* Console.log("\nRequired fine-grained token permissions:");
		yield* Console.log("  Repository permissions > Administration (Read and write) -- settings sync");
		yield* Console.log("  Repository permissions > Secrets (Read and write) -- Actions secrets");
		yield* Console.log("  Repository permissions > Variables (Read and write) -- Actions variables");
		yield* Console.log("  Repository permissions > Environments (Read and write) -- environment sync");
		yield* Console.log("  Account permissions > GPG keys (Read and write) -- secrets encryption key");

		if (warnings === 0) {
			yield* Console.log("\nNo unknown keys detected.");
		} else {
			yield* Console.log(`\n${warnings} warning(s) found.`);
		}
	}),
).pipe(Command.withDescription("Deep config diagnostics with typo detection"));
