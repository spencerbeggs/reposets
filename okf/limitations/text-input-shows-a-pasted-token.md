---
type: Limitation
title: A token pasted into a credentials name prompt is visible until Enter
description: The reference prompt of credentials create is masked, but the profile, username and organization prompts are not, so a token pasted into one of them shows on screen until it is submitted; it is then refused, never stored or echoed, and the frame is cleared.
status: draft
bounds: ../interfaces/cli.md
tags: [security, dx]
generated:
  by: okfit/claude-code
  at: 2026-10-03T18:04:28Z
  body_sha256: aee06419f07b52365268c762d70349d90f3cc919071fedc267099d5ab77fbe2c
sources:
  - id: cli-credentials
    resource: ../../package/src/cli/commands/credentials.ts
  - id: effected-cli
    resource: npm:@effected/cli@0.12.0
  - id: credentials-test
    resource: ../../package/__test__/cli/credentials.test.ts
---

# A token pasted into a credentials name prompt is visible until Enter

**When it happens.** An interactive `reposets credentials create` asks for
whatever its flags left out: the profile name, the account or organization
name, and the token reference. Each is a `TextInput` from
`@effected/cli/ui`.[^effected-cli] Only the reference prompt is masked. If
a person pastes a real token into the profile, username or organization
prompt, it is on screen, in plain text, until they press
Enter.[^cli-credentials]

**What the reference prompt does instead.** It is the field a token is
most likely to be pasted into, so it is mounted with
`mask: looksLikeSecret`, the same rule its `validate` refuses on. The kit
latches the mask once the rule answers true and keeps it until the field
is emptied, so a paste is masked from its first frame and editing a
pasted token's prefix away never unmasks the rest. A token typed by hand
shows at most its public prefix (`ghp`) before the mask trips. A real
`op://` reference or variable name stays readable.[^cli-credentials]

**What they see after Enter.** The prompt rejects the value in place,
without repeating it: `That looks like a token, not a name. It was not
stored.` for a name, or `That looks like a token, not a reference — enter
where it lives.` for the reference. The value is not written to the
credentials file, to stdout or to stderr. Each text prompt is mounted with
`clear: true`, so its frame is erased when the prompt closes, which keeps
an abandoned value out of the terminal's scrollback. All three are pinned
by `package/__test__/cli/credentials.test.ts`, on the kit's production
render path, where the clearing and the masked frames are
observable.[^credentials-test]

**Why it is acceptable.** No field in this command is meant to hold a
secret. The command stores references only, so a token on screen is
already the mistake the refusal exists to catch, and nothing typed is
persisted or echoed. A person watching over the shoulder can still read it
for as long as it sits in a name field.

**What a fix would take.** Nothing upstream: the kit's `TextInput` already
takes a `mask` predicate, so passing `mask: looksLikeSecret` to the name
prompts would close it. They are left unmasked on purpose: a name is read
back as it is typed, which is how a person sees their own
typo.[^cli-credentials]

[^cli-credentials]: `package/src/cli/commands/credentials.ts`
[^effected-cli]: npm:@effected/cli@0.12.0
[^credentials-test]: `package/__test__/cli/credentials.test.ts`
