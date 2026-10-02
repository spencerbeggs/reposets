/**
 * The whole schema setup for reposets: `ConfigSchema` and `CredentialsSchema`
 * become the two published, versioned JSON Schema documents under the
 * repository root's `schemas/` directory, one per TOML file. Run via
 * `pnpm schema:build` / `pnpm schema:check` (`@effected/schemastore-cli`),
 * which turbo wires ahead of both builds.
 *
 * @remarks
 * Each entry's identity is a `HostedSchema` from `src/schemas/hosted.ts`, keyed
 * by its own `name` — the same values `reposets init` stamps as a `#:schema`
 * directive, so the `$id` written here and the URL a fresh config points at
 * cannot disagree. Both derive `schemas/<version>/<name>.json`
 * (`schemas/3.0/config.json`, `schemas/3.0/credentials.json`) under the
 * raw-GitHub base for `main`.
 *
 * `outputDir` resolves against this file's directory, so `../../../schemas`
 * is the repository root's `schemas/` whether the build runs from the root or
 * filtered to the package. The served path therefore no longer follows the
 * package's location in the workspace.
 *
 * `published: true` from day one: `init` stamps these URLs into every config it
 * writes, so editors depend on them from the release that introduces them. The
 * drift policy is the default `semantic` — an annotation-only edit (a
 * description, an `x-taplo`/`x-tombi-` hint) regenerates in place, while a
 * contract change is refused with a `DRIFT contract` line. Answer one by
 * appending a new label to the hosts' `versions` in `src/schemas/hosted.ts`, never by forcing.
 *
 * Both TOML files decode strictly, so the published schema must reject unknown
 * keys too; generated objects are closed by default, so nothing needs pinning.
 *
 * `name` is this config's catalog slice: both catalog entries land in
 * `schemas/catalogs/reposets.json`, and the CLI merges every slice in that
 * directory into `schemas/catalog.json`.
 *
 * A schema absent from this record fails nothing. The build stays green, and
 * the only symptom is an editor that silently stops completing one of the two
 * files someone edits by hand.
 */
import { defineConfig } from "@effected/schemastore";
import { ConfigSchema } from "../../src/schemas/config.js";
import { CredentialsSchema } from "../../src/schemas/credentials.js";
import { configSchemaHost, credentialsSchemaHost } from "../../src/schemas/hosted.js";

export default defineConfig({
	name: "reposets",
	outputDir: "../../../schemas",
	schemas: {
		[configSchemaHost.name]: {
			schema: ConfigSchema,
			hosted: configSchemaHost,
			published: true,
			catalog: {
				description: "Configuration for the reposets CLI tool for syncing GitHub repository settings",
				fileMatch: ["reposets.config.toml", "reposets.config.json"],
			},
		},
		[credentialsSchemaHost.name]: {
			schema: CredentialsSchema,
			hosted: credentialsSchemaHost,
			published: true,
			catalog: {
				description: "Authentication profiles for the reposets CLI tool",
				fileMatch: ["reposets.credentials.toml", "reposets.credentials.json"],
			},
		},
	},
});
