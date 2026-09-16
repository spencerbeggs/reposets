# Incident

* [The dangling-reference check was dropped and nothing replaced it](dangling-reference-check-dropped.md) - The v4 rebuild dropped the loader-level cross-reference check; a misspelled section name synced nothing, reported nothing, and validate printed Valid.
* [has\_discussions shipped inert since v3](has-discussions-shipped-inert.md) - SettingsGroupSchema typed has\_discussions but PATCH /repos never accepted it, so every run reported it applied while the repository never changed.
