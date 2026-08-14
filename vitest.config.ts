import { AgentPlugin } from "@vitest-agent/plugin";
import { defineConfig } from "vitest/config";

export default async () => {
	const { projects, tags } = await AgentPlugin.discover();
	return defineConfig({
		plugins: [
			AgentPlugin({
				console: {
					human: "stream",
					agent: "agent",
				},
				coverageTargets: AgentPlugin.COVERAGE_LEVELS.strict.coverageTargets,
			}),
		],
		test: {
			...(projects ? { projects } : {}),
			tags,
			pool: "forks",
			globalSetup: ["vitest.setup.ts"],
			coverage: {
				enabled: true,
				provider: "v8",
				thresholds: AgentPlugin.COVERAGE_LEVELS.standard.thresholds,
				// `[]` REPLACES vitest's defaults rather than adding to them, so an
				// empty array leaves nothing excluded — which is how a test helper
				// ended up measured as source. Test files themselves are already
				// out; this is for the helpers beside them.
				exclude: ["**/__test__/**"],
			},
		},
	});
};
