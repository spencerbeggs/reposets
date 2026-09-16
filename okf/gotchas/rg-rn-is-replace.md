---
type: Gotcha
title: "rg -rn is --replace n, not recursive with line numbers"
description: ripgrep's -r flag is --replace, not --recursive — rg -rn silently rewrites every match to the literal "n" and prints the mangled result.
stale_after: 2026-12-16T00:00:00Z
generated:
  by: okfit/claude-code
  at: 2026-09-16T15:09:19Z
  body_sha256: 69cb65709fcc0b2dbd69f67d369163b2810b396cfd9d14b9b55e38538c8e432a
tags: [dx]
---

# `rg -rn` is `--replace n`, not recursive with line numbers

## What it looks like

Muscle memory from `grep -rn` — recursive search with line numbers — carries
over to `rg -rn` expecting the same meaning. ripgrep runs, prints output that
looks like matches with line numbers, and the search appears to have worked.

## What is actually true

In ripgrep, `-r` is the short form of `--replace`, not `--recursive`
(ripgrep is recursive by default and needs no flag for it). `rg -rn PATTERN`
parses as "replace every match of `PATTERN` with the literal string `n`,"
and prints each matched line with the replacement substituted in — output
that still looks exactly like a search result, line numbers included, except
every occurrence of the pattern in it has silently become the letter `n`.
Read casually, mangled output like this is easy to mistake for confirmation
that the pattern exists in the file, when what actually happened is the
opposite of a search: a destructive-looking substitution that, because `-r`
without `-i`/`--in-place` only rewrites what is printed, never touches the
file on disk but does corrupt what a reader believes the file's contents
are.

Use `grep -rn` for recursive search with line numbers, or `rg -n` — ripgrep
does not need `-r` to search recursively.
