/**
 * C79.3: crypto address canonicalisation from the C57 validators and the format table, tickers as metadata.
 * Owned by `watchlist-matcher` (Workflow 6A Stage 2).
 */
/** The area this folder holds. */
export const WATCHLIST_CRYPTO_AREA = 'crypto';

/** The version of the canonicalisation rules; `keysVersion` joins it (V04). */
export const CRYPTO_NORMALISER_VERSION = 'crypto-1';

export * from './canonical.js';
