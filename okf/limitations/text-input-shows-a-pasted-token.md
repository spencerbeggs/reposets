---
type: Limitation
title: A token pasted into a credentials prompt is visible until Enter
description: The kit's TextInput has no masked mode, so a token pasted into a credentials create prompt shows on screen until it is submitted; it is then refused, never stored or echoed, and the frame is cleared.
status: draft
bounds: ../interfaces/cli.md
tags: [security, dx]
generated:
  by: okfit/claude-code
  at: 2026-10-02T15:49:51Z
  body_sha256: 27193bfe1f0368aebfcebf6387df63c88972f0bdb15847507c17bab9a59ff2ac
sources:
  - id: cli-credentials
    resource: ../../package/src/cli/commands/credentials.ts
  - id: effected-cli
    resource: npm:@effected/cli@0.11.0
  - id: credentials-test
    resource: ../../package/__test__/cli/credentials.test.ts
---

# A token pasted into a credentials prompt is visible until Enter

**When it happens.** An interactive `reposets credentials create` asks for
whatever its flags left out: the profile name, the account or organization
name, and the token reference. Each is a `TextInput` from
`@effected/cli/ui`, which draws what is typed and has no masked
mode.[^effected-cli] If a person pastes a real token into one of those
fields, it is on screen, in plain text, until they press Enter.

**What they see after Enter.** The prompt rejects the value in place,
without repeating it: `That looks like a token, not a name. It was not
stored.` for a name, or `That looks like a token, not a reference — enter
where it lives.` for the reference. The value is not written to the
credentials file, to stdout or to stderr. Each text prompt is mounted with
`clear: true`, so its frame is erased when the prompt closes, which keeps
an abandoned value out of the terminal's scrollback.[^cli-credentials]
The refusal and the clean streams are pinned by
`package/__test__/cli/credentials.test.ts`; the clearing is not observable
in that harness, see
[`gotchas/ui-test-session-hides-clear-and-log-lines.md`](../gotchas/ui-test-session-hides-clear-and-log-lines.md).[^credentials-test]

**Why it is acceptable.** No field in this command is meant to hold a
secret. The command stores references only, so a token on screen is
already the mistake the refusal exists to catch, and nothing typed is
persisted or echoed. A person watching over the shoulder can still read it
for as long as it sits in the field.

**What a fix would take.** A masked mode on the kit's `TextInput`, upstream
in `@effected/cli`. Masking the name fields would cost a person the
ability to see their own typo, so a fix would mask only the reference
field.

[^cli-credentials]: `package/src/cli/commands/credentials.ts`
[^effected-cli]: npm:@effected/cli@0.11.0
[^credentials-test]: `package/__test__/cli/credentials.test.ts`
