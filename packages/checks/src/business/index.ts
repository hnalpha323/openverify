/**
 * Business registry and business website checks (plan C61.7), built by `checks-5b` in Workflow 5B
 * Stage 2: the identity comparison over the C58 business-name and address matchers and the
 * three-valued match groups, the active-business status mapping of C61.2, associated persons by
 * name and month-year of birth, the enabled country, service availability, domain resolution,
 * domain age, malicious website and backlinks. The package entry point re-exports this module,
 * so the owner adds its exports here and never edits `src/index.ts`.
 */

/** The area this folder holds (`checks-5b` owns it). */
export const BUSINESS_CHECKS_AREA = 'business';

export * from './inputs.js';
export * from './status.js';
export * from './website.js';
export * from './context.js';
export * from './database-business-identity-comparison.js';
export * from './database-business-active-business-detection.js';
export * from './database-business-associated-persons-comparison.js';
export * from './database-business-enabled-country-detection.js';
export * from './database-business-service-available-detection.js';
export * from './business-website-resolution-detection.js';
export * from './business-website-domain-age-detection.js';
export * from './business-website-malicious-website-detection.js';
export * from './business-website-backlink-detection.js';
export * from './reasons.js';
export * from './evaluators.js';
export * from './evaluate.js';
