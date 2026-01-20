import { homedir } from "node:os";
import { join } from "node:path";

const APP_NAME = "gh-sync";
const CONFIG_FILE = "gh-sync.config.toml";
const CREDENTIALS_FILE = "gh-sync.credentials.toml";

export function configDir(): string {
	const xdg = process.env.XDG_CONFIG_HOME;
	const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".config");
	return join(base, APP_NAME);
}

export function configPath(): string {
	return join(configDir(), CONFIG_FILE);
}

export function credentialsPath(): string {
	return join(configDir(), CREDENTIALS_FILE);
}
