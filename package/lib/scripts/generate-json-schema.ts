import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { SchemaFile, SchemaValidator, StoreDocument } from "@effected/schemastore";
import { Effect, Layer } from "effect";
import { ConfigSchema } from "../../src/schemas/config.js";
import { CredentialsSchema } from "../../src/schemas/credentials.js";

const outputDir = join(dirname(fileURLToPath(import.meta.url)), "../../schemas");

const RAW = "https://raw.githubusercontent.com/spencerbeggs/reposets/main/package/schemas";

/**
 * Schemas published for editor consumption, one per config file.
 *
 * @remarks
 * Both files get one. `Credentials` was withheld for a while — the file was
 * moving to reference-only (`{ op }` / `{ env }`) and publishing the old shape
 * would have advertised a format about to be rejected — and it is back now that
 * the shape is settled.
 *
 * Withholding it had a cost worth remembering: a schema absent from this list
 * fails nothing. The build stays green, and the only symptom is an editor that
 * silently stops completing one of the two files someone edits by hand.
 */
const entries = [
	{
		name: "config",
		schema: ConfigSchema,
		$id: `${RAW}/reposets.config.schema.json`,
	},
	{
		name: "credentials",
		schema: CredentialsSchema,
		$id: `${RAW}/reposets.credentials.schema.json`,
	},
] as const;

const program = Effect.gen(function* () {
	const files = yield* SchemaFile;
	const validator = yield* SchemaValidator;

	for (const entry of entries) {
		const document = yield* StoreDocument.fromSchema(entry.schema, { $id: entry.$id });

		// Strict: the language-server keyword families (x-taplo, x-tombi-*) are
		// carried through the Draft-07 lowering by AnnotationCarriers, and a
		// misplaced annotation is a silent quality loss rather than an error —
		// validating catches it here instead of in someone's editor.
		// `validate` takes the flat JSON, not the document — its finding paths are
		// pointers into `toJson()`'s shape. `SchemaFile.write` is the opposite,
		// taking the document so it can serialize canonically. Easy to swap.
		yield* validator.validate(document.toJson(), { strict: true });

		// `write` takes the document, not text — it serializes through the same
		// canonical serializer so a committed file and a regenerated one cannot
		// drift on formatting alone.
		const result = yield* files.write(join(outputDir, `reposets.${entry.name}.schema.json`), document);

		yield* Effect.log(`reposets.${entry.name}.schema.json: ${JSON.stringify(result)}`);
	}
});

const MainLayer = Layer.mergeAll(SchemaFile.layer, SchemaValidator.layer).pipe(
	Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
);

Effect.runPromise(program.pipe(Effect.provide(MainLayer)));
