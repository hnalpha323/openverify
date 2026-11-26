/**
 * C77.2: the guarded saxes reader shared by the parsers: no DOCTYPE, the five predefined entities
 * only, depth, node, attribute and capture caps, a total byte cap, and UTF-8 only. Owned by
 * `watchlist-ingest` (Workflow 6A Stage 2).
 */

/** The area this folder holds. */
export const WATCHLIST_XML_AREA = 'xml';

export * from './reader.js';
