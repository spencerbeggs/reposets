/**
 * The whole schema setup for reposets: `ConfigSchema` and `CredentialsSchema`
 * become the two published JSON Schema documents under `package/schemas/`,
 * one per TOML file. Run via `pnpm schema:build` / `pnpm schema:check`
 * (`@effected/schemastore-cli`), which turbo wires ahead of both builds.
 *
 * @remarks
 * The entry keys ARE the file base names: `reposets.config.schema` derives
 * `reposets.config.schema.json` and, under the flat layout on the raw-GitHub
 * base, the `$id` the SchemaStore catalog already pins. Both schemas are
 * unversioned — the catalog points at `main`, the moving edge, by design — so
 * there is no label to bump into when the contract moves. `drift: "allow"`
 * keeps the regenerate-in-place behaviour the old generator script had while
 * `published: true` records that editors depend on these documents today.
 *
 * Both TOML files decode strictly, so the published schema must reject unknown
 * keys too; 0.12 closes generated objects by default, so nothing needs pinning.
 *
 * A schema absent from this record fails nothing. The build stays green, and
 * the only symptom is an editor that silently stops completing one of the two
 * files someone edits by hand.
 */
import { defineConfig } from "@effected/schemastore";
import { ConfigSchema } from "../../src/schemas/config.js";
import { CredentialsSchema } from "../../src/schemas/credentials.js";

export default defineConfig({
	outputDir: "../../schemas",
	baseUrl: "https://raw.githubusercontent.com/spencerbeggs/reposets/main/package/schemas",
	drift: "allow",
	schemas: {
		"reposets.config.schema": {
			schema: ConfigSchema,
			layout: "flat",
			published: true,
			catalog: {
				description: "Configuration for the reposets CLI tool for syncing GitHub repository settings",
				fileMatch: ["reposets.config.toml", "reposets.config.json"],
			},
		},
		"reposets.credentials.schema": {
			schema: CredentialsSchema,
			layout: "flat",
			published: true,
			catalog: {
				description: "Authentication profiles for the reposets CLI tool",
				fileMatch: ["reposets.credentials.toml", "reposets.credentials.json"],
			},
		},
	},
});
