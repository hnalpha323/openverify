/**
 * C81.3, C81.5: the adverse-media lexicon (en, es, fr, de) and title relevance with the
 * business-name rule, as pure functions. Owned by `risk-logic` (Workflow 6A Stage 2).
 */

/** The area this folder holds. */
export const REPORT_MEDIA_CHECKS_AREA = 'reports/media';

export * from './lexicon.js';
export * from './relevance.js';
