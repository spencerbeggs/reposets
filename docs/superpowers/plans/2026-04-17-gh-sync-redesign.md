# gh-sync Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the github-repo-sync CLI as gh-sync -- an Effect-based CLI with TOML config, composable resource groups, XDG config paths, and 1Password SDK integration.

**Architecture:** Effect services with Layer-based DI. Five core services (ConfigLoader, ValueResolver, OnePasswordClient, GitHubClient, SyncEngine) composed via layers. CLI built with @effect/cli. Config defined as Effect Schema with JSON Schema generation for Tombi TOML completion.

**Tech Stack:** effect, @effect/cli, @effect/platform, @effect/platform-node, smol-toml, @octokit/rest, @1password/sdk, tweetnacl, blakejs

**Spec:** `docs/superpowers/specs/2026-04-17-gh-sync-redesign.md`

---

## File Map

### New files to create

```text
package/src/
  errors.ts                        TaggedError definitions
  schemas/
    common.ts                      ValueSourceSchema, CleanupSchema
    config.ts                      ConfigSchema, RepoGroupSchema, etc.
    credentials.ts                 CredentialsSchema, ProfileSchema
  lib/
    xdg.ts                         XDG directory resolution
    config-path.ts                 Config path resolution (directory walk)
    crypto.ts                      NaCl sealed box encryption (ported)
  services/
    ConfigLoader.ts                Load + validate TOML config files
    OnePasswordClient.ts           1Password SDK wrapper
    ValueResolver.ts               Resolve file/value/json/op sources
    GitHubClient.ts                Octokit wrapper with all API methods
    SyncEngine.ts                  Orchestrate sync workflow
  cli/
    index.ts                       Root command + bootstrap (rewrite)
    commands/
      sync.ts                      sync command
      list.ts                      list command
      validate.ts                  validate command
      doctor.ts                    doctor command
      init.ts                      init command
      credentials.ts               credentials create/list/delete
package/__test__/
  schemas/
    common.test.ts
    config.test.ts
    credentials.test.ts
  lib/
    xdg.test.ts
    config-path.test.ts
    crypto.test.ts
  services/
    ConfigLoader.test.ts
    OnePasswordClient.test.ts
    ValueResolver.test.ts
    GitHubClient.test.ts
    SyncEngine.test.ts
package/lib/
  scripts/
    generate-json-schema.ts        JSON Schema generation script
```

### Files to modify

```text
package/package.json               Rename, update dependencies
package/rslib.config.ts            Update scoped package name
package/src/index.ts               Update exports
```

### Files to delete (after all new code is working)

```text
package/src/config.ts              Replaced by schemas/ + services/ConfigLoader
package/src/sync.ts                Replaced by services/GitHubClient + SyncEngine
package/__test__/config.test.ts    Replaced by new test files
package/__test__/sync.test.ts      Replaced by new test files
```

---

### Task 1: Package Setup

**Files:**

- Modify: `package/package.json`
- Modify: `package/rslib.config.ts`
- Modify: root `package.json`

- [ ] **Step 1: Update package/package.json**

Update the package name, bin entry, and dependencies:

```json
{
  "name": "gh-sync",
  "version": "0.0.0",
  "description": "CLI tool to sync GitHub repo settings, secrets, and rulesets across personal repositories",
  "keywords": ["github", "sync", "cli", "secrets", "rulesets", "effect"],
  "license": "MIT",
  "author": {
    "name": "C. Spencer Beggs",
    "email": "spencer@beggs.codes",
    "url": "https://spencerbeg.gs"
  },
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "bin": {
    "gh-sync": "./src/cli/index.ts"
  },
  "scripts": {
    "build:dev": "rslib build --config-loader native --env-mode dev",
    "build:inspect": "rslib inspect --config-loader native --env-mode npm --verbose",
    "build:prod": "rslib build --config-loader native --env-mode npm",
    "types:check": "tsgo --noEmit",
    "generate:json-schema": "tsx lib/scripts/generate-json-schema.ts"
  },
  "dependencies": {
    "@1password/sdk": "^0.1.6",
    "@effect/cli": "catalog:silk",
    "@effect/platform": "catalog:silk",
    "@effect/platform-node": "catalog:silk",
    "@octokit/rest": "^22.0.1",
    "blakejs": "^1.2.1",
    "effect": "catalog:silk",
    "smol-toml": "^1.6.1",
    "tweetnacl": "^1.0.3"
  },
  "devDependencies": {
    "@savvy-web/rslib-builder": "^0.20.1",
    "@types/node": "catalog:silk",
    "@typescript/native-preview": "catalog:silk",
    "typescript": "catalog:silk"
  },
  "engines": {
    "node": ">=20.0.0"
  },
  "publishConfig": {
    "access": "public",
    "targets": [
      {
        "protocol": "npm",
        "registry": "https://npm.pkg.github.com/",
        "directory": "dist/github",
        "access": "public",
        "provenance": true
      },
      {
        "protocol": "npm",
        "registry": "https://registry.npmjs.org/",
        "directory": "dist/npm",
        "access": "public",
        "provenance": true
      }
    ]
  }
}
```

Remove `commander` and `dotenv` from dependencies. Add Effect stack, `smol-toml`, and `@1password/sdk`.

Note: Check the pnpm catalog for the correct Effect version specifiers. If `catalog:silk` does not include `@effect/cli`, `@effect/platform`, and `@effect/platform-node`, add them to the catalog first or use explicit versions.

- [ ] **Step 2: Update package/rslib.config.ts**

Change the GitHub Packages scoped name from `@spencerbeggs/github-repo-sync` to `@spencerbeggs/gh-sync`:

```typescript
import { NodeLibraryBuilder } from "@savvy-web/rslib-builder";

export default NodeLibraryBuilder.create({
 externals: ["effect", "@effect/platform", "@effect/platform-node", "@effect/cli", "@1password/sdk"],
 apiModel: {
  suppressWarnings: [{ messageId: "ae-forgotten-export", pattern: "_base" }],
 },
 transform({ pkg, target }) {
  if (target?.registry === "https://npm.pkg.github.com/") {
   pkg.name = "@spencerbeggs/gh-sync";
  }
  delete pkg.devDependencies;
  delete pkg.bundleDependencies;
  delete pkg.scripts;
  delete pkg.publishConfig;
  delete pkg.packageManager;
  delete pkg.devEngines;
  return pkg;
 },
});
```

- [ ] **Step 3: Update root package.json**

Change the workspace dependency name and the `sync` script:

```json
"devDependencies": {
  "gh-sync": "workspace:*"
}
```

```json
"sync": "tsx package/src/cli/index.ts sync"
```

- [ ] **Step 4: Install dependencies**

Run: `pnpm install`

Expected: lockfile updates, all dependencies resolve.

- [ ] **Step 5: Verify build still works**

Run: `pnpm run build:dev`

Expected: Build succeeds (existing source files still compile).

- [ ] **Step 6: Commit**

```bash
git add package/package.json package/rslib.config.ts package.json pnpm-lock.yaml
git commit -m "chore: rename package to gh-sync and update dependencies

Rename from github-repo-sync to gh-sync. Add Effect stack,
smol-toml, and 1Password SDK. Remove commander and dotenv.

Signed-off-by: C. Spencer Beggs <spencer@beggs.codes>"
```

---

### Task 2: Error Types

**Files:**

- Create: `package/src/errors.ts`
- Test: `package/__test__/errors.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
 ConfigError,
 CredentialsError,
 GitHubApiError,
 OnePasswordError,
 ResolveError,
 SyncError,
} from "../src/errors.js";

describe("Error types", () => {
 it("ConfigError has correct tag and message", () => {
  const error = new ConfigError({ message: "Invalid TOML" });
  expect(error._tag).toBe("ConfigError");
  expect(error.message).toBe("Invalid TOML");
 });

 it("CredentialsError has correct tag", () => {
  const error = new CredentialsError({ message: "Profile not found: work" });
  expect(error._tag).toBe("CredentialsError");
 });

 it("ResolveError has correct tag", () => {
  const error = new ResolveError({ message: "File not found: ./private/key" });
  expect(error._tag).toBe("ResolveError");
 });

 it("OnePasswordError has correct tag", () => {
  const error = new OnePasswordError({ message: "Failed to resolve op://vault/item" });
  expect(error._tag).toBe("OnePasswordError");
 });

 it("GitHubApiError has correct tag and status", () => {
  const error = new GitHubApiError({ message: "Unauthorized", status: 401 });
  expect(error._tag).toBe("GitHubApiError");
  expect(error.status).toBe(401);
 });

 it("SyncError has correct tag", () => {
  const error = new SyncError({ message: "Unknown group: missing-group" });
  expect(error._tag).toBe("SyncError");
 });

 it("errors work in Effect.fail", () => {
  const program = Effect.fail(new ConfigError({ message: "bad config" }));
  const result = Effect.runSyncExit(program);
  expect(result._tag).toBe("Failure");
 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run package/__test__/errors.test.ts`

Expected: FAIL -- cannot find module `../src/errors.js`

- [ ] **Step 3: Implement error types**

Create `package/src/errors.ts`:

```typescript
import { Data } from "effect";

export class ConfigError extends Data.TaggedError("ConfigError")<{
 readonly message: string;
}> {}

export class CredentialsError extends Data.TaggedError("CredentialsError")<{
 readonly message: string;
}> {}

export class ResolveError extends Data.TaggedError("ResolveError")<{
 readonly message: string;
}> {}

export class OnePasswordError extends Data.TaggedError("OnePasswordError")<{
 readonly message: string;
}> {}

export class GitHubApiError extends Data.TaggedError("GitHubApiError")<{
 readonly message: string;
 readonly status?: number;
}> {}

export class SyncError extends Data.TaggedError("SyncError")<{
 readonly message: string;
}> {}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run package/__test__/errors.test.ts`

Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add package/src/errors.ts package/__test__/errors.test.ts
git commit -m "feat: add TaggedError types for gh-sync

Define ConfigError, CredentialsError, ResolveError, OnePasswordError,
GitHubApiError, and SyncError using Effect Data.TaggedError.

Signed-off-by: C. Spencer Beggs <spencer@beggs.codes>"
```

---

### Task 3: Common Schemas (ValueSourceSchema, CleanupSchema)

**Files:**

- Create: `package/src/schemas/common.ts`
- Test: `package/__test__/schemas/common.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { CleanupSchema, ValueSourceSchema } from "../../src/schemas/common.js";

const decode = Schema.decodeUnknownSync(ValueSourceSchema);
const decodeCleanup = Schema.decodeUnknownSync(CleanupSchema);

describe("ValueSourceSchema", () => {
 it("accepts file source", () => {
  const result = decode({ file: "./private/key" });
  expect(result).toEqual({ file: "./private/key" });
 });

 it("accepts value source", () => {
  const result = decode({ value: "my-secret" });
  expect(result).toEqual({ value: "my-secret" });
 });

 it("accepts json source", () => {
  const result = decode({ json: { foo: "bar", baz: 123 } });
  expect(result).toEqual({ json: { foo: "bar", baz: 123 } });
 });

 it("accepts op source", () => {
  const result = decode({ op: "op://vault/item/field" });
  expect(result).toEqual({ op: "op://vault/item/field" });
 });

 it("rejects empty object", () => {
  expect(() => decode({})).toThrow();
 });

 it("rejects object with multiple source keys", () => {
  expect(() => decode({ file: "./key", value: "secret" })).toThrow();
 });

 it("rejects unknown source key", () => {
  expect(() => decode({ env: "MY_VAR" })).toThrow();
 });
});

describe("CleanupSchema", () => {
 it("accepts full cleanup config", () => {
  const result = decodeCleanup({
   secrets: true,
   variables: false,
   dependabot_secrets: true,
   codespaces_secrets: false,
   rulesets: true,
   preserve: { secrets: ["KEEP_ME"] },
  });
  expect(result.secrets).toBe(true);
  expect(result.preserve.secrets).toEqual(["KEEP_ME"]);
 });

 it("applies defaults for missing fields", () => {
  const result = decodeCleanup({});
  expect(result.secrets).toBe(false);
  expect(result.variables).toBe(false);
  expect(result.dependabot_secrets).toBe(false);
  expect(result.codespaces_secrets).toBe(false);
  expect(result.rulesets).toBe(false);
  expect(result.preserve).toEqual({
   secrets: [],
   variables: [],
   dependabot_secrets: [],
   codespaces_secrets: [],
   rulesets: [],
  });
 });

 it("accepts partial cleanup", () => {
  const result = decodeCleanup({ secrets: true });
  expect(result.secrets).toBe(true);
  expect(result.variables).toBe(false);
 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run package/__test__/schemas/common.test.ts`

Expected: FAIL -- cannot find module

- [ ] **Step 3: Implement common schemas**

Create `package/src/schemas/common.ts`:

```typescript
import { Schema } from "effect";

export const FileSource = Schema.Struct({ file: Schema.String });
export const ValueSource = Schema.Struct({ value: Schema.String });
export const JsonSource = Schema.Struct({
 json: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
});
export const OpSource = Schema.Struct({ op: Schema.String });

export const ValueSourceSchema = Schema.Union(FileSource, ValueSource, JsonSource, OpSource).annotations({
 identifier: "ValueSource",
 description: "A value source: file path, inline string, JSON object, or 1Password reference",
});

export type ValueSource = typeof ValueSourceSchema.Type;

export const CleanupPreserveSchema = Schema.Struct({
 secrets: Schema.optionalWith(Schema.Array(Schema.String), { default: () => [] }),
 variables: Schema.optionalWith(Schema.Array(Schema.String), { default: () => [] }),
 dependabot_secrets: Schema.optionalWith(Schema.Array(Schema.String), { default: () => [] }),
 codespaces_secrets: Schema.optionalWith(Schema.Array(Schema.String), { default: () => [] }),
 rulesets: Schema.optionalWith(Schema.Array(Schema.String), { default: () => [] }),
}).annotations({
 identifier: "CleanupPreserve",
 description: "Resource names to preserve during cleanup (never delete)",
});

export type CleanupPreserve = typeof CleanupPreserveSchema.Type;

export const CleanupSchema = Schema.Struct({
 secrets: Schema.optionalWith(Schema.Boolean, { default: () => false }),
 variables: Schema.optionalWith(Schema.Boolean, { default: () => false }),
 dependabot_secrets: Schema.optionalWith(Schema.Boolean, { default: () => false }),
 codespaces_secrets: Schema.optionalWith(Schema.Boolean, { default: () => false }),
 rulesets: Schema.optionalWith(Schema.Boolean, { default: () => false }),
 preserve: Schema.optionalWith(CleanupPreserveSchema, {
  default: () => ({
   secrets: [],
   variables: [],
   dependabot_secrets: [],
   codespaces_secrets: [],
   rulesets: [],
  }),
 }),
}).annotations({
 identifier: "Cleanup",
 description: "Cleanup configuration for removing undeclared resources",
});

export type Cleanup = typeof CleanupSchema.Type;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run package/__test__/schemas/common.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add package/src/schemas/common.ts package/__test__/schemas/common.test.ts
git commit -m "feat: add ValueSourceSchema and CleanupSchema

Define the shared value source union (file, value, json, op) and
cleanup configuration schemas with Effect Schema.

Signed-off-by: C. Spencer Beggs <spencer@beggs.codes>"
```

---

### Task 4: Config Schema

**Files:**

- Create: `package/src/schemas/config.ts`
- Test: `package/__test__/schemas/config.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { ConfigSchema, RepoGroupSchema } from "../../src/schemas/config.js";

const decodeConfig = Schema.decodeUnknownSync(ConfigSchema);
const decodeRepoGroup = Schema.decodeUnknownSync(RepoGroupSchema);

describe("RepoGroupSchema", () => {
 it("accepts minimal repo group", () => {
  const result = decodeRepoGroup({ names: ["repo-one"] });
  expect(result.names).toEqual(["repo-one"]);
 });

 it("accepts full repo group", () => {
  const result = decodeRepoGroup({
   owner: "savvy-web",
   names: ["repo-one", "repo-two"],
   credentials: "work",
   settings: ["oss-defaults"],
   secrets: { actions: ["deploy"], dependabot: ["deploy"], codespaces: ["deploy"] },
   variables: { actions: ["common"] },
   rulesets: ["standard"],
   cleanup: { rulesets: false },
  });
  expect(result.owner).toBe("savvy-web");
  expect(result.credentials).toBe("work");
  expect(result.secrets?.actions).toEqual(["deploy"]);
  expect(result.variables?.actions).toEqual(["common"]);
 });

 it("rejects repo group without names", () => {
  expect(() => decodeRepoGroup({})).toThrow();
 });
});

describe("ConfigSchema", () => {
 it("accepts minimal config", () => {
  const result = decodeConfig({
   repos: { mygroup: { names: ["repo-one"] } },
  });
  expect(result.repos.mygroup.names).toEqual(["repo-one"]);
 });

 it("accepts full config", () => {
  const result = decodeConfig({
   owner: "spencerbeggs",
   settings: { "oss-defaults": { has_wiki: false, has_issues: true } },
   secrets: { deploy: { NPM_TOKEN: { op: "op://vault/item" } } },
   variables: { common: { NODE_ENV: { value: "production" } } },
   rulesets: { standard: { workflow: { file: "./rulesets/workflow.json" } } },
   cleanup: { secrets: true, variables: true },
   repos: {
    "oss-projects": {
     names: ["repo-one"],
     settings: ["oss-defaults"],
     secrets: { actions: ["deploy"] },
     variables: { actions: ["common"] },
     rulesets: ["standard"],
    },
   },
  });
  expect(result.owner).toBe("spencerbeggs");
  expect(result.settings?.["oss-defaults"]).toEqual({ has_wiki: false, has_issues: true });
 });

 it("applies defaults for optional sections", () => {
  const result = decodeConfig({
   repos: { mygroup: { names: ["repo-one"] } },
  });
  expect(result.settings).toEqual({});
  expect(result.secrets).toEqual({});
  expect(result.variables).toEqual({});
  expect(result.rulesets).toEqual({});
 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run package/__test__/schemas/config.test.ts`

Expected: FAIL -- cannot find module

- [ ] **Step 3: Implement config schema**

Create `package/src/schemas/config.ts`:

```typescript
import { Schema } from "effect";
import { CleanupSchema, ValueSourceSchema } from "./common.js";

export const SecretScopesSchema = Schema.Struct({
 actions: Schema.optional(Schema.Array(Schema.String)),
 dependabot: Schema.optional(Schema.Array(Schema.String)),
 codespaces: Schema.optional(Schema.Array(Schema.String)),
}).annotations({
 identifier: "SecretScopes",
 description: "Secret group references by scope",
});

export const VariableScopesSchema = Schema.Struct({
 actions: Schema.optional(Schema.Array(Schema.String)),
}).annotations({
 identifier: "VariableScopes",
 description: "Variable group references by scope",
});

export const RepoGroupSchema = Schema.Struct({
 owner: Schema.optional(Schema.String),
 names: Schema.Array(Schema.String),
 credentials: Schema.optional(Schema.String),
 settings: Schema.optional(Schema.Array(Schema.String)),
 secrets: Schema.optional(SecretScopesSchema),
 variables: Schema.optional(VariableScopesSchema),
 rulesets: Schema.optional(Schema.Array(Schema.String)),
 cleanup: Schema.optional(CleanupSchema),
}).annotations({
 identifier: "RepoGroup",
 description: "A named group of repositories with their resource assignments",
});

export type RepoGroup = typeof RepoGroupSchema.Type;

const ResourceGroupSchema = Schema.Record({
 key: Schema.String,
 value: ValueSourceSchema,
});

const SettingsGroupSchema = Schema.Record({
 key: Schema.String,
 value: Schema.Unknown,
});

export const ConfigSchema = Schema.Struct({
 owner: Schema.optional(Schema.String),
 settings: Schema.optionalWith(
  Schema.Record({ key: Schema.String, value: SettingsGroupSchema }),
  { default: () => ({}) },
 ),
 secrets: Schema.optionalWith(
  Schema.Record({ key: Schema.String, value: ResourceGroupSchema }),
  { default: () => ({}) },
 ),
 variables: Schema.optionalWith(
  Schema.Record({ key: Schema.String, value: ResourceGroupSchema }),
  { default: () => ({}) },
 ),
 rulesets: Schema.optionalWith(
  Schema.Record({ key: Schema.String, value: ResourceGroupSchema }),
  { default: () => ({}) },
 ),
 cleanup: Schema.optionalWith(CleanupSchema, {
  default: () => ({
   secrets: false,
   variables: false,
   dependabot_secrets: false,
   codespaces_secrets: false,
   rulesets: false,
   preserve: {
    secrets: [],
    variables: [],
    dependabot_secrets: [],
    codespaces_secrets: [],
    rulesets: [],
   },
  }),
 }),
 repos: Schema.Record({
  key: Schema.String,
  value: RepoGroupSchema,
 }),
}).annotations({
 identifier: "Config",
 title: "gh-sync Configuration",
 description: "Configuration for syncing GitHub repository settings, secrets, variables, and rulesets",
});

export type Config = typeof ConfigSchema.Type;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run package/__test__/schemas/config.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add package/src/schemas/config.ts package/__test__/schemas/config.test.ts
git commit -m "feat: add ConfigSchema with repo groups and resource references

Define the main config schema with settings, secrets, variables,
rulesets groups and composable repo group assignments.

Signed-off-by: C. Spencer Beggs <spencer@beggs.codes>"
```

---

### Task 5: Credentials Schema

**Files:**

- Create: `package/src/schemas/credentials.ts`
- Test: `package/__test__/schemas/credentials.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { CredentialProfileSchema, CredentialsSchema } from "../../src/schemas/credentials.js";

const decodeProfile = Schema.decodeUnknownSync(CredentialProfileSchema);
const decodeCreds = Schema.decodeUnknownSync(CredentialsSchema);

describe("CredentialProfileSchema", () => {
 it("accepts profile with github token only", () => {
  const result = decodeProfile({ github_token: "ghp_abc123" });
  expect(result.github_token).toBe("ghp_abc123");
  expect(result.op_service_account_token).toBeUndefined();
 });

 it("accepts profile with both tokens", () => {
  const result = decodeProfile({
   github_token: "ghp_abc123",
   op_service_account_token: "ops_xyz789",
  });
  expect(result.github_token).toBe("ghp_abc123");
  expect(result.op_service_account_token).toBe("ops_xyz789");
 });

 it("rejects profile without github token", () => {
  expect(() => decodeProfile({})).toThrow();
 });
});

describe("CredentialsSchema", () => {
 it("accepts single profile", () => {
  const result = decodeCreds({
   profiles: { personal: { github_token: "ghp_abc" } },
  });
  expect(result.profiles.personal.github_token).toBe("ghp_abc");
 });

 it("accepts multiple profiles", () => {
  const result = decodeCreds({
   profiles: {
    personal: { github_token: "ghp_abc" },
    work: { github_token: "ghp_def", op_service_account_token: "ops_ghi" },
   },
  });
  expect(Object.keys(result.profiles)).toEqual(["personal", "work"]);
 });

 it("defaults to empty profiles", () => {
  const result = decodeCreds({});
  expect(result.profiles).toEqual({});
 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run package/__test__/schemas/credentials.test.ts`

Expected: FAIL -- cannot find module

- [ ] **Step 3: Implement credentials schema**

Create `package/src/schemas/credentials.ts`:

```typescript
import { Schema } from "effect";

export const CredentialProfileSchema = Schema.Struct({
 github_token: Schema.String,
 op_service_account_token: Schema.optional(Schema.String),
}).annotations({
 identifier: "CredentialProfile",
 description: "Authentication credentials for a GitHub account and optional 1Password service account",
});

export type CredentialProfile = typeof CredentialProfileSchema.Type;

export const CredentialsSchema = Schema.Struct({
 profiles: Schema.optionalWith(
  Schema.Record({ key: Schema.String, value: CredentialProfileSchema }),
  { default: () => ({}) },
 ),
}).annotations({
 identifier: "Credentials",
 title: "gh-sync Credentials",
 description: "Authentication profiles for gh-sync",
});

export type Credentials = typeof CredentialsSchema.Type;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run package/__test__/schemas/credentials.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add package/src/schemas/credentials.ts package/__test__/schemas/credentials.test.ts
git commit -m "feat: add CredentialsSchema for auth profiles

Define credentials schema with per-profile GitHub token and
optional 1Password service account token.

Signed-off-by: C. Spencer Beggs <spencer@beggs.codes>"
```

---

### Task 6: XDG Directory Resolution

**Files:**

- Create: `package/src/lib/xdg.ts`
- Test: `package/__test__/lib/xdg.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configDir, configPath, credentialsPath } from "../../src/lib/xdg.js";

describe("xdg", () => {
 const originalEnv = process.env;

 afterEach(() => {
  process.env = originalEnv;
 });

 describe("configDir", () => {
  it("uses XDG_CONFIG_HOME when set", () => {
   process.env = { ...originalEnv, XDG_CONFIG_HOME: "/custom/config" };
   expect(configDir()).toBe("/custom/config/gh-sync");
  });

  it("falls back to ~/.config when XDG_CONFIG_HOME is not set", () => {
   process.env = { ...originalEnv };
   delete process.env.XDG_CONFIG_HOME;
   expect(configDir()).toBe(join(homedir(), ".config", "gh-sync"));
  });

  it("falls back to ~/.config when XDG_CONFIG_HOME is empty string", () => {
   process.env = { ...originalEnv, XDG_CONFIG_HOME: "" };
   expect(configDir()).toBe(join(homedir(), ".config", "gh-sync"));
  });
 });

 describe("configPath", () => {
  it("returns gh-sync.config.toml in config dir", () => {
   process.env = { ...originalEnv, XDG_CONFIG_HOME: "/custom/config" };
   expect(configPath()).toBe("/custom/config/gh-sync/gh-sync.config.toml");
  });
 });

 describe("credentialsPath", () => {
  it("returns gh-sync.credentials.toml in config dir", () => {
   process.env = { ...originalEnv, XDG_CONFIG_HOME: "/custom/config" };
   expect(credentialsPath()).toBe("/custom/config/gh-sync/gh-sync.credentials.toml");
  });
 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run package/__test__/lib/xdg.test.ts`

Expected: FAIL -- cannot find module

- [ ] **Step 3: Implement XDG resolution**

Create `package/src/lib/xdg.ts`:

```typescript
import { homedir } from "node:os";
import { join } from "node:path";

const APP_NAME = "gh-sync";
const CONFIG_FILE = "gh-sync.config.toml";
const CREDENTIALS_FILE = "gh-sync.credentials.toml";

export function configDir(): string {
 const xdg = process.env.XDG_CONFIG_HOME;
 const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".config");
 return join(base, APP_NAME);
}

export function configPath(): string {
 return join(configDir(), CONFIG_FILE);
}

export function credentialsPath(): string {
 return join(configDir(), CREDENTIALS_FILE);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run package/__test__/lib/xdg.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add package/src/lib/xdg.ts package/__test__/lib/xdg.test.ts
git commit -m "feat: add XDG directory resolution for config paths

Resolve config directory from XDG_CONFIG_HOME with fallback to
~/.config/gh-sync/. Expose configPath and credentialsPath helpers.

Signed-off-by: C. Spencer Beggs <spencer@beggs.codes>"
```

---

### Task 7: Config Path Resolution (Directory Walk)

**Files:**

- Create: `package/src/lib/config-path.ts`
- Test: `package/__test__/lib/config-path.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveConfigDir } from "../../src/lib/config-path.js";

describe("resolveConfigDir", () => {
 let tempRoot: string;

 beforeEach(() => {
  tempRoot = join(tmpdir(), `gh-sync-test-${Date.now()}`);
  mkdirSync(tempRoot, { recursive: true });
 });

 afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
 });

 it("returns explicit path when --config points to a directory", () => {
  const configDir = join(tempRoot, "custom");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "gh-sync.config.toml"), "");
  const result = resolveConfigDir({ configFlag: configDir });
  expect(result).toBe(configDir);
 });

 it("returns parent dir when --config points to a file", () => {
  const configDir = join(tempRoot, "custom");
  mkdirSync(configDir, { recursive: true });
  const filePath = join(configDir, "gh-sync.config.toml");
  writeFileSync(filePath, "");
  const result = resolveConfigDir({ configFlag: filePath });
  expect(result).toBe(configDir);
 });

 it("walks up directories to find config", () => {
  const projectDir = join(tempRoot, "project");
  const subDir = join(projectDir, "src", "deep");
  mkdirSync(subDir, { recursive: true });
  writeFileSync(join(projectDir, "gh-sync.config.toml"), "");
  const result = resolveConfigDir({ cwd: subDir });
  expect(result).toBe(projectDir);
 });

 it("returns undefined when no config found anywhere", () => {
  const emptyDir = join(tempRoot, "empty", "nested");
  mkdirSync(emptyDir, { recursive: true });
  const result = resolveConfigDir({
   cwd: emptyDir,
   stopAt: tempRoot,
   skipXdg: true,
  });
  expect(result).toBeUndefined();
 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run package/__test__/lib/config-path.test.ts`

Expected: FAIL -- cannot find module

- [ ] **Step 3: Implement config path resolution**

Create `package/src/lib/config-path.ts`:

```typescript
import { existsSync, statSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { configDir } from "./xdg.js";

const CONFIG_FILE = "gh-sync.config.toml";

interface ResolveOptions {
 configFlag?: string;
 cwd?: string;
 stopAt?: string;
 skipXdg?: boolean;
}

export function resolveConfigDir(options: ResolveOptions = {}): string | undefined {
 const { configFlag, cwd = process.cwd(), stopAt, skipXdg = false } = options;

 // 1. Explicit --config flag
 if (configFlag) {
  if (existsSync(configFlag) && statSync(configFlag).isDirectory()) {
   return configFlag;
  }
  // Assume it's a file path -- return its parent directory
  return dirname(configFlag);
 }

 // 2. Walk up from cwd
 let current = cwd;
 while (true) {
  if (existsSync(join(current, CONFIG_FILE))) {
   return current;
  }
  const parent = dirname(current);
  if (parent === current) break;
  if (stopAt && current === stopAt) break;
  current = parent;
 }

 // 3. XDG / home fallback
 if (!skipXdg) {
  const xdgDir = configDir();
  if (existsSync(join(xdgDir, CONFIG_FILE))) {
   return xdgDir;
  }
 }

 return undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run package/__test__/lib/config-path.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add package/src/lib/config-path.ts package/__test__/lib/config-path.test.ts
git commit -m "feat: add config path resolution with directory walk

Resolve config directory from --config flag, then walk up parent
directories, then fall back to XDG/home location.

Signed-off-by: C. Spencer Beggs <spencer@beggs.codes>"
```

---

### Task 8: Crypto Module (Port Existing)

**Files:**

- Create: `package/src/lib/crypto.ts`
- Test: `package/__test__/lib/crypto.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import nacl from "tweetnacl";
import { describe, expect, it } from "vitest";
import { encryptSecret } from "../../src/lib/crypto.js";

describe("encryptSecret", () => {
 it("produces a base64 sealed box", () => {
  const keyPair = nacl.box.keyPair();
  const publicKeyBase64 = Buffer.from(keyPair.publicKey).toString("base64");
  const result = encryptSecret(publicKeyBase64, "my-secret-value");

  // Result should be base64-encoded
  const decoded = Buffer.from(result, "base64");
  expect(decoded.length).toBeGreaterThan(0);

  // Sealed box = ephemeral public key (32 bytes) + ciphertext (message + 16 byte MAC)
  const messageBytes = Buffer.from("my-secret-value");
  const expectedLength = 32 + messageBytes.length + nacl.box.overheadLength;
  expect(decoded.length).toBe(expectedLength);
 });

 it("produces different ciphertext each call (ephemeral keys)", () => {
  const keyPair = nacl.box.keyPair();
  const publicKeyBase64 = Buffer.from(keyPair.publicKey).toString("base64");
  const result1 = encryptSecret(publicKeyBase64, "same-secret");
  const result2 = encryptSecret(publicKeyBase64, "same-secret");
  expect(result1).not.toBe(result2);
 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run package/__test__/lib/crypto.test.ts`

Expected: FAIL -- cannot find module

- [ ] **Step 3: Port encryption from existing sync.ts**

Create `package/src/lib/crypto.ts`:

```typescript
import { blake2b } from "blakejs";
import nacl from "tweetnacl";

/**
 * Encrypt a secret using libsodium's sealed box algorithm.
 * Implementation based on tweetsodium using tweetnacl + blakejs.
 *
 * The sealed box format is: ephemeral_public_key (32 bytes) || ciphertext
 */
export function encryptSecret(publicKey: string, secretValue: string): string {
 const messageBytes = Buffer.from(secretValue);
 const publicKeyBytes = Buffer.from(publicKey, "base64");

 // Generate ephemeral keypair
 const ephemeralKeyPair = nacl.box.keyPair();

 // Derive nonce from ephemeral public key and recipient public key using BLAKE2b
 const nonceInput = new Uint8Array(64);
 nonceInput.set(ephemeralKeyPair.publicKey);
 nonceInput.set(publicKeyBytes, 32);
 const nonce = blake2b(nonceInput, undefined, 24);

 // Encrypt the message
 const ciphertext = nacl.box(messageBytes, nonce, publicKeyBytes, ephemeralKeyPair.secretKey);

 // Sealed box format: ephemeral_public_key || ciphertext
 const sealed = new Uint8Array(ephemeralKeyPair.publicKey.length + ciphertext.length);
 sealed.set(ephemeralKeyPair.publicKey);
 sealed.set(ciphertext, ephemeralKeyPair.publicKey.length);

 return Buffer.from(sealed).toString("base64");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run package/__test__/lib/crypto.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add package/src/lib/crypto.ts package/__test__/lib/crypto.test.ts
git commit -m "feat: port NaCl sealed box encryption to crypto module

Extract encryptSecret from sync.ts into standalone module for
reuse by the new GitHubClient service.

Signed-off-by: C. Spencer Beggs <spencer@beggs.codes>"
```

---

### Task 9: ConfigLoader Service

**Files:**

- Create: `package/src/services/ConfigLoader.ts`
- Test: `package/__test__/services/ConfigLoader.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { Effect, Layer } from "effect";
import { parse, stringify } from "smol-toml";
import { describe, expect, it } from "vitest";
import { ConfigError, CredentialsError } from "../../src/errors.js";
import { ConfigLoader, ConfigLoaderLive } from "../../src/services/ConfigLoader.js";

// Helper: create a mock filesystem layer for ConfigLoader
// ConfigLoader.loadConfig and loadCredentials accept TOML strings
// for testability, with file I/O handled by the CLI layer.

describe("ConfigLoader", () => {
 const testLayer = ConfigLoaderLive;

 it("loads valid config TOML", async () => {
  const toml = stringify({
   owner: "spencerbeggs",
   repos: {
    mygroup: { names: ["repo-one"] },
   },
  });

  const program = Effect.gen(function* () {
   const loader = yield* ConfigLoader;
   return yield* loader.parseConfig(toml);
  }).pipe(Effect.provide(testLayer));

  const result = await Effect.runPromise(program);
  expect(result.owner).toBe("spencerbeggs");
  expect(result.repos.mygroup.names).toEqual(["repo-one"]);
 });

 it("returns ConfigError for invalid TOML", async () => {
  const program = Effect.gen(function* () {
   const loader = yield* ConfigLoader;
   return yield* loader.parseConfig("invalid = [broken toml");
  }).pipe(Effect.provide(testLayer));

  const exit = await Effect.runPromiseExit(program);
  expect(exit._tag).toBe("Failure");
 });

 it("returns ConfigError for valid TOML that fails schema", async () => {
  const toml = stringify({ owner: 123 });

  const program = Effect.gen(function* () {
   const loader = yield* ConfigLoader;
   return yield* loader.parseConfig(toml);
  }).pipe(Effect.provide(testLayer));

  const exit = await Effect.runPromiseExit(program);
  expect(exit._tag).toBe("Failure");
 });

 it("loads valid credentials TOML", async () => {
  const toml = stringify({
   profiles: {
    personal: { github_token: "ghp_abc" },
   },
  });

  const program = Effect.gen(function* () {
   const loader = yield* ConfigLoader;
   return yield* loader.parseCredentials(toml);
  }).pipe(Effect.provide(testLayer));

  const result = await Effect.runPromise(program);
  expect(result.profiles.personal.github_token).toBe("ghp_abc");
 });

 it("returns empty profiles for empty credentials", async () => {
  const program = Effect.gen(function* () {
   const loader = yield* ConfigLoader;
   return yield* loader.parseCredentials("");
  }).pipe(Effect.provide(testLayer));

  const result = await Effect.runPromise(program);
  expect(result.profiles).toEqual({});
 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run package/__test__/services/ConfigLoader.test.ts`

Expected: FAIL -- cannot find module

- [ ] **Step 3: Implement ConfigLoader**

Create `package/src/services/ConfigLoader.ts`:

```typescript
import { Context, Effect, Layer, Schema } from "effect";
import { parse } from "smol-toml";
import { ConfigError, CredentialsError } from "../errors.js";
import type { Config } from "../schemas/config.js";
import { ConfigSchema } from "../schemas/config.js";
import type { Credentials } from "../schemas/credentials.js";
import { CredentialsSchema } from "../schemas/credentials.js";

export interface ConfigLoaderService {
 readonly parseConfig: (toml: string) => Effect.Effect<Config, ConfigError>;
 readonly parseCredentials: (toml: string) => Effect.Effect<Credentials, CredentialsError>;
}

export class ConfigLoader extends Context.Tag("ConfigLoader")<ConfigLoader, ConfigLoaderService>() {}

export const ConfigLoaderLive = Layer.succeed(ConfigLoader, {
 parseConfig(toml: string) {
  return Effect.try({
   try: () => {
    const parsed = parse(toml);
    return Schema.decodeUnknownSync(ConfigSchema)(parsed);
   },
   catch: (error) =>
    new ConfigError({
     message: error instanceof Error ? error.message : "Failed to parse config",
    }),
  });
 },

 parseCredentials(toml: string) {
  return Effect.try({
   try: () => {
    if (toml.trim() === "") {
     return Schema.decodeUnknownSync(CredentialsSchema)({});
    }
    const parsed = parse(toml);
    return Schema.decodeUnknownSync(CredentialsSchema)(parsed);
   },
   catch: (error) =>
    new CredentialsError({
     message: error instanceof Error ? error.message : "Failed to parse credentials",
    }),
  });
 },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run package/__test__/services/ConfigLoader.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add package/src/services/ConfigLoader.ts package/__test__/services/ConfigLoader.test.ts
git commit -m "feat: add ConfigLoader service for TOML parsing and validation

Parse and validate gh-sync.config.toml and gh-sync.credentials.toml
using smol-toml and Effect Schema. Returns typed errors on failure.

Signed-off-by: C. Spencer Beggs <spencer@beggs.codes>"
```

---

### Task 10: OnePasswordClient Service

**Files:**

- Create: `package/src/services/OnePasswordClient.ts`
- Test: `package/__test__/services/OnePasswordClient.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { OnePasswordError } from "../../src/errors.js";
import { OnePasswordClient, OnePasswordClientTest } from "../../src/services/OnePasswordClient.js";

describe("OnePasswordClient", () => {
 describe("Test implementation", () => {
  const testLayer = OnePasswordClientTest({
   "op://vault/item/field": "resolved-secret-value",
   "op://vault/other/field": "other-value",
  });

  it("resolves known reference", async () => {
   const program = Effect.gen(function* () {
    const client = yield* OnePasswordClient;
    return yield* client.resolve("op://vault/item/field", "fake-token");
   }).pipe(Effect.provide(testLayer));

   const result = await Effect.runPromise(program);
   expect(result).toBe("resolved-secret-value");
  });

  it("fails for unknown reference", async () => {
   const program = Effect.gen(function* () {
    const client = yield* OnePasswordClient;
    return yield* client.resolve("op://vault/missing/field", "fake-token");
   }).pipe(Effect.provide(testLayer));

   const exit = await Effect.runPromiseExit(program);
   expect(exit._tag).toBe("Failure");
  });
 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run package/__test__/services/OnePasswordClient.test.ts`

Expected: FAIL -- cannot find module

- [ ] **Step 3: Implement OnePasswordClient**

Create `package/src/services/OnePasswordClient.ts`:

```typescript
import { Context, Effect, Layer } from "effect";
import { OnePasswordError } from "../errors.js";

export interface OnePasswordClientService {
 readonly resolve: (reference: string, serviceAccountToken: string) => Effect.Effect<string, OnePasswordError>;
}

export class OnePasswordClient extends Context.Tag("OnePasswordClient")<
 OnePasswordClient,
 OnePasswordClientService
>() {}

export const OnePasswordClientLive = Layer.succeed(OnePasswordClient, {
 resolve(reference: string, serviceAccountToken: string) {
  return Effect.tryPromise({
   try: async () => {
    const { createClient } = await import("@1password/sdk");
    const client = await createClient({
     auth: serviceAccountToken,
     integrationName: "gh-sync",
     integrationVersion: "1.0.0",
    });
    return await client.secrets.resolve(reference);
   },
   catch: (error) =>
    new OnePasswordError({
     message: `Failed to resolve ${reference}: ${error instanceof Error ? error.message : String(error)}`,
    }),
  });
 },
});

export function OnePasswordClientTest(
 stubs: Record<string, string>,
): Layer.Layer<OnePasswordClient> {
 return Layer.succeed(OnePasswordClient, {
  resolve(reference: string, _serviceAccountToken: string) {
   const value = stubs[reference];
   if (value === undefined) {
    return Effect.fail(
     new OnePasswordError({
      message: `Test stub: unknown reference ${reference}`,
     }),
    );
   }
   return Effect.succeed(value);
  },
 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run package/__test__/services/OnePasswordClient.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add package/src/services/OnePasswordClient.ts package/__test__/services/OnePasswordClient.test.ts
git commit -m "feat: add OnePasswordClient service with Live and Test layers

Wraps @1password/sdk for resolving op:// secret references.
Test layer uses deterministic stubs for unit testing.

Signed-off-by: C. Spencer Beggs <spencer@beggs.codes>"
```

---

### Task 11: ValueResolver Service

**Files:**

- Create: `package/src/services/ValueResolver.ts`
- Test: `package/__test__/services/ValueResolver.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OnePasswordClient, OnePasswordClientTest } from "../../src/services/OnePasswordClient.js";
import { ValueResolver, ValueResolverLive } from "../../src/services/ValueResolver.js";

describe("ValueResolver", () => {
 let tempDir: string;

 const opStubs = OnePasswordClientTest({
  "op://vault/item/field": "op-resolved-value",
 });

 const testLayer = Layer.provide(ValueResolverLive, opStubs);

 beforeEach(() => {
  tempDir = join(tmpdir(), `gh-sync-vr-test-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
 });

 afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
 });

 it("resolves file source", async () => {
  writeFileSync(join(tempDir, "secret.txt"), "file-secret-value");

  const program = Effect.gen(function* () {
   const resolver = yield* ValueResolver;
   return yield* resolver.resolve({ file: "./secret.txt" }, tempDir);
  }).pipe(Effect.provide(testLayer));

  const result = await Effect.runPromise(program);
  expect(result).toBe("file-secret-value");
 });

 it("resolves value source", async () => {
  const program = Effect.gen(function* () {
   const resolver = yield* ValueResolver;
   return yield* resolver.resolve({ value: "inline-secret" }, tempDir);
  }).pipe(Effect.provide(testLayer));

  const result = await Effect.runPromise(program);
  expect(result).toBe("inline-secret");
 });

 it("resolves json source", async () => {
  const program = Effect.gen(function* () {
   const resolver = yield* ValueResolver;
   return yield* resolver.resolve({ json: { foo: "bar", baz: 123 } }, tempDir);
  }).pipe(Effect.provide(testLayer));

  const result = await Effect.runPromise(program);
  expect(result).toBe(JSON.stringify({ foo: "bar", baz: 123 }));
 });

 it("resolves op source", async () => {
  const program = Effect.gen(function* () {
   const resolver = yield* ValueResolver;
   return yield* resolver.resolve({ op: "op://vault/item/field" }, tempDir, "fake-token");
  }).pipe(Effect.provide(testLayer));

  const result = await Effect.runPromise(program);
  expect(result).toBe("op-resolved-value");
 });

 it("fails for missing file", async () => {
  const program = Effect.gen(function* () {
   const resolver = yield* ValueResolver;
   return yield* resolver.resolve({ file: "./missing.txt" }, tempDir);
  }).pipe(Effect.provide(testLayer));

  const exit = await Effect.runPromiseExit(program);
  expect(exit._tag).toBe("Failure");
 });

 it("fails for op source without token", async () => {
  const program = Effect.gen(function* () {
   const resolver = yield* ValueResolver;
   return yield* resolver.resolve({ op: "op://vault/item/field" }, tempDir);
  }).pipe(Effect.provide(testLayer));

  const exit = await Effect.runPromiseExit(program);
  expect(exit._tag).toBe("Failure");
 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run package/__test__/services/ValueResolver.test.ts`

Expected: FAIL -- cannot find module

- [ ] **Step 3: Implement ValueResolver**

Create `package/src/services/ValueResolver.ts`:

```typescript
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { Context, Effect, Layer } from "effect";
import { ResolveError } from "../errors.js";
import type { ValueSource } from "../schemas/common.js";
import { OnePasswordClient } from "./OnePasswordClient.js";

export interface ValueResolverService {
 readonly resolve: (
  source: ValueSource,
  basePath: string,
  opToken?: string,
 ) => Effect.Effect<string, ResolveError>;
}

export class ValueResolver extends Context.Tag("ValueResolver")<ValueResolver, ValueResolverService>() {}

export const ValueResolverLive = Layer.effect(
 ValueResolver,
 Effect.gen(function* () {
  const opClient = yield* OnePasswordClient;

  return {
   resolve(source: ValueSource, basePath: string, opToken?: string) {
    if ("file" in source) {
     return Effect.try({
      try: () => {
       const filePath = isAbsolute(source.file) ? source.file : resolve(basePath, source.file);
       return readFileSync(filePath, "utf-8").trim();
      },
      catch: (error) =>
       new ResolveError({
        message: `Failed to read file ${source.file}: ${error instanceof Error ? error.message : String(error)}`,
       }),
     });
    }

    if ("value" in source) {
     return Effect.succeed(source.value);
    }

    if ("json" in source) {
     return Effect.try({
      try: () => JSON.stringify(source.json),
      catch: (error) =>
       new ResolveError({
        message: `Failed to serialize JSON: ${error instanceof Error ? error.message : String(error)}`,
       }),
     });
    }

    if ("op" in source) {
     if (!opToken) {
      return Effect.fail(
       new ResolveError({
        message: `No 1Password service account token provided for ${source.op}`,
       }),
      );
     }
     return opClient.resolve(source.op, opToken).pipe(
      Effect.mapError(
       (err) =>
        new ResolveError({
         message: err.message,
        }),
      ),
     );
    }

    return Effect.fail(new ResolveError({ message: "Unknown value source type" }));
   },
  };
 }),
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run package/__test__/services/ValueResolver.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add package/src/services/ValueResolver.ts package/__test__/services/ValueResolver.test.ts
git commit -m "feat: add ValueResolver service for file/value/json/op resolution

Unified resolution of value sources. File paths resolve relative
to config directory. 1Password references delegate to OnePasswordClient.

Signed-off-by: C. Spencer Beggs <spencer@beggs.codes>"
```

---

### Task 12: GitHubClient Service

**Files:**

- Create: `package/src/services/GitHubClient.ts`
- Test: `package/__test__/services/GitHubClient.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { GitHubClient, GitHubClientTest } from "../../src/services/GitHubClient.js";

describe("GitHubClient", () => {
 describe("Test implementation", () => {
  it("records syncSecret calls", async () => {
   const recorder = GitHubClientTest();

   const program = Effect.gen(function* () {
    const client = yield* GitHubClient;
    yield* client.syncSecret("owner", "repo", "SECRET_NAME", "secret-value", "actions");
   }).pipe(Effect.provide(recorder.layer));

   await Effect.runPromise(program);
   expect(recorder.calls()).toContainEqual({
    method: "syncSecret",
    args: { owner: "owner", repo: "repo", name: "SECRET_NAME", scope: "actions" },
   });
  });

  it("records syncVariable calls", async () => {
   const recorder = GitHubClientTest();

   const program = Effect.gen(function* () {
    const client = yield* GitHubClient;
    yield* client.syncVariable("owner", "repo", "VAR_NAME", "var-value");
   }).pipe(Effect.provide(recorder.layer));

   await Effect.runPromise(program);
   expect(recorder.calls()).toContainEqual({
    method: "syncVariable",
    args: { owner: "owner", repo: "repo", name: "VAR_NAME" },
   });
  });

  it("records syncSettings calls", async () => {
   const recorder = GitHubClientTest();

   const program = Effect.gen(function* () {
    const client = yield* GitHubClient;
    yield* client.syncSettings("owner", "repo", { has_wiki: false });
   }).pipe(Effect.provide(recorder.layer));

   await Effect.runPromise(program);
   expect(recorder.calls()).toContainEqual({
    method: "syncSettings",
    args: { owner: "owner", repo: "repo", settings: { has_wiki: false } },
   });
  });

  it("records syncRuleset calls", async () => {
   const recorder = GitHubClientTest();

   const program = Effect.gen(function* () {
    const client = yield* GitHubClient;
    yield* client.syncRuleset("owner", "repo", "workflow", { name: "workflow", target: "branch", enforcement: "active", rules: [], conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } } });
   }).pipe(Effect.provide(recorder.layer));

   await Effect.runPromise(program);
   expect(recorder.calls()).toContainEqual({
    method: "syncRuleset",
    args: { owner: "owner", repo: "repo", name: "workflow" },
   });
  });

  it("returns empty arrays for list methods", async () => {
   const recorder = GitHubClientTest();

   const program = Effect.gen(function* () {
    const client = yield* GitHubClient;
    const secrets = yield* client.listSecrets("owner", "repo", "actions");
    const variables = yield* client.listVariables("owner", "repo");
    const rulesets = yield* client.listRulesets("owner", "repo");
    return { secrets, variables, rulesets };
   }).pipe(Effect.provide(recorder.layer));

   const result = await Effect.runPromise(program);
   expect(result.secrets).toEqual([]);
   expect(result.variables).toEqual([]);
   expect(result.rulesets).toEqual([]);
  });
 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run package/__test__/services/GitHubClient.test.ts`

Expected: FAIL -- cannot find module

- [ ] **Step 3: Implement GitHubClient**

Create `package/src/services/GitHubClient.ts`:

```typescript
import { Octokit } from "@octokit/rest";
import { Context, Effect, Layer } from "effect";
import { GitHubApiError } from "../errors.js";
import { encryptSecret } from "../lib/crypto.js";

type SecretScope = "actions" | "dependabot" | "codespaces";

interface RulesetPayload {
 name: string;
 target: "branch" | "tag";
 enforcement: "active" | "disabled" | "evaluate";
 conditions?: unknown;
 rules?: unknown;
 bypass_actors?: unknown;
}

interface SecretInfo {
 name: string;
}

interface VariableInfo {
 name: string;
}

interface RulesetInfo {
 name: string;
 id: number;
 source_type?: string;
}

export interface GitHubClientService {
 readonly syncSecret: (
  owner: string,
  repo: string,
  name: string,
  value: string,
  scope: SecretScope,
 ) => Effect.Effect<void, GitHubApiError>;

 readonly syncVariable: (
  owner: string,
  repo: string,
  name: string,
  value: string,
 ) => Effect.Effect<void, GitHubApiError>;

 readonly syncSettings: (
  owner: string,
  repo: string,
  settings: Record<string, unknown>,
 ) => Effect.Effect<void, GitHubApiError>;

 readonly syncRuleset: (
  owner: string,
  repo: string,
  name: string,
  payload: RulesetPayload,
 ) => Effect.Effect<void, GitHubApiError>;

 readonly listSecrets: (
  owner: string,
  repo: string,
  scope: SecretScope,
 ) => Effect.Effect<SecretInfo[], GitHubApiError>;

 readonly listVariables: (
  owner: string,
  repo: string,
 ) => Effect.Effect<VariableInfo[], GitHubApiError>;

 readonly listRulesets: (
  owner: string,
  repo: string,
 ) => Effect.Effect<RulesetInfo[], GitHubApiError>;

 readonly deleteSecret: (
  owner: string,
  repo: string,
  name: string,
  scope: SecretScope,
 ) => Effect.Effect<void, GitHubApiError>;

 readonly deleteVariable: (
  owner: string,
  repo: string,
  name: string,
 ) => Effect.Effect<void, GitHubApiError>;

 readonly deleteRuleset: (
  owner: string,
  repo: string,
  rulesetId: number,
 ) => Effect.Effect<void, GitHubApiError>;
}

export class GitHubClient extends Context.Tag("GitHubClient")<GitHubClient, GitHubClientService>() {}

function wrapApiError(error: unknown): GitHubApiError {
 if (error instanceof Error && "status" in error) {
  return new GitHubApiError({
   message: error.message,
   status: (error as { status: number }).status,
  });
 }
 return new GitHubApiError({
  message: error instanceof Error ? error.message : String(error),
 });
}

export function GitHubClientLive(token: string): Layer.Layer<GitHubClient> {
 const octokit = new Octokit({ auth: token });

 return Layer.succeed(GitHubClient, {
  syncSecret(owner, repo, name, value, scope) {
   return Effect.tryPromise({
    try: async () => {
     const getPublicKey =
      scope === "dependabot"
       ? octokit.dependabot.getRepoPublicKey
       : scope === "codespaces"
        ? octokit.codespaces.getRepoPublicKey
        : octokit.actions.getRepoPublicKey;

     const { data: publicKey } = await getPublicKey({ owner, repo });
     const encryptedValue = encryptSecret(publicKey.key, value);

     const createOrUpdate =
      scope === "dependabot"
       ? octokit.dependabot.createOrUpdateRepoSecret
       : scope === "codespaces"
        ? octokit.codespaces.createOrUpdateRepoSecret
        : octokit.actions.createOrUpdateRepoSecret;

     await createOrUpdate({
      owner,
      repo,
      secret_name: name,
      encrypted_value: encryptedValue,
      key_id: publicKey.key_id,
     });
    },
    catch: wrapApiError,
   });
  },

  syncVariable(owner, repo, name, value) {
   return Effect.tryPromise({
    try: async () => {
     const { data: existing } = await octokit.actions.listRepoVariables({ owner, repo });
     const exists = existing.variables.some((v) => v.name === name);

     if (exists) {
      await octokit.actions.updateRepoVariable({ owner, repo, name, value });
     } else {
      await octokit.actions.createRepoVariable({ owner, repo, name, value });
     }
    },
    catch: wrapApiError,
   });
  },

  syncSettings(owner, repo, settings) {
   return Effect.tryPromise({
    try: async () => {
     await octokit.repos.update({ owner, repo, ...settings });
    },
    catch: wrapApiError,
   });
  },

  syncRuleset(owner, repo, name, payload) {
   return Effect.tryPromise({
    try: async () => {
     const { data: existing } = await octokit.repos.getRepoRulesets({ owner, repo });
     const match = existing.find((r) => r.name === name);

     if (match) {
      await octokit.repos.updateRepoRuleset({
       owner,
       repo,
       ruleset_id: match.id,
       ...payload,
      } as Parameters<typeof octokit.repos.updateRepoRuleset>[0]);
     } else {
      await octokit.repos.createRepoRuleset({
       owner,
       repo,
       ...payload,
      } as Parameters<typeof octokit.repos.createRepoRuleset>[0]);
     }
    },
    catch: wrapApiError,
   });
  },

  listSecrets(owner, repo, scope) {
   return Effect.tryPromise({
    try: async () => {
     const list =
      scope === "dependabot"
       ? octokit.dependabot.listRepoSecrets
       : scope === "codespaces"
        ? octokit.codespaces.listRepoSecrets
        : octokit.actions.listRepoSecrets;

     const { data } = await list({ owner, repo });
     return data.secrets.map((s) => ({ name: s.name }));
    },
    catch: wrapApiError,
   });
  },

  listVariables(owner, repo) {
   return Effect.tryPromise({
    try: async () => {
     const { data } = await octokit.actions.listRepoVariables({ owner, repo });
     return data.variables.map((v) => ({ name: v.name }));
    },
    catch: wrapApiError,
   });
  },

  listRulesets(owner, repo) {
   return Effect.tryPromise({
    try: async () => {
     const { data } = await octokit.repos.getRepoRulesets({ owner, repo });
     return data.map((r) => ({
      name: r.name,
      id: r.id,
      source_type: r.source_type ?? undefined,
     }));
    },
    catch: wrapApiError,
   });
  },

  deleteSecret(owner, repo, name, scope) {
   return Effect.tryPromise({
    try: async () => {
     const del =
      scope === "dependabot"
       ? octokit.dependabot.deleteRepoSecret
       : scope === "codespaces"
        ? octokit.codespaces.deleteRepoSecret
        : octokit.actions.deleteRepoSecret;

     await del({ owner, repo, secret_name: name });
    },
    catch: wrapApiError,
   });
  },

  deleteVariable(owner, repo, name) {
   return Effect.tryPromise({
    try: async () => {
     await octokit.actions.deleteRepoVariable({ owner, repo, name });
    },
    catch: wrapApiError,
   });
  },

  deleteRuleset(owner, repo, rulesetId) {
   return Effect.tryPromise({
    try: async () => {
     await octokit.repos.deleteRepoRuleset({ owner, repo, ruleset_id: rulesetId });
    },
    catch: wrapApiError,
   });
  },
 });
}

interface RecordedCall {
 method: string;
 args: Record<string, unknown>;
}

export function GitHubClientTest(): {
 layer: Layer.Layer<GitHubClient>;
 calls: () => RecordedCall[];
} {
 const recorded: RecordedCall[] = [];

 const layer = Layer.succeed(GitHubClient, {
  syncSecret(owner, repo, name, _value, scope) {
   recorded.push({ method: "syncSecret", args: { owner, repo, name, scope } });
   return Effect.void;
  },
  syncVariable(owner, repo, name, _value) {
   recorded.push({ method: "syncVariable", args: { owner, repo, name } });
   return Effect.void;
  },
  syncSettings(owner, repo, settings) {
   recorded.push({ method: "syncSettings", args: { owner, repo, settings } });
   return Effect.void;
  },
  syncRuleset(owner, repo, name, _payload) {
   recorded.push({ method: "syncRuleset", args: { owner, repo, name } });
   return Effect.void;
  },
  listSecrets(_owner, _repo, _scope) {
   return Effect.succeed([]);
  },
  listVariables(_owner, _repo) {
   return Effect.succeed([]);
  },
  listRulesets(_owner, _repo) {
   return Effect.succeed([]);
  },
  deleteSecret(owner, repo, name, scope) {
   recorded.push({ method: "deleteSecret", args: { owner, repo, name, scope } });
   return Effect.void;
  },
  deleteVariable(owner, repo, name) {
   recorded.push({ method: "deleteVariable", args: { owner, repo, name } });
   return Effect.void;
  },
  deleteRuleset(owner, repo, rulesetId) {
   recorded.push({ method: "deleteRuleset", args: { owner, repo, rulesetId } });
   return Effect.void;
  },
 });

 return { layer, calls: () => [...recorded] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run package/__test__/services/GitHubClient.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add package/src/services/GitHubClient.ts package/__test__/services/GitHubClient.test.ts
git commit -m "feat: add GitHubClient service wrapping Octokit

Provides sync, list, and delete methods for secrets (actions,
dependabot, codespaces), variables, settings, and rulesets.
Test layer records calls for assertion.

Signed-off-by: C. Spencer Beggs <spencer@beggs.codes>"
```

---

### Task 13: SyncEngine Service

**Files:**

- Create: `package/src/services/SyncEngine.ts`
- Test: `package/__test__/services/SyncEngine.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import type { Config } from "../../src/schemas/config.js";
import type { Credentials } from "../../src/schemas/credentials.js";
import { GitHubClient, GitHubClientTest } from "../../src/services/GitHubClient.js";
import { OnePasswordClientTest } from "../../src/services/OnePasswordClient.js";
import { ValueResolver, ValueResolverLive } from "../../src/services/ValueResolver.js";
import { SyncEngine, SyncEngineLive } from "../../src/services/SyncEngine.js";

function makeTestConfig(overrides: Partial<Config> = {}): Config {
 return {
  owner: "testowner",
  settings: {},
  secrets: {
   deploy: {
    NPM_TOKEN: { value: "npm-secret" },
   },
  },
  variables: {
   common: {
    NODE_ENV: { value: "production" },
   },
  },
  rulesets: {},
  cleanup: {
   secrets: false,
   variables: false,
   dependabot_secrets: false,
   codespaces_secrets: false,
   rulesets: false,
   preserve: { secrets: [], variables: [], dependabot_secrets: [], codespaces_secrets: [], rulesets: [] },
  },
  repos: {
   mygroup: {
    names: ["repo-one"],
    secrets: { actions: ["deploy"] },
    variables: { actions: ["common"] },
   },
  },
  ...overrides,
 };
}

function makeTestCredentials(): Credentials {
 return {
  profiles: {
   default: { github_token: "ghp_test" },
  },
 };
}

describe("SyncEngine", () => {
 it("syncs secrets and variables to repos in a group", async () => {
  const recorder = GitHubClientTest();
  const opStubs = OnePasswordClientTest({});
  const resolverLayer = Layer.provide(ValueResolverLive, opStubs);
  const testLayer = Layer.provideMerge(SyncEngineLive, Layer.merge(recorder.layer, resolverLayer));

  const config = makeTestConfig();
  const creds = makeTestCredentials();

  const program = Effect.gen(function* () {
   const engine = yield* SyncEngine;
   return yield* engine.syncAll(config, creds, { dryRun: false, noCleanup: false });
  }).pipe(Effect.provide(testLayer));

  await Effect.runPromise(program);

  const calls = recorder.calls();
  expect(calls).toContainEqual(
   expect.objectContaining({ method: "syncSecret", args: expect.objectContaining({ name: "NPM_TOKEN", scope: "actions" }) }),
  );
  expect(calls).toContainEqual(
   expect.objectContaining({ method: "syncVariable", args: expect.objectContaining({ name: "NODE_ENV" }) }),
  );
 });

 it("skips mutations in dry-run mode", async () => {
  const recorder = GitHubClientTest();
  const opStubs = OnePasswordClientTest({});
  const resolverLayer = Layer.provide(ValueResolverLive, opStubs);
  const testLayer = Layer.provideMerge(SyncEngineLive, Layer.merge(recorder.layer, resolverLayer));

  const config = makeTestConfig();
  const creds = makeTestCredentials();

  const program = Effect.gen(function* () {
   const engine = yield* SyncEngine;
   return yield* engine.syncAll(config, creds, { dryRun: true, noCleanup: false });
  }).pipe(Effect.provide(testLayer));

  await Effect.runPromise(program);

  const calls = recorder.calls();
  expect(calls.filter((c) => c.method.startsWith("sync"))).toHaveLength(0);
 });

 it("uses owner override from repo group", async () => {
  const recorder = GitHubClientTest();
  const opStubs = OnePasswordClientTest({});
  const resolverLayer = Layer.provide(ValueResolverLive, opStubs);
  const testLayer = Layer.provideMerge(SyncEngineLive, Layer.merge(recorder.layer, resolverLayer));

  const config = makeTestConfig({
   repos: {
    mygroup: {
     owner: "custom-owner",
     names: ["repo-one"],
     secrets: { actions: ["deploy"] },
    },
   },
  });
  const creds = makeTestCredentials();

  const program = Effect.gen(function* () {
   const engine = yield* SyncEngine;
   return yield* engine.syncAll(config, creds, { dryRun: false, noCleanup: false });
  }).pipe(Effect.provide(testLayer));

  await Effect.runPromise(program);

  const calls = recorder.calls();
  expect(calls[0].args.owner).toBe("custom-owner");
 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run package/__test__/services/SyncEngine.test.ts`

Expected: FAIL -- cannot find module

- [ ] **Step 3: Implement SyncEngine**

Create `package/src/services/SyncEngine.ts`:

```typescript
import { Context, Effect, Layer } from "effect";
import { SyncError } from "../errors.js";
import type { Config } from "../schemas/config.js";
import type { ValueSource } from "../schemas/common.js";
import type { Credentials } from "../schemas/credentials.js";
import { GitHubClient } from "./GitHubClient.js";
import { ValueResolver } from "./ValueResolver.js";

interface SyncOptions {
 readonly dryRun: boolean;
 readonly noCleanup: boolean;
 readonly groupFilter?: string;
 readonly repoFilter?: string;
}

export interface SyncEngineService {
 readonly syncAll: (
  config: Config,
  credentials: Credentials,
  options: SyncOptions,
 ) => Effect.Effect<void, SyncError>;
}

export class SyncEngine extends Context.Tag("SyncEngine")<SyncEngine, SyncEngineService>() {}

export const SyncEngineLive = Layer.effect(
 SyncEngine,
 Effect.gen(function* () {
  const github = yield* GitHubClient;
  const resolver = yield* ValueResolver;

  return {
   syncAll(config, credentials, options) {
    return Effect.gen(function* () {
     const { dryRun, noCleanup, groupFilter, repoFilter } = options;

     // Resolve credential profile
     const profileNames = Object.keys(credentials.profiles);
     const defaultProfile = profileNames.length === 1 ? profileNames[0] : undefined;

     const repoGroups = Object.entries(config.repos).filter(
      ([name]) => !groupFilter || name === groupFilter,
     );

     if (groupFilter && repoGroups.length === 0) {
      return yield* Effect.fail(new SyncError({ message: `Unknown group: ${groupFilter}` }));
     }

     for (const [groupName, group] of repoGroups) {
      const owner = group.owner ?? config.owner;
      if (!owner) {
       return yield* Effect.fail(
        new SyncError({ message: `No owner defined for group ${groupName}` }),
       );
      }

      // Resolve credentials for this group
      const profileName = group.credentials ?? defaultProfile;
      const profile = profileName ? credentials.profiles[profileName] : undefined;
      const opToken = profile?.op_service_account_token;

      const repos = repoFilter ? group.names.filter((n) => n === repoFilter) : group.names;

      // Resolve all secret values for this group
      const resolvedSecrets = new Map<string, Map<string, string>>();
      const secretScopes = group.secrets ?? {};
      const allSecretGroupNames = new Set([
       ...(secretScopes.actions ?? []),
       ...(secretScopes.dependabot ?? []),
       ...(secretScopes.codespaces ?? []),
      ]);

      for (const secretGroupName of allSecretGroupNames) {
       const secretGroup = config.secrets?.[secretGroupName];
       if (!secretGroup) continue;
       const resolved = new Map<string, string>();
       for (const [secretName, source] of Object.entries(secretGroup)) {
        const value = yield* resolver.resolve(source as ValueSource, ".", opToken);
        resolved.set(secretName, value);
       }
       resolvedSecrets.set(secretGroupName, resolved);
      }

      // Resolve all variable values
      const resolvedVariables = new Map<string, Map<string, string>>();
      const variableScopes = group.variables ?? {};
      for (const varGroupName of variableScopes.actions ?? []) {
       const varGroup = config.variables?.[varGroupName];
       if (!varGroup) continue;
       const resolved = new Map<string, string>();
       for (const [varName, source] of Object.entries(varGroup)) {
        const value = yield* resolver.resolve(source as ValueSource, ".", opToken);
        resolved.set(varName, value);
       }
       resolvedVariables.set(varGroupName, resolved);
      }

      // Resolve all ruleset payloads
      const resolvedRulesets = new Map<string, Map<string, string>>();
      for (const rulesetGroupName of group.rulesets ?? []) {
       const rulesetGroup = config.rulesets?.[rulesetGroupName];
       if (!rulesetGroup) continue;
       const resolved = new Map<string, string>();
       for (const [rulesetName, source] of Object.entries(rulesetGroup)) {
        const value = yield* resolver.resolve(source as ValueSource, ".", opToken);
        resolved.set(rulesetName, value);
       }
       resolvedRulesets.set(rulesetGroupName, resolved);
      }

      for (const repo of repos) {
       if (dryRun) {
        continue;
       }

       // Sync secrets by scope
       for (const scope of ["actions", "dependabot", "codespaces"] as const) {
        const groupNames = secretScopes[scope] ?? [];
        for (const gn of groupNames) {
         const resolved = resolvedSecrets.get(gn);
         if (!resolved) continue;
         for (const [name, value] of resolved) {
          yield* github.syncSecret(owner, repo, name, value, scope);
         }
        }
       }

       // Sync variables (actions scope only for now)
       for (const gn of variableScopes.actions ?? []) {
        const resolved = resolvedVariables.get(gn);
        if (!resolved) continue;
        for (const [name, value] of resolved) {
         yield* github.syncVariable(owner, repo, name, value);
        }
       }

       // Sync settings
       for (const settingsGroupName of group.settings ?? []) {
        const settings = config.settings?.[settingsGroupName];
        if (!settings) continue;
        yield* github.syncSettings(owner, repo, settings as Record<string, unknown>);
       }

       // Sync rulesets
       for (const rulesetGroupName of group.rulesets ?? []) {
        const resolved = resolvedRulesets.get(rulesetGroupName);
        if (!resolved) continue;
        for (const [name, payloadJson] of resolved) {
         const payload = JSON.parse(payloadJson);
         yield* github.syncRuleset(owner, repo, name, payload);
        }
       }

       // Cleanup phase
       if (!noCleanup) {
        const cleanup = { ...config.cleanup, ...(group.cleanup ?? {}) };
        const preserve = cleanup.preserve ?? config.cleanup.preserve;

        if (cleanup.secrets) {
         const configuredNames = new Set<string>();
         for (const gn of secretScopes.actions ?? []) {
          const resolved = resolvedSecrets.get(gn);
          if (resolved) for (const name of resolved.keys()) configuredNames.add(name);
         }
         const existing = yield* github.listSecrets(owner, repo, "actions");
         for (const secret of existing) {
          if (!configuredNames.has(secret.name) && !preserve.secrets.includes(secret.name)) {
           yield* github.deleteSecret(owner, repo, secret.name, "actions");
          }
         }
        }

        if (cleanup.variables) {
         const configuredNames = new Set<string>();
         for (const gn of variableScopes.actions ?? []) {
          const resolved = resolvedVariables.get(gn);
          if (resolved) for (const name of resolved.keys()) configuredNames.add(name);
         }
         const existing = yield* github.listVariables(owner, repo);
         for (const variable of existing) {
          if (!configuredNames.has(variable.name) && !preserve.variables.includes(variable.name)) {
           yield* github.deleteVariable(owner, repo, variable.name);
          }
         }
        }

        if (cleanup.dependabot_secrets) {
         const configuredNames = new Set<string>();
         for (const gn of secretScopes.dependabot ?? []) {
          const resolved = resolvedSecrets.get(gn);
          if (resolved) for (const name of resolved.keys()) configuredNames.add(name);
         }
         const existing = yield* github.listSecrets(owner, repo, "dependabot");
         for (const secret of existing) {
          if (!configuredNames.has(secret.name) && !preserve.dependabot_secrets.includes(secret.name)) {
           yield* github.deleteSecret(owner, repo, secret.name, "dependabot");
          }
         }
        }

        if (cleanup.codespaces_secrets) {
         const configuredNames = new Set<string>();
         for (const gn of secretScopes.codespaces ?? []) {
          const resolved = resolvedSecrets.get(gn);
          if (resolved) for (const name of resolved.keys()) configuredNames.add(name);
         }
         const existing = yield* github.listSecrets(owner, repo, "codespaces");
         for (const secret of existing) {
          if (!configuredNames.has(secret.name) && !preserve.codespaces_secrets.includes(secret.name)) {
           yield* github.deleteSecret(owner, repo, secret.name, "codespaces");
          }
         }
        }

        if (cleanup.rulesets) {
         const configuredNames = new Set<string>();
         for (const gn of group.rulesets ?? []) {
          const resolved = resolvedRulesets.get(gn);
          if (resolved) for (const name of resolved.keys()) configuredNames.add(name);
         }
         const existing = yield* github.listRulesets(owner, repo);
         for (const ruleset of existing) {
          if (
           ruleset.source_type === "Repository" &&
           !configuredNames.has(ruleset.name) &&
           !preserve.rulesets.includes(ruleset.name)
          ) {
           yield* github.deleteRuleset(owner, repo, ruleset.id);
          }
         }
        }
       }
      }
     }
    }).pipe(
     Effect.mapError(
      (error) =>
       error instanceof SyncError
        ? error
        : new SyncError({ message: error instanceof Error ? error.message : String(error) }),
     ),
    );
   },
  };
 }),
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run package/__test__/services/SyncEngine.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add package/src/services/SyncEngine.ts package/__test__/services/SyncEngine.test.ts
git commit -m "feat: add SyncEngine service for orchestrating repo sync

Resolves values per repo group, syncs secrets by scope, variables,
settings, and rulesets. Supports dry-run, group/repo filtering,
and cleanup with preserve lists.

Signed-off-by: C. Spencer Beggs <spencer@beggs.codes>"
```

---

### Task 14: CLI Skeleton and Sync Command

**Files:**

- Modify: `package/src/cli/index.ts`
- Create: `package/src/cli/commands/sync.ts`

- [ ] **Step 1: Create the sync command**

Create `package/src/cli/commands/sync.ts`:

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Command, Options } from "@effect/cli";
import { Console, Effect, Layer } from "effect";
import { ConfigLoader, ConfigLoaderLive } from "../../services/ConfigLoader.js";
import { GitHubClient, GitHubClientLive } from "../../services/GitHubClient.js";
import { OnePasswordClient, OnePasswordClientLive } from "../../services/OnePasswordClient.js";
import { SyncEngine, SyncEngineLive } from "../../services/SyncEngine.js";
import { ValueResolver, ValueResolverLive } from "../../services/ValueResolver.js";
import { resolveConfigDir } from "../../lib/config-path.js";

const configOption = Options.file("config").pipe(
 Options.withDescription("Path to config directory or gh-sync.config.toml file"),
 Options.optional,
);

const groupOption = Options.text("group").pipe(
 Options.withDescription("Sync only a specific repo group"),
 Options.optional,
);

const repoOption = Options.text("repo").pipe(
 Options.withDescription("Sync only a specific repo"),
 Options.optional,
);

const dryRunOption = Options.boolean("dry-run").pipe(
 Options.withDescription("Preview changes without making them"),
 Options.withDefault(false),
);

const noCleanupOption = Options.boolean("no-cleanup").pipe(
 Options.withDescription("Skip cleanup of undeclared resources"),
 Options.withDefault(false),
);

export const syncCommand = Command.make(
 "sync",
 { config: configOption, group: groupOption, repo: repoOption, dryRun: dryRunOption, noCleanup: noCleanupOption },
 ({ config, group, repo, dryRun, noCleanup }) =>
  Effect.gen(function* () {
   const configFlag = config._tag === "Some" ? config.value : undefined;
   const configDir = resolveConfigDir({ configFlag });

   if (!configDir) {
    yield* Console.error("No config found. Run 'gh-sync init' to create one.");
    return;
   }

   const configToml = readFileSync(join(configDir, "gh-sync.config.toml"), "utf-8");

   let credsToml = "";
   try {
    credsToml = readFileSync(join(configDir, "gh-sync.credentials.toml"), "utf-8");
   } catch {
    // credentials file is optional
   }

   const loader = yield* ConfigLoader;
   const parsedConfig = yield* loader.parseConfig(configToml);
   const credentials = yield* loader.parseCredentials(credsToml);

   // Build service layers using the first available credential profile
   const profileNames = Object.keys(credentials.profiles);
   const defaultProfile = profileNames.length === 1 ? profileNames[0] : undefined;
   const token = defaultProfile ? credentials.profiles[defaultProfile].github_token : undefined;

   if (!token) {
    yield* Console.error("No GitHub token found. Run 'gh-sync credentials create' first.");
    return;
   }

   const githubLayer = GitHubClientLive(token);
   const opLayer = OnePasswordClientLive;
   const resolverLayer = Layer.provide(ValueResolverLive, opLayer);
   const engineLayer = Layer.provideMerge(SyncEngineLive, Layer.merge(githubLayer, resolverLayer));

   const groupFilter = group._tag === "Some" ? group.value : undefined;
   const repoFilter = repo._tag === "Some" ? repo.value : undefined;

   if (dryRun) {
    yield* Console.log("DRY RUN - no changes will be made\n");
   }

   yield* Effect.provide(
    Effect.gen(function* () {
     const engine = yield* SyncEngine;
     yield* engine.syncAll(parsedConfig, credentials, {
      dryRun,
      noCleanup,
      groupFilter,
      repoFilter,
     });
    }),
    engineLayer,
   );

   yield* Console.log("\nSync complete!");
  }),
).pipe(Command.withDescription("Sync repos with GitHub"));
```

- [ ] **Step 2: Rewrite CLI entry point**

Rewrite `package/src/cli/index.ts`:

```typescript
#!/usr/bin/env node
import { Command } from "@effect/cli";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Effect } from "effect";
import { ConfigLoaderLive } from "../services/ConfigLoader.js";
import { syncCommand } from "./commands/sync.js";

const rootCommand = Command.make("gh-sync").pipe(
 Command.withSubcommands([syncCommand]),
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
```

- [ ] **Step 3: Verify CLI parses**

Run: `pnpm tsx package/src/cli/index.ts --help`

Expected: Shows help with `sync` subcommand listed.

Run: `pnpm tsx package/src/cli/index.ts sync --help`

Expected: Shows sync options (--config, --group, --repo, --dry-run, --no-cleanup).

- [ ] **Step 4: Commit**

```bash
git add package/src/cli/index.ts package/src/cli/commands/sync.ts
git commit -m "feat: rewrite CLI entry point with @effect/cli and sync command

Replace Commander.js with @effect/cli. Root command with sync
subcommand that loads config, resolves credentials, and runs
the SyncEngine.

Signed-off-by: C. Spencer Beggs <spencer@beggs.codes>"
```

---

### Task 15: List, Validate, and Doctor Commands

**Files:**

- Create: `package/src/cli/commands/list.ts`
- Create: `package/src/cli/commands/validate.ts`
- Create: `package/src/cli/commands/doctor.ts`
- Modify: `package/src/cli/index.ts`

- [ ] **Step 1: Create list command**

Create `package/src/cli/commands/list.ts`:

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Command, Options } from "@effect/cli";
import { Console, Effect } from "effect";
import { ConfigLoader } from "../../services/ConfigLoader.js";
import { resolveConfigDir } from "../../lib/config-path.js";

const configOption = Options.file("config").pipe(
 Options.withDescription("Path to config directory or gh-sync.config.toml file"),
 Options.optional,
);

export const listCommand = Command.make(
 "list",
 { config: configOption },
 ({ config }) =>
  Effect.gen(function* () {
   const configFlag = config._tag === "Some" ? config.value : undefined;
   const configDir = resolveConfigDir({ configFlag });

   if (!configDir) {
    yield* Console.error("No config found. Run 'gh-sync init' to create one.");
    return;
   }

   const configToml = readFileSync(join(configDir, "gh-sync.config.toml"), "utf-8");
   const loader = yield* ConfigLoader;
   const parsedConfig = yield* loader.parseConfig(configToml);

   const defaultOwner = parsedConfig.owner ?? "(not set)";
   yield* Console.log(`Default owner: ${defaultOwner}\n`);

   for (const [groupName, group] of Object.entries(parsedConfig.repos)) {
    const owner = group.owner ?? parsedConfig.owner ?? "(not set)";
    yield* Console.log(`[${groupName}] (owner: ${owner})`);

    for (const repo of group.names) {
     yield* Console.log(`  - ${owner}/${repo}`);
    }

    if (group.settings?.length) {
     yield* Console.log(`  settings: ${group.settings.join(", ")}`);
    }
    if (group.secrets) {
     const scopes = Object.entries(group.secrets)
      .filter(([, groups]) => groups && groups.length > 0)
      .map(([scope, groups]) => `${scope}:[${groups!.join(",")}]`);
     if (scopes.length) yield* Console.log(`  secrets: ${scopes.join(", ")}`);
    }
    if (group.variables) {
     const scopes = Object.entries(group.variables)
      .filter(([, groups]) => groups && groups.length > 0)
      .map(([scope, groups]) => `${scope}:[${groups!.join(",")}]`);
     if (scopes.length) yield* Console.log(`  variables: ${scopes.join(", ")}`);
    }
    if (group.rulesets?.length) {
     yield* Console.log(`  rulesets: ${group.rulesets.join(", ")}`);
    }
    if (group.credentials) {
     yield* Console.log(`  credentials: ${group.credentials}`);
    }
    yield* Console.log("");
   }
  }),
).pipe(Command.withDescription("Show config summary"));
```

- [ ] **Step 2: Create validate command**

Create `package/src/cli/commands/validate.ts`:

```typescript
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Command, Options } from "@effect/cli";
import { Console, Effect } from "effect";
import { ConfigLoader } from "../../services/ConfigLoader.js";
import { resolveConfigDir } from "../../lib/config-path.js";
import type { ValueSource } from "../../schemas/common.js";

const configOption = Options.file("config").pipe(
 Options.withDescription("Path to config directory or gh-sync.config.toml file"),
 Options.optional,
);

export const validateCommand = Command.make(
 "validate",
 { config: configOption },
 ({ config }) =>
  Effect.gen(function* () {
   const configFlag = config._tag === "Some" ? config.value : undefined;
   const configDir = resolveConfigDir({ configFlag });
   let hasErrors = false;

   if (!configDir) {
    yield* Console.error("No config found. Run 'gh-sync init' to create one.");
    return;
   }

   // Validate config schema
   const configPath = join(configDir, "gh-sync.config.toml");
   if (!existsSync(configPath)) {
    yield* Console.error(`Config file not found: ${configPath}`);
    return;
   }

   const loader = yield* ConfigLoader;
   const configToml = readFileSync(configPath, "utf-8");
   const configResult = yield* Effect.either(loader.parseConfig(configToml));

   if (configResult._tag === "Left") {
    yield* Console.error(`Config validation failed: ${configResult.left.message}`);
    hasErrors = true;
   } else {
    yield* Console.log("Config schema: valid");
    const parsedConfig = configResult.right;

    // Check reference integrity
    for (const [groupName, group] of Object.entries(parsedConfig.repos)) {
     // Check settings references
     for (const ref of group.settings ?? []) {
      if (!parsedConfig.settings?.[ref]) {
       yield* Console.error(`Group '${groupName}': references unknown settings group '${ref}'`);
       hasErrors = true;
      }
     }

     // Check secret group references
     const allSecretRefs = [
      ...(group.secrets?.actions ?? []),
      ...(group.secrets?.dependabot ?? []),
      ...(group.secrets?.codespaces ?? []),
     ];
     for (const ref of allSecretRefs) {
      if (!parsedConfig.secrets?.[ref]) {
       yield* Console.error(`Group '${groupName}': references unknown secrets group '${ref}'`);
       hasErrors = true;
      }
     }

     // Check variable group references
     for (const ref of group.variables?.actions ?? []) {
      if (!parsedConfig.variables?.[ref]) {
       yield* Console.error(`Group '${groupName}': references unknown variables group '${ref}'`);
       hasErrors = true;
      }
     }

     // Check ruleset references
     for (const ref of group.rulesets ?? []) {
      if (!parsedConfig.rulesets?.[ref]) {
       yield* Console.error(`Group '${groupName}': references unknown rulesets group '${ref}'`);
       hasErrors = true;
      }
     }
    }

    // Check file references exist
    for (const [groupName, group] of Object.entries({
     ...parsedConfig.secrets,
     ...parsedConfig.variables,
     ...parsedConfig.rulesets,
    })) {
     for (const [entryName, source] of Object.entries(group)) {
      if ("file" in (source as ValueSource)) {
       const filePath = join(configDir, (source as { file: string }).file);
       if (!existsSync(filePath)) {
        yield* Console.error(`${groupName}.${entryName}: file not found: ${filePath}`);
        hasErrors = true;
       }
      }
     }
    }
   }

   // Validate credentials
   const credsPath = join(configDir, "gh-sync.credentials.toml");
   if (existsSync(credsPath)) {
    const credsToml = readFileSync(credsPath, "utf-8");
    const credsResult = yield* Effect.either(loader.parseCredentials(credsToml));
    if (credsResult._tag === "Left") {
     yield* Console.error(`Credentials validation failed: ${credsResult.left.message}`);
     hasErrors = true;
    } else {
     yield* Console.log("Credentials schema: valid");

     // Check credential profile references
     if (configResult._tag === "Right") {
      for (const [groupName, group] of Object.entries(configResult.right.repos)) {
       if (group.credentials && !credsResult.right.profiles[group.credentials]) {
        yield* Console.error(
         `Group '${groupName}': references unknown credentials profile '${group.credentials}'`,
        );
        hasErrors = true;
       }
      }
     }
    }
   } else {
    yield* Console.log("Credentials file: not found (optional)");
   }

   if (!hasErrors) {
    yield* Console.log("\nAll checks passed.");
   }
  }),
).pipe(Command.withDescription("Validate config without API calls"));
```

- [ ] **Step 3: Create doctor command**

Create `package/src/cli/commands/doctor.ts`:

```typescript
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Command, Options } from "@effect/cli";
import { Console, Effect } from "effect";
import { parse } from "smol-toml";
import { ConfigLoader } from "../../services/ConfigLoader.js";
import { resolveConfigDir } from "../../lib/config-path.js";

const configOption = Options.file("config").pipe(
 Options.withDescription("Path to config directory or gh-sync.config.toml file"),
 Options.optional,
);

const KNOWN_CONFIG_KEYS = new Set(["owner", "settings", "secrets", "variables", "rulesets", "cleanup", "repos"]);
const KNOWN_REPO_GROUP_KEYS = new Set(["owner", "names", "credentials", "settings", "secrets", "variables", "rulesets", "cleanup"]);
const KNOWN_CLEANUP_KEYS = new Set(["secrets", "variables", "dependabot_secrets", "codespaces_secrets", "rulesets", "preserve"]);

function findClosestMatch(key: string, known: Set<string>): string | undefined {
 let best: string | undefined;
 let bestDist = Number.POSITIVE_INFINITY;

 for (const candidate of known) {
  const dist = levenshtein(key, candidate);
  if (dist < bestDist && dist <= 3) {
   bestDist = dist;
   best = candidate;
  }
 }
 return best;
}

function levenshtein(a: string, b: string): number {
 const matrix: number[][] = [];
 for (let i = 0; i <= a.length; i++) {
  matrix[i] = [i];
 }
 for (let j = 0; j <= b.length; j++) {
  matrix[0][j] = j;
 }
 for (let i = 1; i <= a.length; i++) {
  for (let j = 1; j <= b.length; j++) {
   const cost = a[i - 1] === b[j - 1] ? 0 : 1;
   matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
  }
 }
 return matrix[a.length][b.length];
}

export const doctorCommand = Command.make(
 "doctor",
 { config: configOption },
 ({ config }) =>
  Effect.gen(function* () {
   const configFlag = config._tag === "Some" ? config.value : undefined;
   const configDir = resolveConfigDir({ configFlag });

   if (!configDir) {
    yield* Console.error("No config found. Run 'gh-sync init' to create one.");
    return;
   }

   const configPath = join(configDir, "gh-sync.config.toml");
   if (!existsSync(configPath)) {
    yield* Console.error(`Config file not found: ${configPath}`);
    return;
   }

   const configToml = readFileSync(configPath, "utf-8");

   // Parse raw TOML to check for unknown keys
   let raw: Record<string, unknown>;
   try {
    raw = parse(configToml);
   } catch (err) {
    yield* Console.error(`TOML parse error: ${err instanceof Error ? err.message : String(err)}`);
    return;
   }

   let warnings = 0;

   // Check top-level keys
   for (const key of Object.keys(raw)) {
    if (!KNOWN_CONFIG_KEYS.has(key)) {
     const suggestion = findClosestMatch(key, KNOWN_CONFIG_KEYS);
     const hint = suggestion ? ` -- did you mean '${suggestion}'?` : "";
     yield* Console.log(`Warning: unknown top-level key '${key}'${hint}`);
     warnings++;
    }
   }

   // Check repo group keys
   const repos = raw.repos;
   if (repos && typeof repos === "object") {
    for (const [groupName, group] of Object.entries(repos as Record<string, unknown>)) {
     if (group && typeof group === "object") {
      for (const key of Object.keys(group as Record<string, unknown>)) {
       if (!KNOWN_REPO_GROUP_KEYS.has(key)) {
        const suggestion = findClosestMatch(key, KNOWN_REPO_GROUP_KEYS);
        const hint = suggestion ? ` -- did you mean '${suggestion}'?` : "";
        yield* Console.log(`Warning: unknown key '${key}' in repos.${groupName}${hint}`);
        warnings++;
       }
      }
     }
    }
   }

   // Check cleanup keys
   const cleanup = raw.cleanup;
   if (cleanup && typeof cleanup === "object") {
    for (const key of Object.keys(cleanup as Record<string, unknown>)) {
     if (!KNOWN_CLEANUP_KEYS.has(key)) {
      const suggestion = findClosestMatch(key, KNOWN_CLEANUP_KEYS);
      const hint = suggestion ? ` -- did you mean '${suggestion}'?` : "";
      yield* Console.log(`Warning: unknown key '${key}' in cleanup${hint}`);
      warnings++;
     }
    }
   }

   // Also run full validation
   const loader = yield* ConfigLoader;
   const result = yield* Effect.either(loader.parseConfig(configToml));
   if (result._tag === "Left") {
    yield* Console.error(`Schema validation failed: ${result.left.message}`);
   } else {
    yield* Console.log("Schema validation: passed");
   }

   if (warnings === 0) {
    yield* Console.log("No unknown keys detected.");
   } else {
    yield* Console.log(`\n${warnings} warning(s) found.`);
   }
  }),
).pipe(Command.withDescription("Deep config diagnostics with typo detection"));
```

- [ ] **Step 4: Register all commands in CLI entry point**

Update `package/src/cli/index.ts` to add the new subcommands:

```typescript
#!/usr/bin/env node
import { Command } from "@effect/cli";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Effect } from "effect";
import { ConfigLoaderLive } from "../services/ConfigLoader.js";
import { syncCommand } from "./commands/sync.js";
import { listCommand } from "./commands/list.js";
import { validateCommand } from "./commands/validate.js";
import { doctorCommand } from "./commands/doctor.js";

const rootCommand = Command.make("gh-sync").pipe(
 Command.withSubcommands([syncCommand, listCommand, validateCommand, doctorCommand]),
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
```

- [ ] **Step 5: Verify all commands parse**

Run: `pnpm tsx package/src/cli/index.ts --help`

Expected: Shows help with sync, list, validate, doctor subcommands.

Run: `pnpm tsx package/src/cli/index.ts list --help`

Expected: Shows list command options.

- [ ] **Step 6: Commit**

```bash
git add package/src/cli/index.ts package/src/cli/commands/list.ts package/src/cli/commands/validate.ts package/src/cli/commands/doctor.ts
git commit -m "feat: add list, validate, and doctor CLI commands

list shows config summary, validate checks schema compliance
and reference integrity, doctor detects unknown keys with
typo suggestions using Levenshtein distance.

Signed-off-by: C. Spencer Beggs <spencer@beggs.codes>"
```

---

### Task 16: Init Command

**Files:**

- Create: `package/src/cli/commands/init.ts`
- Modify: `package/src/cli/index.ts`

- [ ] **Step 1: Create init command**

Create `package/src/cli/commands/init.ts`:

```typescript
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { Command, Options } from "@effect/cli";
import { Console, Effect } from "effect";
import { configDir } from "../../lib/xdg.js";

const projectOption = Options.boolean("project").pipe(
 Options.withDescription("Create config in current directory instead of XDG/home location"),
 Options.withDefault(false),
);

const CONFIG_TEMPLATE = `# gh-sync configuration
# See: https://github.com/spencerbeggs/gh-sync

# Default owner for all repo groups (can be overridden per group)
# owner = "your-github-username"

# --- Settings groups ---
# [settings.defaults]
# has_wiki = false
# has_issues = true
# delete_branch_on_merge = true

# --- Secret groups ---
# [secrets.deploy]
# NPM_TOKEN = { op = "op://vault/item/field" }
# API_KEY = { file = "./private/api-key" }
# INLINE_SECRET = { value = "my-secret" }

# --- Variable groups ---
# [variables.common]
# NODE_ENV = { value = "production" }

# --- Ruleset groups ---
# [rulesets.standard]
# workflow = { file = "./rulesets/workflow.json" }

# --- Cleanup defaults ---
# [cleanup]
# secrets = false
# variables = false
# rulesets = false

# --- Repo groups ---
# [repos.my-projects]
# names = ["repo-one", "repo-two"]
# settings = ["defaults"]
# secrets = { actions = ["deploy"] }
# variables = { actions = ["common"] }
# rulesets = ["standard"]
`;

const CREDENTIALS_TEMPLATE = `# gh-sync credentials (keep this file private)
# See: https://github.com/spencerbeggs/gh-sync

# [profiles.personal]
# github_token = "ghp_your_token_here"
# op_service_account_token = "ops_your_token_here"
`;

const CREDENTIALS_FILE = "gh-sync.credentials.toml";
const CONFIG_FILE = "gh-sync.config.toml";

export const initCommand = Command.make(
 "init",
 { project: projectOption },
 ({ project }) =>
  Effect.gen(function* () {
   const targetDir = project ? process.cwd() : configDir();

   if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
   }

   const configPath = join(targetDir, CONFIG_FILE);
   const credsPath = join(targetDir, CREDENTIALS_FILE);

   // Write config file
   if (existsSync(configPath)) {
    yield* Console.log(`Config already exists: ${configPath}`);
   } else {
    writeFileSync(configPath, CONFIG_TEMPLATE);
    yield* Console.log(`Created: ${configPath}`);
   }

   // Write credentials file
   if (existsSync(credsPath)) {
    yield* Console.log(`Credentials already exists: ${credsPath}`);
   } else {
    writeFileSync(credsPath, CREDENTIALS_TEMPLATE);
    yield* Console.log(`Created: ${credsPath}`);
   }

   // Handle .gitignore
   if (project) {
    // Project mode: append to project's .gitignore
    const gitignorePath = join(targetDir, ".gitignore");
    if (existsSync(gitignorePath)) {
     const content = readFileSync(gitignorePath, "utf-8");
     if (!content.includes(CREDENTIALS_FILE)) {
      appendFileSync(gitignorePath, `\n${CREDENTIALS_FILE}\n`);
      yield* Console.log(`Added ${CREDENTIALS_FILE} to .gitignore`);
     }
    } else {
     writeFileSync(gitignorePath, `${CREDENTIALS_FILE}\n`);
     yield* Console.log(`Created .gitignore with ${CREDENTIALS_FILE}`);
    }
   } else {
    // XDG mode: create .gitignore in the config directory
    const gitignorePath = join(targetDir, ".gitignore");
    if (!existsSync(gitignorePath)) {
     writeFileSync(gitignorePath, `${CREDENTIALS_FILE}\n`);
     yield* Console.log(`Created .gitignore in ${targetDir}`);
    }
   }

   yield* Console.log("\nDone! Edit your config and credentials files to get started.");
  }),
).pipe(Command.withDescription("Scaffold config files"));
```

- [ ] **Step 2: Register init command**

Add `initCommand` import and registration in `package/src/cli/index.ts`:

```typescript
import { initCommand } from "./commands/init.js";

const rootCommand = Command.make("gh-sync").pipe(
 Command.withSubcommands([syncCommand, listCommand, validateCommand, doctorCommand, initCommand]),
);
```

- [ ] **Step 3: Verify init command**

Run: `pnpm tsx package/src/cli/index.ts init --help`

Expected: Shows init command with --project option.

- [ ] **Step 4: Commit**

```bash
git add package/src/cli/commands/init.ts package/src/cli/index.ts
git commit -m "feat: add init command for scaffolding config files

Creates gh-sync.config.toml and gh-sync.credentials.toml in
XDG/home directory by default, or current directory with --project.
Handles .gitignore appropriately for each mode.

Signed-off-by: C. Spencer Beggs <spencer@beggs.codes>"
```

---

### Task 17: Credentials Commands

**Files:**

- Create: `package/src/cli/commands/credentials.ts`
- Modify: `package/src/cli/index.ts`

- [ ] **Step 1: Create credentials commands**

Create `package/src/cli/commands/credentials.ts`:

```typescript
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command, Options } from "@effect/cli";
import { Console, Effect } from "effect";
import { parse, stringify } from "smol-toml";
import { configDir } from "../../lib/xdg.js";

const profileOption = Options.text("profile").pipe(Options.withDescription("Credential profile name"));

const githubTokenOption = Options.text("github-token").pipe(
 Options.withDescription("GitHub personal access token"),
 Options.optional,
);

const opTokenOption = Options.text("op-token").pipe(
 Options.withDescription("1Password service account token"),
 Options.optional,
);

function getCredentialsPath(): string {
 return join(configDir(), "gh-sync.credentials.toml");
}

function loadCredentialsFile(): Record<string, unknown> {
 const path = getCredentialsPath();
 if (!existsSync(path)) return {};
 const content = readFileSync(path, "utf-8");
 if (content.trim() === "") return {};
 return parse(content);
}

function saveCredentialsFile(data: Record<string, unknown>): void {
 writeFileSync(getCredentialsPath(), stringify(data));
}

function redactToken(token: string): string {
 if (token.length <= 8) return "****";
 return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

const createCommand = Command.make(
 "create",
 { profile: profileOption, githubToken: githubTokenOption, opToken: opTokenOption },
 ({ profile, githubToken, opToken }) =>
  Effect.gen(function* () {
   const data = loadCredentialsFile();
   const profiles = (data.profiles ?? {}) as Record<string, unknown>;

   if (profiles[profile]) {
    yield* Console.error(`Profile '${profile}' already exists. Delete it first.`);
    return;
   }

   const newProfile: Record<string, string> = {};
   if (githubToken._tag === "Some") {
    newProfile.github_token = githubToken.value;
   }
   if (opToken._tag === "Some") {
    newProfile.op_service_account_token = opToken.value;
   }

   if (Object.keys(newProfile).length === 0) {
    yield* Console.error("Provide at least --github-token or --op-token.");
    return;
   }

   profiles[profile] = newProfile;
   data.profiles = profiles;
   saveCredentialsFile(data);

   yield* Console.log(`Created profile '${profile}'.`);
  }),
).pipe(Command.withDescription("Add a credential profile"));

const listCredsCommand = Command.make("list", {}, () =>
 Effect.gen(function* () {
  const data = loadCredentialsFile();
  const profiles = (data.profiles ?? {}) as Record<string, Record<string, string>>;

  if (Object.keys(profiles).length === 0) {
   yield* Console.log("No credential profiles configured.");
   return;
  }

  for (const [name, profile] of Object.entries(profiles)) {
   yield* Console.log(`[${name}]`);
   if (profile.github_token) {
    yield* Console.log(`  github_token: ${redactToken(profile.github_token)}`);
   }
   if (profile.op_service_account_token) {
    yield* Console.log(`  op_service_account_token: ${redactToken(profile.op_service_account_token)}`);
   }
   yield* Console.log("");
  }
 }),
).pipe(Command.withDescription("List profiles (tokens redacted)"));

const deleteCommand = Command.make(
 "delete",
 { profile: profileOption },
 ({ profile }) =>
  Effect.gen(function* () {
   const data = loadCredentialsFile();
   const profiles = (data.profiles ?? {}) as Record<string, unknown>;

   if (!profiles[profile]) {
    yield* Console.error(`Profile '${profile}' not found.`);
    return;
   }

   delete profiles[profile];
   data.profiles = profiles;
   saveCredentialsFile(data);

   yield* Console.log(`Deleted profile '${profile}'.`);
  }),
).pipe(Command.withDescription("Remove a profile"));

export const credentialsCommand = Command.make("credentials").pipe(
 Command.withDescription("Manage credential profiles"),
 Command.withSubcommands([createCommand, listCredsCommand, deleteCommand]),
);
```

- [ ] **Step 2: Register credentials command**

Add to `package/src/cli/index.ts`:

```typescript
import { credentialsCommand } from "./commands/credentials.js";

const rootCommand = Command.make("gh-sync").pipe(
 Command.withSubcommands([
  syncCommand,
  listCommand,
  validateCommand,
  doctorCommand,
  initCommand,
  credentialsCommand,
 ]),
);
```

- [ ] **Step 3: Verify credentials commands**

Run: `pnpm tsx package/src/cli/index.ts credentials --help`

Expected: Shows create, list, delete subcommands.

Run: `pnpm tsx package/src/cli/index.ts credentials create --help`

Expected: Shows --profile, --github-token, --op-token options.

- [ ] **Step 4: Commit**

```bash
git add package/src/cli/commands/credentials.ts package/src/cli/index.ts
git commit -m "feat: add credentials create, list, and delete commands

Manage credential profiles in gh-sync.credentials.toml with
proper token redaction on list output.

Signed-off-by: C. Spencer Beggs <spencer@beggs.codes>"
```

---

### Task 18: JSON Schema Generation Script

**Files:**

- Create: `package/lib/scripts/generate-json-schema.ts`

- [ ] **Step 1: Create the generation script**

Create `package/lib/scripts/generate-json-schema.ts`:

```typescript
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { JSONSchema } from "effect";
import { ConfigSchema } from "../../src/schemas/config.js";
import { CredentialsSchema } from "../../src/schemas/credentials.js";

const outputDir = join(dirname(new URL(import.meta.url).pathname), "../../schemas");

interface SchemaEntry {
 name: string;
 schema: unknown;
 filename: string;
}

const schemas: SchemaEntry[] = [
 { name: "Config", schema: ConfigSchema, filename: "gh-sync.config.schema.json" },
 { name: "Credentials", schema: CredentialsSchema, filename: "gh-sync.credentials.schema.json" },
];

if (!existsSync(outputDir)) {
 mkdirSync(outputDir, { recursive: true });
}

for (const entry of schemas) {
 const jsonSchema = JSONSchema.make(entry.schema as Parameters<typeof JSONSchema.make>[0]);
 const content = `${JSON.stringify(jsonSchema, null, 2)}\n`;
 const outputPath = join(outputDir, entry.filename);

 if (existsSync(outputPath)) {
  const existing = readFileSync(outputPath, "utf-8");
  if (existing === content) {
   console.log(`  ${entry.name}: unchanged`);
   continue;
  }
 }

 writeFileSync(outputPath, content);
 console.log(`  ${entry.name}: generated -> ${outputPath}`);
}
```

- [ ] **Step 2: Run the script**

Run: `pnpm tsx package/lib/scripts/generate-json-schema.ts`

Expected: Generates two JSON Schema files in `package/schemas/`.

- [ ] **Step 3: Verify generated schemas are valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('package/schemas/gh-sync.config.schema.json', 'utf-8')); console.log('valid')"`

Expected: Prints "valid".

- [ ] **Step 4: Commit**

```bash
git add package/lib/scripts/generate-json-schema.ts package/schemas/
git commit -m "feat: add JSON Schema generation for Tombi TOML completion

Generate JSON schemas from Effect Schema definitions for
gh-sync.config.toml and gh-sync.credentials.toml.

Signed-off-by: C. Spencer Beggs <spencer@beggs.codes>"
```

---

### Task 19: Update Exports and Clean Up Old Code

**Files:**

- Modify: `package/src/index.ts`
- Delete: `package/src/config.ts`
- Delete: `package/src/sync.ts`
- Delete: `package/__test__/config.test.ts`
- Delete: `package/__test__/sync.test.ts`

- [ ] **Step 1: Update package/src/index.ts**

```typescript
/**
 * gh-sync
 *
 * CLI tool to sync GitHub repo settings, secrets, and rulesets
 * across personal repositories.
 *
 * @packageDocumentation
 */

// Schemas
export type { ValueSource, Cleanup, CleanupPreserve } from "./schemas/common.js";
export { ValueSourceSchema, CleanupSchema, CleanupPreserveSchema } from "./schemas/common.js";
export type { Config, RepoGroup } from "./schemas/config.js";
export { ConfigSchema, RepoGroupSchema } from "./schemas/config.js";
export type { Credentials, CredentialProfile } from "./schemas/credentials.js";
export { CredentialsSchema, CredentialProfileSchema } from "./schemas/credentials.js";

// Services
export { ConfigLoader, ConfigLoaderLive } from "./services/ConfigLoader.js";
export { OnePasswordClient, OnePasswordClientLive, OnePasswordClientTest } from "./services/OnePasswordClient.js";
export { ValueResolver, ValueResolverLive } from "./services/ValueResolver.js";
export { GitHubClient, GitHubClientLive, GitHubClientTest } from "./services/GitHubClient.js";
export { SyncEngine, SyncEngineLive } from "./services/SyncEngine.js";

// Errors
export {
 ConfigError,
 CredentialsError,
 GitHubApiError,
 OnePasswordError,
 ResolveError,
 SyncError,
} from "./errors.js";

// Utilities
export { encryptSecret } from "./lib/crypto.js";
export { configDir, configPath, credentialsPath } from "./lib/xdg.js";
export { resolveConfigDir } from "./lib/config-path.js";
```

- [ ] **Step 2: Delete old source files**

```bash
rm package/src/config.ts package/src/sync.ts
rm package/__test__/config.test.ts package/__test__/sync.test.ts
```

- [ ] **Step 3: Run all tests**

Run: `pnpm vitest run`

Expected: All new tests pass, no references to deleted files.

- [ ] **Step 4: Run typecheck**

Run: `pnpm run typecheck`

Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add package/src/index.ts
git rm package/src/config.ts package/src/sync.ts package/__test__/config.test.ts package/__test__/sync.test.ts
git commit -m "refactor: replace old config/sync modules with Effect services

Update public exports to expose new schemas, services, and
utilities. Remove Commander-era config.ts and sync.ts.

Signed-off-by: C. Spencer Beggs <spencer@beggs.codes>"
```

---

### Task 20: Update Git Remote

**Files:** None (git operations only)

- [ ] **Step 1: Update git remote origin**

```bash
git remote set-url origin git@github.com:spencerbeggs/gh-sync.git
```

- [ ] **Step 2: Verify remote**

Run: `git remote -v`

Expected: origin points to `spencerbeggs/gh-sync`.

- [ ] **Step 3: Commit** (no file changes, just verify)

No commit needed -- remote URL is not tracked in the repo.
