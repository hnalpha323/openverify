/**
 * C77.2: our single-member ZIP reader over `node:zlib` `inflateRaw`, with its size and entry
 * guards. Owned by `watchlist-ingest` (Workflow 6A Stage 2).
 */

/** The area this folder holds. */
export const WATCHLIST_ZIP_AREA = 'zip';

export * from './reader.js';
