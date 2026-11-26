/**
 * Government ID chip checks (plan C62.3, C62.4, C62.6), built by `emrtd` in Workflow 5B Stage 2:
 * the evaluators of the `id_nfc_*` checks over the `@openverify/emrtd` reports (passive
 * authentication with integrity apart from revocation, the data-group checks on integrity, chip
 * authentication over the server nonce, the MRZ and selfie bindings, repeat detection and
 * expiry). The package entry point re-exports this module, so the owner adds its exports here and
 * never edits `src/index.ts`.
 */

/** The area this folder holds (`emrtd` owns it). */
export const NFC_CHECKS_AREA = 'nfc';

export * from './inputs.js';
export * from './integrity.js';
export * from './config.js';
export * from './issuer-country.js';
export * from './chip-fields.js';
export * from './context.js';
export * from './id-nfc-passive-authentication-detection.js';
export * from './id-nfc-chip-authentication-detection.js';
export * from './id-nfc-mrz-comparison.js';
export * from './id-nfc-selfie-comparison.js';
export * from './id-nfc-repeat-detection.js';
export * from './nfc-expired-detection.js';
export * from './reasons.js';
export * from './evaluators.js';
export * from './evaluate.js';
