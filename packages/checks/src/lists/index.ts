/**
 * C98.2 (Workflow 7B, owner `list-logic`): the canonical key **inputs** of the list kinds and of the
 * graph kinds of C101.2, pure, with golden vectors. `packages/checks` cannot compute a keyed HMAC:
 * `identifierKey` (`packages/db/src/blind-index.ts`) takes these inputs under the environment
 * subkey. The name and last-name kinds live in `packages/watchlist/src/list-keys/`, because the C78
 * analysis does (Phase 6 outcome 7). Addresses and ranges read `@openverify/signals/address` (never
 * `@openverify/signals/network`, which loads the MMDB reader), so a list key and a session address
 * share one canonical form.
 */

/** The area this folder holds. */
export const LISTS_AREA = 'lists';

export * from './key-input.js';
export * from './list-keys.js';
export * from './graph-keys.js';
export * from './import-tables.js';
