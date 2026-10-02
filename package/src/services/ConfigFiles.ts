import { AppConfig } from "@effected/app";
import { ConfigFile, ConfigResolver, TomlCodec } from "@effected/config-file";
import type { AppDirs, Xdg } from "@effected/xdg";
import { Data, Effect, FileSystem, Layer, Path } from "effect";
import type { Config } from "../schemas/config.js";
import { ConfigSchema } from "../schemas/config.js";
import type { Credentials } from "../schemas/credentials.js";
import { CredentialsSchema } from "../schemas/credentials.js";

/**
 * The config file's fixed name, in every tier of the resolver chain.
 *
 * @public
 */
export const CONFIG_FILENAME = "reposets.config.toml";

/**
 * The credentials file's fixed name.
 *
 * @public
 */
export const CREDENTIALS_FILENAME = "reposets.credentials.toml";

/**
 * Service identity for the parsed `reposets.config.toml`.
 *
 * @public
 */
export class ReposetsConfigFile extends ConfigFile.Service<ReposetsConfigFile, Config>()("reposets/Config") {}

/**
 * Service identity for the parsed `reposets.credentials.toml`.
 *
 * @public
 */
export class ReposetsCredentialsFile extends ConfigFile.Service<ReposetsCredentialsFile, Credentials>()(
	"reposets/Credentials",
) {}

/**
 * Reject keys the schema does not know about.
 *
 * @remarks
 * v4 carries `onExcessProperty` on `ParseOptions` — per decode call, not on the
 * schema — and `@effected/config-file` threads it through from `0.4.0`.
 *
 * Without it a config loader silently discards part of the user's file: a typo'd
 * section name does nothing and reports nothing, and a field removed in a
 * breaking schema change is ignored rather than rejected. Both matter here.
 * `op_service_account_token` was removed for a security reason — it stored the
 * credential that unlocks every other credential — and a migrating user who
 * keeps it must be told, not quietly ignored while believing a dead token is
 * live.
 *
 * This does **not** break the documented `[settings.*]` pass-through. Those keys
 * are covered by a `StructWithRest` rest schema, so they are not excess;
 * verified here and pinned by a test upstream.
 *
 * **Applied to credentials only, for now.** The config file keeps lenient
 * decoding because `doctor` diagnoses unknown keys with nearest-match
 * suggestions — strictly better output than a decode failure — and it locates
 * the file through `discover`, which decodes. Making the load strict means
 * `discover` fails and `doctor` reports "no config found" for a file that is
 * present and one character wrong, losing the diagnosis exactly when it is
 * wanted. Turning it on for config needs `doctor` to locate the file without
 * decoding first.
 */
const STRICT_KEYS = {
	onExcessProperty: "error",
	// `errors: "all"` collects every rejection instead of stopping at the first.
	// Without it a config with three typos reports one, the user fixes it, and
	// the next run reports the next — three round trips to learn what one run
	// already knew. The cost is bounded: the extra work happens only on a config
	// that is already failing.
	errors: "all",
} as const;

/**
 * The credentials file, resolved by upward walk then XDG.
 *
 * @remarks
 * **No `--config` tier.** That flag names the *config* file; pointing it at a
 * directory would be ambiguous here and pointing it at a file would be wrong.
 * A credentials file is found next to the project or in the XDG config
 * directory, and nowhere else.
 *
 * `AppConfig.layer` appends its own XDG tier after the resolvers given here, so
 * the upward walk wins and the XDG fallback comes free.
 *
 * @public
 */
export const CredentialsFilesLive: Layer.Layer<
	ReposetsCredentialsFile,
	never,
	FileSystem.FileSystem | Path.Path | AppDirs | Xdg
> = AppConfig.layer(ReposetsCredentialsFile, {
	filename: CREDENTIALS_FILENAME,
	schema: CredentialsSchema,
	codec: TomlCodec,
	resolvers: [ConfigResolver.upwardWalk({ filename: CREDENTIALS_FILENAME })],
	parseOptions: STRICT_KEYS,
});

/**
 * Raised when `--config` names a path that does not exist.
 *
 * @remarks
 * Config discovery is best-effort by contract — every `ConfigResolver` has
 * `never` in its error channel — so a resolver that finds nothing falls through
 * to the next tier. That is right for a probe and wrong for an explicit request:
 * `--config /nope.toml` would otherwise load the XDG config instead. The
 * distinction is enforced here rather than pushed into the resolver contract.
 *
 * @public
 */
export class ConfigFlagNotFound extends Data.TaggedError("ConfigFlagNotFound")<{
	readonly path: string;
}> {
	/**
	 * @remarks
	 * Without this, the class renders as a bare `ConfigFlagNotFound:` and the
	 * `path` never reaches the log line. The kit does the same on its own errors.
	 */
	override get message(): string {
		return `--config path does not exist: ${this.path}`;
	}
}

/**
 * Raised when `--config` names a directory that holds no `reposets.config.toml`.
 *
 * @remarks
 * The sibling of {@link ConfigFlagNotFound}, for the case it cannot see: the
 * path exists, so the existence check passes, but the directory resolver then
 * finds nothing and — being a probe with `never` in its error channel — falls
 * through to `AppConfig`'s XDG tier. `reposets doctor --config ./empty-dir`
 * would report on the user's XDG config, a different file from the one asked
 * about, with nothing to say so. An explicit request fails loudly here for the
 * same reason a missing path does.
 *
 * A separate tag rather than a widened `ConfigFlagNotFound`, because the two
 * call for different fixes — a mistyped path, versus a right directory with
 * the file missing or misnamed — and the message names both the directory and
 * the filename it looked for. Both are paths the user typed or a fixed name;
 * nothing secret reaches the message.
 *
 * @public
 */
export class ConfigFlagMissingConfig extends Data.TaggedError("ConfigFlagMissingConfig")<{
	readonly dir: string;
	readonly filename: string;
}> {
	/**
	 * @remarks
	 * As on {@link ConfigFlagNotFound}: without it the error renders as a bare
	 * tag and the directory never reaches the log line.
	 */
	override get message(): string {
		return `--config directory has no ${this.filename}: ${this.dir}`;
	}
}

/**
 * Builds the resolver tiers that must win over `AppConfig`'s own XDG chain.
 *
 * @remarks
 * `AppConfig.layer` prepends these, in order, ahead of `XdgConfig.resolver` and
 * the native-directory probe, so only the higher-priority tiers appear here.
 *
 * A directory is checked for the config file by existence only, not decoded:
 * a file that is present but invalid must still resolve, so `doctor` can
 * diagnose it and a command can report its decode error against the right path.
 */
const resolversFor = (
	configFlag: string | undefined,
): Effect.Effect<
	ReadonlyArray<ConfigResolver<FileSystem.FileSystem | Path.Path>>,
	ConfigFlagNotFound | ConfigFlagMissingConfig,
	FileSystem.FileSystem | Path.Path
> =>
	Effect.gen(function* () {
		if (configFlag === undefined) {
			return [ConfigResolver.upwardWalk({ filename: CONFIG_FILENAME })];
		}

		const fs = yield* FileSystem.FileSystem;
		const info = yield* fs.stat(configFlag).pipe(Effect.option);

		if (info._tag === "None") {
			return yield* new ConfigFlagNotFound({ path: configFlag });
		}

		if (info.value.type !== "Directory") {
			return [ConfigResolver.explicitPath(configFlag)];
		}

		const path = yield* Path.Path;
		const hasConfig = yield* fs.exists(path.join(configFlag, CONFIG_FILENAME)).pipe(Effect.orElseSucceed(() => false));
		if (!hasConfig) {
			return yield* new ConfigFlagMissingConfig({ dir: configFlag, filename: CONFIG_FILENAME });
		}

		return [ConfigResolver.staticDir({ dir: configFlag, filename: CONFIG_FILENAME })];
	});

/**
 * Builds the config-file layer for one invocation's `--config` flag.
 *
 * @remarks
 * Mints a fresh layer per call, so bind the result once per run rather than
 * inlining it at two provide sites.
 *
 * @public
 */
export const makeConfigFilesLive = (
	configFlag: string | undefined,
): Layer.Layer<
	ReposetsConfigFile,
	ConfigFlagNotFound | ConfigFlagMissingConfig,
	FileSystem.FileSystem | Path.Path | AppDirs | Xdg
> =>
	Layer.unwrap(
		Effect.map(resolversFor(configFlag), (resolvers) =>
			AppConfig.layer(ReposetsConfigFile, {
				filename: CONFIG_FILENAME,
				schema: ConfigSchema,
				codec: TomlCodec,
				resolvers,
				parseOptions: STRICT_KEYS,
			}),
		),
	);
