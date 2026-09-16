---
title: Verify a sealed-box secret
description: Prove a synced secret decrypts to the value it was given by having a workflow runner report a digest, since GitHub never returns a secret's own value
type: Runbook
tags:
  - security
  - testing
  - github
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: 874644c7d39e7e243993577929f1a3b0be9438ecc56b7ce3219ba25a58714379
---

# Verify a sealed-box secret

**Trigger:** any change to the secrets phase, or a bump of
`@effected/github` (the package that fetches a store's public key and
seals a secret's value with libsodium before it crosses the wire).

**Why this exists:** GitHub never returns a secret's value from any
endpoint — that is the entire point of a secret store. Nothing in
reposets, its test suite, or the API can therefore distinguish a
correctly sealed box from one that wrote garbage; a `PATCH` that sends
the wrong ciphertext still returns 204 and reads as success. The only
construction that closes that gap is having a workflow runner decrypt the
value at the other end and report something derived from it.

**Observable end state:** the digest computed from the locally known
plaintext equals the digest a GitHub Actions runner reports after
decrypting the synced secret. Both sides read `a915c60c2f944504` when
this check was last established.

## Steps

1. Sync the `scratch` group (see the [sandbox campaign](sandbox-campaign.md)
   for activating the sandbox config), so `CAMPAIGN_MARKER` on
   `reposets-scratch` is current.

2. Dispatch the verification workflow:

   ```bash
   gh workflow run verify-secret.yml --repo spencerbeggs/reposets-scratch
   ```

3. Read the digest the runner reported from its log:

   ```bash
   gh run view <id> --repo spencerbeggs/reposets-scratch --log | grep -oE 'DIGEST=[0-9a-f]{16}'
   ```

4. Compute the same digest locally. `CAMPAIGN_MARKER` is a `value`-kind
   secret, so its plaintext sits directly in `reposets.config.toml` and
   can be hashed without anyone handling it outside the file:

   ```bash
   python3 -c "
   import tomllib, hashlib
   c = tomllib.load(open('reposets.config.toml','rb'))
   v = c['secrets']['campaign']['value']['CAMPAIGN_MARKER']
   print(hashlib.sha256(v.encode()).hexdigest()[:16])"
   ```

5. Compare the two digests. Equal means the sealed box round-tripped;
   unequal means the encryption, the public-key fetch, or the payload
   shape broke somewhere between reposets and GitHub.

## Why a digest, not the value

GitHub masks a secret's own value in workflow logs, but a hash is a
*different* string from the secret itself, so it prints unmasked and is
actually readable in the log. The workflow also fails explicitly when
the marker is empty, so "the secret is absent" is distinguishable from
"the secret is present but wrong" — a non-empty digest alone was never
sufficient, since garbage input also hashes to something non-empty.
