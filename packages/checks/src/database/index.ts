/**
 * Database and AAMVA checks (plan C59), built by `checks-matching` in Workflow 5A Stage 2: the
 * evaluators of the `database_*` and `aamva_*` checks on the C58 matching library. The package
 * entry point re-exports this module, so the owner adds its exports here and never edits
 * `src/index.ts`.
 */

/** The area this folder holds (`checks-matching` owns it). */
export const DATABASE_CHECKS_AREA = 'database';

export * from './inputs.js';
export * from './context.js';
export * from './provider.js';
export * from './field-comparison.js';
export * from './aamva-verdict.js';
export * from './database-identity-comparison.js';
export * from './database-name-comparison.js';
export * from './database-address-comparison.js';
export * from './database-birthdate-comparison.js';
export * from './database-inquiry-comparison.js';
export * from './database-po-box-detection.js';
export * from './aamva-identity-comparison.js';
export * from './aamva-name-comparison.js';
export * from './aamva-identification-number-comparison.js';
export * from './reasons.js';
export * from './evaluators.js';
export * from './evaluate.js';
