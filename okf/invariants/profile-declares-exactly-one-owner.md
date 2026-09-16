---
title: A credential profile declares exactly one owner
description: The two-branch credential profile union makes a profile declaring both username and org, or neither, unrepresentable at decode time.
type: Invariant
status: draft
tags: [security, effect]
resource: ../../package/src/schemas/credentials.ts
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: b15af7b22db081cd2c81a145987484efed84c3266ca5211edbd341bad16eefc7
sources:
  - id: credentials-schema
    resource: ../../package/src/schemas/credentials.ts
  - id: credentials-test
    resource: ../../package/__test__/schemas/credentials.test.ts
---

# A credential profile declares exactly one owner

## Property

Every `[profiles.<name>]` entry in `reposets.credentials.toml` names exactly one of `username` or `org`; a profile with both, or with neither, is unrepresentable at decode time.

## Mechanism

`CredentialProfileSchema` is `Schema.Union([UserProfileSchema, OrgProfileSchema])`[^credentials-schema]. `UserProfileSchema` requires `username: Schema.String` and forbids the other key with `org: Schema.optional(Schema.Never)`; `OrgProfileSchema` is the mirror image, requiring `org` and setting `username: Schema.optional(Schema.Never)`[^credentials-schema]. Each branch forbids the other branch's key rather than merely omitting it, so a profile that sets both is rejected by whichever branch it is checked against, not silently reconciled. The docstring on `CredentialProfileSchema` records why this two-key shape was chosen over a plain union of two structs: a plain union accepts a profile declaring both keys and silently drops the second — verified against the installed beta — which would make the contradictory state representable and resolve it by branch order instead of rejecting it[^credentials-schema].

`profileOwner()` reads the result as a total function rather than an option, because the schema already guarantees exactly one branch matched: `"username" in profile && typeof profile.username === "string"` picks the `User` branch, otherwise it reads `profile.org` for the `Organization` branch[^credentials-schema].

`package/__test__/schemas/credentials.test.ts` pins this with two tests under `describe("a profile says who it acts as, and only one thing")`: `it("rejects a profile declaring both", ...)`, which asserts `decodeResult(profile({ username: "spencerbeggs", org: "savvy-web" })).ok` is `false`, and `it("rejects a profile declaring neither", ...)`[^credentials-test].

## What would break it

Replacing the two-branch union with a single `Schema.Struct` carrying both `username` and `org` as independently optional fields — the "owner + owner_type pair" shape — would make both-declared and neither-declared states decodable, and `profileOwner()` would need to fall back to branch-order or first-truthy logic instead of a guaranteed total read.

[^credentials-schema]: `package/src/schemas/credentials.ts`
[^credentials-test]: `package/__test__/schemas/credentials.test.ts`
