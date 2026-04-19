import { Context, Effect, Layer, Ref } from "effect";
import type { LogLevel } from "../schemas/config.js";

interface SyncErrorRecord {
	readonly repo: string;
	readonly context: string;
	readonly message: string;
}

export interface SyncLoggerService {
	readonly groupStart: (name: string, repoCount: number) => Effect.Effect<void>;
	readonly repoStart: (owner: string, repo: string) => Effect.Effect<void>;
	readonly repoSkip: (owner: string, repo: string, reason: string) => Effect.Effect<void>;
	readonly syncSummary: (
		resource: "secret" | "variable" | "ruleset",
		count: number,
		detail: string,
	) => Effect.Effect<void>;
	readonly settingsApplied: () => Effect.Effect<void>;
	readonly cleanupSummary: (resource: string, count: number, names: string[]) => Effect.Effect<void>;
	readonly syncOperation: (
		verb: "sync" | "apply" | "delete",
		resource: string,
		name: string,
		detail?: string,
		source?: string,
	) => Effect.Effect<void>;
	readonly syncError: (context: string, message: string) => Effect.Effect<void>;
	readonly finish: () => Effect.Effect<void>;
}

export class SyncLogger extends Context.Tag("SyncLogger")<SyncLogger, SyncLoggerService>() {}

function pluralize(resource: string, count: number): string {
	if (count === 1) return resource;
	if (resource === "ruleset") return "rulesets";
	return `${resource}s`;
}

export interface SyncLoggerConfig {
	readonly dryRun: boolean;
	readonly logLevel: LogLevel;
	readonly output?: Ref.Ref<string[]>;
}

export function SyncLoggerLive(config: SyncLoggerConfig): Layer.Layer<SyncLogger> {
	const { dryRun, logLevel, output } = config;

	return Layer.effect(
		SyncLogger,
		Effect.gen(function* () {
			const errors = yield* Ref.make<SyncErrorRecord[]>([]);
			const currentRepo = yield* Ref.make<string>("");

			function emit(line: string): Effect.Effect<void> {
				if (output) {
					return Ref.update(output, (lines) => [...lines, line]);
				}
				return Effect.sync(() => {
					process.stdout.write(`${line}\n`);
				});
			}

			function isVisible(tier: "info" | "verbose" | "debug"): boolean {
				if (logLevel === "silent") return false;
				const levels = ["info", "verbose", "debug"] as const;
				return levels.indexOf(logLevel) >= levels.indexOf(tier);
			}

			/**
			 * Format a verb with padding. Normal verbs (past tense) are padded to 8 chars.
			 * Dry-run verbs ("would " + present tense) are padded to 14 chars.
			 * The padded string is concatenated directly with the rest of the line (no extra space).
			 */
			function formatVerb(pastTense: string, presentTense: string): string {
				if (dryRun) {
					return `would ${presentTense}`.padEnd(14);
				}
				return pastTense.padEnd(8);
			}

			return {
				groupStart(name, repoCount) {
					if (!isVisible("info")) return Effect.void;
					return emit(`group: ${name} (${repoCount} ${repoCount === 1 ? "repo" : "repos"})`);
				},

				repoStart(owner, repo) {
					const repoSlug = `${owner}/${repo}`;
					if (!isVisible("info")) return Ref.set(currentRepo, repoSlug);
					return Effect.gen(function* () {
						yield* Ref.set(currentRepo, repoSlug);
						yield* emit(`  repo: ${repoSlug}`);
					});
				},

				repoSkip(owner, repo, reason) {
					if (!isVisible("info")) return Effect.void;
					return Effect.gen(function* () {
						yield* emit(`  repo: ${owner}/${repo}`);
						yield* emit(`    skip    ${reason}`);
					});
				},

				syncSummary(resource, count, detail) {
					if (!isVisible("info")) return Effect.void;
					const verb = formatVerb("synced", "sync");
					const noun = pluralize(resource, count);
					const suffix = detail ? ` (${detail})` : "";
					return emit(`    ${verb}${count} ${noun}${suffix}`);
				},

				settingsApplied() {
					if (!isVisible("info")) return Effect.void;
					const verb = formatVerb("applied", "apply");
					return emit(`    ${verb}settings`);
				},

				cleanupSummary(resource, count, names) {
					if (!isVisible("info")) return Effect.void;
					const verb = formatVerb("deleted", "delete");
					const noun = pluralize(resource, count);
					const suffix = names.length > 0 ? ` (${names.join(", ")})` : "";
					return emit(`    ${verb}${count} ${noun}${suffix}`);
				},

				syncOperation(verb, resource, name, detail, source) {
					if (!isVisible("verbose")) return Effect.void;
					const formattedVerb = formatVerb(verb, verb);
					const nameStr = name ? ` ${name}` : "";
					const suffix = detail ? ` ${detail}` : "";
					const sourceSuffix = source && isVisible("debug") ? ` <- ${source}` : "";
					return emit(`    ${formattedVerb}${resource}${nameStr}${suffix}${sourceSuffix}`);
				},

				syncError(context, message) {
					if (!isVisible("info")) return Effect.void;
					return Effect.gen(function* () {
						const repo = yield* Ref.get(currentRepo);
						yield* Ref.update(errors, (errs) => [...errs, { repo, context, message }]);
						yield* emit(`    error   ${context}: ${message}`);
					});
				},

				finish() {
					if (!isVisible("info")) return Effect.void;
					return Effect.gen(function* () {
						const errs = yield* Ref.get(errors);
						if (errs.length === 0) {
							yield* emit("Sync complete!");
						} else {
							const label = errs.length === 1 ? "error" : "errors";
							yield* emit(`Sync complete with ${errs.length} ${label}:`);
							for (const err of errs) {
								yield* emit(`  ${err.repo}: ${err.context} \u2014 ${err.message}`);
							}
						}
					});
				},
			};
		}),
	);
}
