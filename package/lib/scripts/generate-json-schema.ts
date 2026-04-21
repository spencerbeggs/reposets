import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { JsonSchemaExporter } from "xdg-effect";
import { ConfigSchema } from "../../src/schemas/config.js";
import { CredentialsSchema } from "../../src/schemas/credentials.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = join(__dirname, "../../schemas");

const tombiAnnotations = { "x-tombi-toml-version": "v1.1.0" };

const program = Effect.gen(function* () {
	const exporter = yield* JsonSchemaExporter;

	const outputs = yield* exporter.generateMany([
		{
			name: "Config",
			schema: ConfigSchema,
			rootDefName: "Config",
			annotations: tombiAnnotations,
		},
		{
			name: "Credentials",
			schema: CredentialsSchema,
			rootDefName: "Credentials",
			annotations: tombiAnnotations,
		},
	]);

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
