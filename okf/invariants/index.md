# Invariant

* [A credential profile declares exactly one owner](profile-declares-exactly-one-owner.md) - The two-branch credential profile union makes a profile declaring both username and org, or neither, unrepresentable at decode time.
* [Cleanup phase properties](cleanup-properties.md) - Three properties the cleanup phase holds by construction, each pinned by a test.
* [Every value CredentialResolver returns is Redacted](resolved-credentials-are-redacted.md) - resolveGitHubToken and resolveAll return Redacted.Redacted\<string\> only, so a secret cannot reach toString, interpolation or JSON.stringify by accident.
* [Phase order is pinned](phase-order-is-pinned.md) - PHASE\_NAMES is the order phases run in, and selection preserves that order regardless of flag order.
* [Phase.run never fails](phase-run-never-fails.md) - Phase.run's error channel is \`never\`; failures are collected into PhaseResult.errors instead of aborting the run.
