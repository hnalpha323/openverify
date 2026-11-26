/**
 * `@openverify/emrtd`: eMRTD chip verification on the server (plan C62). Pure: no I/O, no
 * database, no network; every signature check runs through `node:crypto`. Workflow 5B Stage 1
 * (`contracts-5b`) fixed its names and report types; `emrtd` (Stage 2) owns the package and builds
 * every function, `api-nfc` (Stage 3) calls it from the NFC job, the submit guard and the
 * trust-store sync.
 */

/** Workspace package name. */
export const PACKAGE_NAME = '@openverify/emrtd';

export * from './active-authentication.js';
export * from './errors.js';
export * from './limits.js';
export * from './oids.js';
export * from './parse.js';
export * from './passive-authentication.js';
export * from './pki.js';
export * from './self-test.js';
export * from './types.js';
