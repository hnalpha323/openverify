/**
 * The report risk logic (plan C81.3, C82), built by `risk-logic` in Workflow 6A Stage 2: the email,
 * phone and address facts and their H-tier levels, and the adverse-media lexicon and relevance, each
 * a pure function the API's report types call. The package entry point re-exports this module, so
 * the owner adds its exports here (and in the subfolders) and never edits `src/index.ts`. Its data
 * lives in `packages/checks/data/reports/`.
 */

/** The area this folder holds (`risk-logic` owns it). */
export const REPORTS_CHECKS_AREA = 'reports';

export * from './constants.js';
export * from './data.js';
export * from './build-data.js';

export * from './email/index.js';
export * from './phone/index.js';
export * from './address/index.js';
export * from './media/index.js';
