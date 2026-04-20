import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { configDir, configPath, credentialsPath } from "../../src/lib/xdg.js";

describe("xdg", () => {
	const originalEnv = process.env;

	afterEach(() => {
		process.env = originalEnv;
	});

	describe("configDir", () => {
		it("uses XDG_CONFIG_HOME when set", () => {
			process.env = { ...originalEnv, XDG_CONFIG_HOME: "/custom/config" };
			expect(configDir()).toBe("/custom/config/repo-sync");
		});

		it("falls back to ~/.config when XDG_CONFIG_HOME is not set", () => {
			process.env = { ...originalEnv };
			delete process.env.XDG_CONFIG_HOME;
			expect(configDir()).toBe(join(homedir(), ".config", "repo-sync"));
		});

		it("falls back to ~/.config when XDG_CONFIG_HOME is empty string", () => {
			process.env = { ...originalEnv, XDG_CONFIG_HOME: "" };
			expect(configDir()).toBe(join(homedir(), ".config", "repo-sync"));
		});
	});

	describe("configPath", () => {
		it("returns repo-sync.config.toml in config dir", () => {
			process.env = { ...originalEnv, XDG_CONFIG_HOME: "/custom/config" };
			expect(configPath()).toBe("/custom/config/repo-sync/repo-sync.config.toml");
		});
	});

	describe("credentialsPath", () => {
		it("returns repo-sync.credentials.toml in config dir", () => {
			process.env = { ...originalEnv, XDG_CONFIG_HOME: "/custom/config" };
			expect(credentialsPath()).toBe("/custom/config/repo-sync/repo-sync.credentials.toml");
		});
	});
});
