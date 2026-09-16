# Limitation

* [A renamed ruleset creates a second one](renamed-ruleset-creates-a-second-one.md) - Renaming a ruleset in config creates an orphan on GitHub instead of renaming the original.
* [A settings dry run reports the request, not the write](settings-dry-run-is-approximate.md) - A dry run of the settings phase reports the fields the config would send; only a real run reports the fields @effected/github's applySettings actually sent.
* [Drift fidelity differs by resource](drift-fidelity-differs-by-resource.md) - Settings, variables and environments compare live values; secrets and rulesets compare only presence, for different reasons
* [Repository subsystems reposets does not manage](subsystems-reposets-does-not-manage.md) - A table of repository-level GitHub subsystems a declarative tool could own that reposets has no config shape for, and what each would take upstream.
* [Token scopes cannot be verified](token-scopes-cannot-be-verified.md) - doctor prints the required permission list as a requirement, never as a verification, because GitHub does not expose a fine-grained PAT's own scopes
