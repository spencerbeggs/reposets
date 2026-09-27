---
type: Gotcha
title: A ConfigProvider passed with Layer.provide reads the real environment
description: "A test that wires ConfigProvider.fromEnv under a service with Layer.provide looks isolated, but Config is read in the caller's fiber, so the reads silently fall back to the developer's own process environment."
status: draft
stale_after: 2027-03-27T00:00:00Z
resource: ../../package/__test__/services/CredentialResolver.test.ts
tags: [testing, effect, security]
generated:
  by: okfit/claude-code
  at: 2026-09-27T17:39:49Z
  body_sha256: f06178dbb870ff1f56f75ec242cf719710a0d8b7f7f188a90caac88485d2492f
sources:
  - id: resolver-test
    resource: ../../package/__test__/services/CredentialResolver.test.ts
  - id: credential-resolver
    resource: ../../package/src/services/CredentialResolver.ts
  - id: onepassword-client
    resource: ../../package/src/services/OnePasswordClient.ts
---

# A ConfigProvider passed with Layer.provide reads the real environment

**What you see.** A test builds `CredentialResolverLive` or
`OnePasswordClientLive` and wires an explicit environment under it with
`Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env })))`. It
passes on your machine. It may even pass the "variable unset" case.

**What you will wrongly conclude.** That the service is reading the record
the test handed it, and that the test is hermetic.

**What is true.** Both services read environment variables through
`Config.option(Config.String(name))` when a method *runs*, not when the
layer is built.[^credential-resolver][^onepassword-client] `Config` resolves
against the `ConfigProvider` in the calling fiber's context. A provider
supplied with `Layer.provide` is visible only while the layer is being
built, so the method call never sees it. The read falls back to the default
provider, which is the real process environment. The test then answers from
whatever `GITHUB_TOKEN` or `OP_SERVICE_ACCOUNT_TOKEN` your shell happens to
export. It passes locally and fails in CI, or the reverse, and an "unset"
case goes green only because your shell did not set the variable either.

**What to do instead.** Merge the provider into the layer the test runs
under with `Layer.provideMerge`, so it reaches the caller.
`package/__test__/services/CredentialResolver.test.ts` does this in
`layerWith` and passes an empty record for the "variable unset"
case.[^resolver-test] Any new service that reads `Config` inside a method
needs the same wiring in its tests.

[^resolver-test]: `package/__test__/services/CredentialResolver.test.ts`
[^credential-resolver]: `package/src/services/CredentialResolver.ts`
[^onepassword-client]: `package/src/services/OnePasswordClient.ts`
