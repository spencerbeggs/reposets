#!/usr/bin/env node
import { Command, Options } from "@effect/cli";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Effect } from "effect";
import { ConfigLoaderLive } from "../services/ConfigLoader.js";
import { credentialsCommand } from "./commands/credentials.js";
import { doctorCommand } from "./commands/doctor.js";
import { initCommand } from "./commands/init.js";
import { listCommand } from "./commands/list.js";
import { syncCommand } from "./commands/sync.js";
import { validateCommand } from "./commands/validate.js";

export const logLevelOption = Options.choice("log-level", ["silent", "info", "verbose", "debug"]).pipe(
	Options.withDescription("Set output verbosity"),
	Options.withDefault("info" as const),
);

const rootCommand = Command.make("gh-sync", { logLevel: logLevelOption }).pipe(
	Command.withSubcommands([syncCommand, listCommand, validateCommand, doctorCommand, initCommand, credentialsCommand]),
);

const cli = Command.run(rootCommand, {
	name: "gh-sync",
	version: "0.0.0",
});

const program = Effect.suspend(() => cli(process.argv)).pipe(
	Effect.provide(ConfigLoaderLive),
	Effect.provide(NodeContext.layer),
);

NodeRuntime.runMain(program);
