/**
 * Contact checks (plan C55.8, C56), built by `checks-contact-crypto` in Workflow 5A Stage 2: the
 * phone and email destination rules as pure functions (libphonenumber-js `/max`, the WHATWG
 * address pattern), and the evaluators of `phone_number_otp_comparison`,
 * `email_address_otp_comparison`, `email_address_disposable_detection` and
 * `email_address_mx_detection`. The package entry point re-exports this module, so the owner
 * adds its exports here and never edits `src/index.ts`.
 */

/** The area this folder holds (`checks-contact-crypto` owns it). */
export const CONTACT_CHECKS_AREA = 'contact';

export * from './phone-destination.js';
export * from './email-destination.js';
export * from './organization-name.js';
export * from './inputs.js';
export * from './disposable-domains.js';
export * from './mail-domain.js';
export * from './context.js';
export * from './otp-comparison.js';
export * from './email-address-disposable-detection.js';
export * from './email-address-mx-detection.js';
export * from './reasons.js';
export * from './evaluators.js';
export * from './evaluate.js';
