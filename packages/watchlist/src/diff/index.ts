/**
 * C77.6: the diff of two publications by entry id and the content and risk-data hashes (added,
 * changed, removed, unchanged), and the C76.2 mass-removal guard. Owned by `watchlist-ingest`
 * (Workflow 6A Stage 2).
 */

/** The area this folder holds. */
export const WATCHLIST_DIFF_AREA = 'diff';

export * from './diff.js';
