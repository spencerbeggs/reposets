import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import type { Schema } from "effect";
import { JSONSchema } from "effect";
import { ConfigSchema } from "../../src/schemas/config.js";
import { CredentialsSchema } from "../../src/schemas/credentials.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = join(__dirname, "../../schemas");

interface SchemaEntry {
	name: string;
	schema: Schema.Schema.AnyNoContext;
	filename: string;
	rootDefName: string;
}

/**
 * Effect's JSONSchema.make() produces { $schema, $defs, $ref } where the root
 * type lives behind a $ref. Tombi expects the root to be a concrete object with
 * type/properties directly visible. This function inlines the top-level $ref by
 * spreading the referenced $def into the root, keeping $defs for sub-references.
 */
function inlineRootRef(schema: Record<string, unknown>, defName: string): Record<string, unknown> {
	const defs = schema.$defs as Record<string, Record<string, unknown>> | undefined;
	if (!defs?.[defName]) return schema;

	const rootDef = { ...defs[defName] };

	// Remove the inlined def from $defs to avoid duplication
	const remainingDefs = { ...defs };
	delete remainingDefs[defName];

	const result: Record<string, unknown> = {
		$schema: schema.$schema,
		...rootDef,
	};

	// Only include $defs if there are remaining definitions
	if (Object.keys(remainingDefs).length > 0) {
		result.$defs = remainingDefs;
	}

	return result;
}

const schemas: SchemaEntry[] = [
	{ name: "Config", schema: ConfigSchema, filename: "repo-sync.config.schema.json", rootDefName: "Config" },
	{
		name: "Credentials",
		schema: CredentialsSchema,
		filename: "repo-sync.credentials.schema.json",
		rootDefName: "Credentials",
	},
];

if (!existsSync(outputDir)) {
	mkdirSync(outputDir, { recursive: true });
}

for (const entry of schemas) {
	const raw = JSONSchema.make(entry.schema) as unknown as Record<string, unknown>;
	const jsonSchema = inlineRootRef(raw, entry.rootDefName);
	jsonSchema["x-tombi-toml-version"] = "v1.1.0";
	const content = `${JSON.stringify(jsonSchema, null, 2)}\n`;
	const outputPath = join(outputDir, entry.filename);

	if (existsSync(outputPath)) {
		const existing = JSON.parse(readFileSync(outputPath, "utf-8"));
		if (isDeepStrictEqual(existing, jsonSchema)) {
			console.log(`  ${entry.name}: unchanged`);
			continue;
		}
	}

	writeFileSync(outputPath, content);
	console.log(`  ${entry.name}: generated -> ${outputPath}`);
}
