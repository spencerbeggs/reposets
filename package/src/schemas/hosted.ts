import { HostedSchema } from "@effected/schemastore";

/**
 * The version label both published JSON Schema documents carry.
 *
 * @remarks
 * `3.0` tracks the reposets 3.0.0 release that introduced versioned schemas.
 * The label names the TOML contract, not the package version: a later
 * reposets release that leaves both file shapes alone keeps `3.0`. A contract
 * change (a new required key, a removed or retyped key, a new `default`) is
 * answered by appending a new label to `versions` and leaving the `3.0` file
 * frozen on disk — `init` stamps the `3.0` URL into every config it scaffolds,
 * so editing that document in place would move a URL people pin.
 *
 * @public
 */
export const SCHEMA_VERSION = "3.0" as const;

/**
 * Where the `reposets.config.toml` JSON Schema is hosted and which version is
 * current.
 *
 * @remarks
 * The one identity both sides derive from: `lib/configs/schemastore.config.ts`
 * builds the document at this `$id` (keyed by `name`), and `reposets init`
 * stamps `#:schema <$id>` into the config it scaffolds. Neither spells the URL
 * by hand, so the file the build writes and the URL a fresh config points at
 * cannot disagree. Served raw from `main` under the repository root's
 * `schemas/` directory — independent of the package layout — as
 * `schemas/<version>/config.json` (`appendVersion: false`, the version
 * directory alone names the version).
 *
 * @public
 */
export const configSchemaHost = HostedSchema.github({
	repo: "spencerbeggs/reposets",
	path: "schemas",
	name: "config",
	versions: [SCHEMA_VERSION],
	appendVersion: false,
});

/**
 * Where the `reposets.credentials.toml` JSON Schema is hosted and which
 * version is current.
 *
 * @remarks
 * The credentials-file twin of {@link configSchemaHost}: same repository,
 * directory, layout and version label, so the two documents always move
 * together.
 *
 * @public
 */
export const credentialsSchemaHost = HostedSchema.github({
	repo: "spencerbeggs/reposets",
	path: "schemas",
	name: "credentials",
	versions: [SCHEMA_VERSION],
	appendVersion: false,
});

/**
 * The `#:schema` directive `init` writes as the first line of a scaffolded
 * TOML file, followed by the blank line Tombi requires before the document.
 *
 * @remarks
 * `#:schema <url>` is the spelling both Taplo and Tombi read, and to every
 * TOML parser it is an ordinary comment — so the config and credentials
 * decoders never see it. The directive binds the file to one schema version
 * without depending on SchemaStore's catalog, which matches by file name and
 * may lag a release.
 *
 * @param host - the hosted schema the file is written against
 * @returns the directive line and its trailing blank line
 *
 * @public
 */
export const schemaDirective = (host: HostedSchema): string => `#:schema ${host.$id}\n\n`;
