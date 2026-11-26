/**
 * Document and proof-of-address checks (plan C60.5, C60.6), built by `checks-5b` in Workflow 5B
 * Stage 2: visible-text-first classification with the per-class lexicons (en, es, fr, de), the
 * layout features and the fixed provisional softmax, extraction of the issue date, printed
 * expiry, issuer, name and address, the cascade, recency per class, the expiry feature table,
 * `FABRICATION_SIGNALS` with the weak-cue cap, and the name and address comparisons through the
 * C58 matching library. The package entry point re-exports this module, so the owner adds its
 * exports here and never edits `src/index.ts`.
 */

/** The area this folder holds (`checks-5b` owns it). */
export const DOCUMENT_CHECKS_AREA = 'document';

export * from './inputs.js';
export * from './text.js';
export * from './lexicons/index.js';
export * from './lines.js';
export * from './language.js';
export * from './layout.js';
export * from './classify.js';
export * from './dates.js';
export * from './extract.js';
export * from './feature-table.js';
export * from './fabrication.js';
export * from './context.js';
export * from './document-type-detection.js';
export * from './document-extracted-properties-detection.js';
export * from './document-expired-detection.js';
export * from './document-recency-detection.js';
export * from './document-fabrication-detection.js';
export * from './document-name-comparison.js';
export * from './document-address-comparison.js';
export * from './reasons.js';
export * from './evaluators.js';
export * from './evaluate.js';
