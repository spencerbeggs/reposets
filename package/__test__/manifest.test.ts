import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * reposets is a published CLI, so it owns its kit closure: every Effect-family
 * dependency it ships is pinned exactly. A caret would let a newer kit patch
 * reach an installed reposets without a reposets release, and let a kit library
 * inside it take a peer from another release line.
 */

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")) as {
	readonly dependencies: Readonly<Record<string, string>>;
};

const isEffectFamily = (name: string): boolean =>
	name === "effect" || name.startsWith("@effect/") || name.startsWith("@effected/");

describe("the published manifest", () => {
	const family = Object.entries(manifest.dependencies).filter(([name]) => isEffectFamily(name));

	it("declares Effect-family dependencies", () => {
		expect(family.length).toBeGreaterThan(0);
	});

	it("pins every Effect-family dependency through catalog:effected:exact", () => {
		const loose = family.filter(([, spec]) => spec !== "catalog:effected:exact").map(([name]) => name);
		expect(loose).toEqual([]);
	});
});
