/**
 * The state database's file name, under the XDG state directory.
 *
 * @remarks
 * Passed explicitly to `AppStore.layer` rather than left to its default, so
 * the name the database is opened under and the name `nuke` and `doctor` look
 * for are one constant and cannot drift apart.
 *
 * @public
 */
export const STATE_DB_FILENAME = "store.db";

/**
 * The cache database's file name, under the XDG cache directory.
 *
 * @remarks
 * Passed explicitly to `AppCache.layer` for the same reason as
 * {@link STATE_DB_FILENAME}.
 *
 * @public
 */
export const CACHE_DB_FILENAME = "cache.db";
