# Gotcha

* ["unchanged" means the file already matches, not that the schema did not change](schemastore-unchanged-means-file-matches.md) - schemastore build/check report unchanged by content comparison, which is easy to misread as a no-op schema edit.
* [A Layer memoizes per provide, not by const identity](layer-memoizes-per-provide.md) - Two separate Effect.provide calls over the same layer value are two separate builds — for App.layerTest, two separate in-memory databases.
* [A prepared-but-unrun fixture request still reads as sent](layer-fixture-records-on-invocation.md) - GitHubClient.layerFixture records a call when the request function is invoked, not when the effect it returns is run — a built-but-unexecuted delete looks like it happened.
* [An unrecognised settings field reports as applied](unknown-settings-fields-report-as-applied.md) - A misspelled or unsupported settings field decodes cleanly, gets PATCHed, is silently ignored by GitHub, and the run still reports it as applied.
* [GitHub's own CodeQL workflow satisfies the check it should fail](synthetic-codeql-workflow.md) - Configuring CodeQL default setup makes GitHub add a synthetic workflow that persists after the setup is removed, and would otherwise make the actions language look satisfiable on a repository with no workflow files
* [NUL bytes hide from grep](nul-bytes-hide-from-grep.md) - A composite-key separator that is a literal NUL byte makes plain grep report a clean, silent no-match against files that do contain what you searched for
* [Running the test suite rewrites the published JSON schemas](test-run-rewrites-schemas.md) - pnpm run test regenerates package/schemas/\*.json unformatted, which then fails lint until lint:fix runs.
* [pnpm exec reposets runs the dev build, not prod](pnpm-exec-runs-the-dev-build.md) - node\_modules/reposets links to the dev build, so a source change is invisible until build:dev reruns.
* [rg -rn is --replace n, not recursive with line numbers](rg-rn-is-replace.md) - ripgrep's -r flag is --replace, not --recursive — rg -rn silently rewrites every match to the literal "n" and prints the mangled result.
