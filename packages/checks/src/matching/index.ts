/**
 * The shared matching library (plan C58), built by `checks-matching` in Workflow 5A Stage 2:
 * match levels and three-valued match groups, names with nicknames, a libpostal-style address
 * normaliser, partial dates and business names, each over capped input. Database, AAMVA forms,
 * the document comparisons and KYB use it. The package entry point re-exports this module, so
 * the owner adds its exports here and never edits `src/index.ts`.
 */

/** The area this folder holds (`checks-matching` owns it). */
export const MATCHING_CHECKS_AREA = 'matching';

export * from './levels.js';
export * from './limits.js';
export * from './partial-dates.js';
export * from './text.js';
export * from './nicknames.js';
export * from './dictionaries.js';
export * from './names.js';
export * from './postal-codes.js';
export * from './addresses.js';
export * from './business-names.js';
export * from './identifiers.js';
