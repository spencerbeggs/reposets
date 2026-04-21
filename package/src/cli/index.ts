#!/usr/bin/env node
import { Command } from "@effect/cli";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Effect } from "effect";
import { ConfigLoaderLive } from "../services/ConfigLoader.js";
import { credentialsCommand } from "./commands/credentials.js";
import { doctorCommand } from "./commands/doctor.js";
import { initCommand } from "./commands/init.js";
import { listCommand } from "./commands/list.js";
import { syncCommand } from "./commands/sync.js";
import { validateCommand } from "./commands/validate.js";

const rootCommand = Command.make("repo-sync").pipe(
	Command.withSubcommands([syncCommand, listCommand, validateCommand, doctorCommand, initCommand, credentialsCommand]),
);

const cli = Command.run(rootCommand, {
	name: "repo-sync",
	version: "0.0.0",
});

const program = Effect.suspend(() => cli(process.argv)).pipe(
	Effect.provide(ConfigLoaderLive),
	Effect.provide(NodeContext.layer),
);

NodeRuntime.runMain(program);
