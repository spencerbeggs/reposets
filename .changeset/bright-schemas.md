---
"reposets": minor
---

## Features

### SchemaStore Compatibility

JSON Schemas now include `$id` fields pointing to SchemaStore URLs and pass Ajv strict-mode validation, ready for submission to the JSON Schema Store for automatic editor detection.

* Config schema: `https://json.schemastore.org/reposets.config.json`
* Credentials schema: `https://json.schemastore.org/reposets.credentials.json`

### TOML Language Server Support

Added typed annotations for both major TOML language servers:

* Taplo: `x-taplo` annotations with `initKeys` for autocompletion scaffolding and `links.key` for documentation URLs
* Tombi: migrated all `x-tombi-*` annotations to typed `tombi()` helper calls

### Cleaner Schema Output

* Replaced `Schema.Unknown` with `Jsonifiable` from xdg-effect, eliminating `$id: /schemas/unknown` artifacts
* Empty `required: []` arrays and `properties: {}` on Record types removed by xdg-effect cleanup pass

## Maintenance

* Upgraded xdg-effect from v0.2.0 to v0.3.1
* Added ajv as a devDependency for strict schema validation
* Improved schema annotation descriptions and titles across all definitions
