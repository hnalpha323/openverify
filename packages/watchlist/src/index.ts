/**
 * `@openverify/watchlist` (plan C77, C78): sanctions and PEP lists for reports. The record is
 * frozen here (Workflow 6A Stage 1a); each folder below has one owner, who adds its exports to its
 * own `index.ts` and never edits this file (the Phase 6 shared-file list):
 * - `watchlist-ingest`: `parsers`, `zip`, `xml`, `diff`, `pep`;
 * - `watchlist-matcher`: `names`, `translit`, `keys`, `score`, `match`, `crypto`, `reverse-index`;
 * - `fixtures-6`: `@openverify/watchlist/testing` (`src/testing/`).
 */

/** Workspace package name. */
export const PACKAGE_NAME = '@openverify/watchlist';

export * from './record/index.js';
export * from './parsers/index.js';
export * from './zip/index.js';
export * from './xml/index.js';
export * from './diff/index.js';
export * from './pep/index.js';
export * from './names/index.js';
export * from './translit/index.js';
export * from './keys/index.js';
export * from './score/index.js';
export * from './match/index.js';
export * from './crypto/index.js';
export * from './reverse-index/index.js';
// Workflow 7B Stage 1a: the list key inputs of the name kinds, filled by `list-logic`.
export * from './list-keys/index.js';
