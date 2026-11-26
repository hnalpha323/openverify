/**
 * C78.2: ICAO 9303 Part 3 §6.B (Cyrillic) and §6.C (Arabic) transliteration, and any-ascii lossy
 * forms. Owned by `watchlist-matcher` (Workflow 6A Stage 2). Node's `Intl` cannot transliterate,
 * and no other transliteration package is used (`transliteration`, `unidecode`, `unidecode-plus`
 * and `text-unidecode` carry Perl or GPL data terms and are banned).
 */

/** The area this folder holds. */
export const WATCHLIST_TRANSLIT_AREA = 'translit';

export * from './scripts.js';
export * from './cyrillic.js';
export * from './arabic.js';
export * from './lossy.js';
export * from './latin.js';
