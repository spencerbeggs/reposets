---
"reposets": patch
---

## Bug Fixes

* A `[settings.*]` key that GitHub's API description does not declare is now sent on the repository PATCH instead of being dropped, so a setting GitHub ships before it is documented works without a reposets release. Because GitHub answers 200 whether or not it recognised the field, `sync` prints one `unconfirmed: GitHub does not describe this field` line per such key, which also makes a misspelled key visible during the run.
