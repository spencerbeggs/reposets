import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveConfigDir } from "../../src/lib/config-path.js";

describe("resolveConfigDir", () => {
	let tempRoot: string;

	beforeEach(() => {
		tempRoot = join(tmpdir(), `repo-sync-test-${Date.now()}`);
		mkdirSync(tempRoot, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempRoot, { recursive: true, force: true });
	});

	it("returns explicit path when --config points to a directory", () => {
		const configDir = join(tempRoot, "custom");
		mkdirSync(configDir, { recursive: true });
		writeFileSync(join(configDir, "repo-sync.config.toml"), "");
		const result = resolveConfigDir({ configFlag: configDir });
		expect(result).toBe(configDir);
	});

	it("returns parent dir when --config points to a file", () => {
		const configDir = join(tempRoot, "custom");
		mkdirSync(configDir, { recursive: true });
		const filePath = join(configDir, "repo-sync.config.toml");
		writeFileSync(filePath, "");
		const result = resolveConfigDir({ configFlag: filePath });
		expect(result).toBe(configDir);
	});

	it("walks up directories to find config", () => {
		const projectDir = join(tempRoot, "project");
		const subDir = join(projectDir, "src", "deep");
		mkdirSync(subDir, { recursive: true });
		writeFileSync(join(projectDir, "repo-sync.config.toml"), "");
		const result = resolveConfigDir({ cwd: subDir });
		expect(result).toBe(projectDir);
	});

	it("returns undefined when no config found anywhere", () => {
		const emptyDir = join(tempRoot, "empty", "nested");
		mkdirSync(emptyDir, { recursive: true });
		const result = resolveConfigDir({
			cwd: emptyDir,
			stopAt: tempRoot,
			skipXdg: true,
		});
		expect(result).toBeUndefined();
	});
});
