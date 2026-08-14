import { Effect, Layer, Option } from "effect";
import { Flag, GlobalFlag } from "effect/unstable/cli";
import { makeConfigFilesLive } from "../services/ConfigFiles.js";

/**
 * `--config`, as a global flag.
 *
 * @remarks
 * `GlobalFlag.setting` returns a `Context.Service` carrying the parsed value,
 * which is the bridge between parse time and layer-construction time: a layer
 * can require the flag in `R` instead of receiving it as a constructor argument.
 *
 * Global rather than a parent flag deliberately — a global flag is accepted on
 * either side of the subcommand name (`reposets --config x validate` and
 * `reposets validate --config x` both parse), where a plain parent flag rejects
 * the trailing form with `UnrecognizedOption`.
 *
 * @public
 */
export const ConfigFlag = GlobalFlag.setting("config")({
	flag: Flag.string("config").pipe(
		Flag.withDescription("Path to reposets.config.toml, or a directory containing it"),
		Flag.optional,
	),
});

/**
 * The config-file layer, parameterized by `--config` read from the ambient flag
 * service.
 *
 * @remarks
 * Provided once at the root command. Subcommand requirements bubble into the
 * parent's `R` through `withSubcommands`, so one `Command.provide` covers every
 * subcommand rather than each repeating it.
 *
 * @public
 */
export const ConfigLive = Layer.unwrap(
	Effect.map(ConfigFlag, (flag) => makeConfigFilesLive(Option.getOrUndefined(flag))),
);
