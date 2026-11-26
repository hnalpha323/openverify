/**
 * C80.2-C80.4: the PEP position classes, the Wikidata SPARQL queries and result reader, open-ended
 * tenures, relatives with their install flag and age rule, and retention. Owned by
 * `watchlist-ingest` (Workflow 6A Stage 2).
 */

/** The area this folder holds. */
export const WATCHLIST_PEP_AREA = 'pep';

export * from './positions.js';
export * from './sparql.js';
export * from './rules.js';
export * from './build.js';
export * from './import.js';
