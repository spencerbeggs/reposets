import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { configDir } from "./xdg.js";

const CONFIG_FILE = "repo-sync.config.toml";

export interface ResolveOptions {
	configFlag?: string | undefined;
	cwd?: string | undefined;
	stopAt?: string | undefined;
	skipXdg?: boolean | undefined;
}

export function resolveConfigDir(options: ResolveOptions = {}): string | undefined {
	const { configFlag, cwd = process.cwd(), stopAt, skipXdg = false } = options;

	// 1. Explicit --config flag
	if (configFlag) {
		if (existsSync(configFlag) && statSync(configFlag).isDirectory()) {
			return configFlag;
		}
		return dirname(configFlag);
	}

	// 2. Walk up from cwd
	let current = cwd;
	while (true) {
		if (existsSync(join(current, CONFIG_FILE))) {
			return current;
		}
		const parent = dirname(current);
		if (parent === current) break;
		if (stopAt && current === stopAt) break;
		current = parent;
	}

	// 3. XDG / home fallback
	if (!skipXdg) {
		const xdgDir = configDir();
		if (existsSync(join(xdgDir, CONFIG_FILE))) {
			return xdgDir;
		}
	}

	return undefined;
}
