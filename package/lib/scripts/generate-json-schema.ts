import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeFileSystem } from "@effect/platform-node";
import _Ajv from "ajv";

const Ajv = _Ajv as unknown as typeof _Ajv.default;

import { Effect } from "effect";
import type { JsonSchemaOutput } from "xdg-effect";
import { JsonSchemaExporter, tombi } from "xdg-effect";
import { ConfigSchema } from "../../src/schemas/config.js";
import { CredentialsSchema } from "../../src/schemas/credentials.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = join(__dirname, "../../schemas");

/** Custom extension keywords used in our schemas. */
const CUSTOM_KEYWORDS = [
	"x-tombi-additional-key-label",
	"x-tombi-table-keys-order",
	"x-tombi-array-values-order",
	"x-tombi-array-values-order-by",
	"x-tombi-string-formats",
	"x-tombi-toml-version",
	"x-taplo",
] as const;

function validateStrict(outputs: ReadonlyArray<JsonSchemaOutput>): void {
	const ajv = new Ajv({ strict: true, strictTypes: false, allErrors: true });
	for (const keyword of CUSTOM_KEYWORDS) {
		ajv.addKeyword(keyword);
	}
	for (const output of outputs) {
		try {
			ajv.compile(output.schema);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`Schema validation failed for "${output.name}": ${message}`);
		}
	}
}

const program = Effect.gen(function* () {
	const exporter = yield* JsonSchemaExporter;

	const outputs = yield* exporter.generateMany([
		{
			name: "Config",
			schema: ConfigSchema,
			rootDefName: "Config",
			$id: "https://json.schemastore.org/reposets.config.json",
			annotations: tombi({ tomlVersion: "v1.1.0" }),
		},
		{
			name: "Credentials",
			schema: CredentialsSchema,
			rootDefName: "Credentials",
			$id: "https://json.schemastore.org/reposets.credentials.json",
			annotations: tombi({ tomlVersion: "v1.1.0" }),
		},
	]);

	validateStrict(outputs);

	const results = yield* exporter.writeMany(
		outputs.map((output) => ({
			output,
			path: join(outputDir, `reposets.${output.name.toLowerCase()}.schema.json`),
		})),
	);

	for (let i = 0; i < results.length; i++) {
		const result = results[i];
		const name = outputs[i].name;
		if (result._tag === "Written") {
			console.log(`  ${name}: generated -> ${result.path}`);
		} else {
			console.log(`  ${name}: unchanged`);
		}
	}
});

Effect.runPromise(program.pipe(Effect.provide(JsonSchemaExporter.Live), Effect.provide(NodeFileSystem.layer)));
