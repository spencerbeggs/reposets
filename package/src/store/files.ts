import type { AppCacheOptions, AppStoreOptions } from "@effected/app";
import { migrations } from "./migrations.js";

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

/**
 * The state database's options: what `AppStore.layer` opens and what
 * `AppStore.location` reports.
 *
 * @remarks
 * One value for both, so the path `doctor` prints and `nuke` deletes is
 * derived by the same code from the same options as the path the layer opens
 * — `AppStore.location` is that derivation, not a copy of it. The directory
 * is left to its default, `state`.
 *
 * @public
 */
export const STORE_OPTIONS = { migrations, filename: STATE_DB_FILENAME } satisfies AppStoreOptions;

/**
 * The cache database's options, for `AppCache.layer` and `AppCache.location`,
 * for the same reason as {@link STORE_OPTIONS}. The directory is left to its
 * default, `cache`.
 *
 * @public
 */
export const CACHE_OPTIONS = { filename: CACHE_DB_FILENAME } satisfies AppCacheOptions;
