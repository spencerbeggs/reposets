#!/usr/bin/env node
import { Command } from "@effect/cli";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Effect, LogLevel, Logger } from "effect";
import { credentialsCommand } from "./commands/credentials.js";
import { doctorCommand } from "./commands/doctor.js";
import { initCommand } from "./commands/init.js";
import { listCommand } from "./commands/list.js";
import { syncCommand } from "./commands/sync.js";
import { validateCommand } from "./commands/validate.js";

const CliLogger = Logger.replace(
	Logger.defaultLogger,
	Logger.make(({ logLevel, message }) => {
		const text = typeof message === "string" ? message : String(message);
		if (LogLevel.greaterThanEqual(logLevel, LogLevel.Error)) {
			globalThis.console.error(text);
		} else {
			globalThis.console.log(text);
		}
	}),
);

const rootCommand = Command.make("reposets").pipe(
	Command.withSubcommands([syncCommand, listCommand, validateCommand, doctorCommand, initCommand, credentialsCommand]),
);

const cli = Command.run(rootCommand, {
	name: "reposets",
	version: "0.0.0",
});

const program = Effect.suspend(() => cli(process.argv)).pipe(
	Effect.provide(NodeContext.layer),
	Effect.provide(CliLogger),
);

NodeRuntime.runMain(program);
