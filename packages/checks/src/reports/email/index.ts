/**
 * C82.1: the email address facts and the reputation band (the authored free-mail, relay, role and
 * MX-provider tables, SPF and DMARC parsing, the typo suggestion, the band table), as pure
 * functions. Owned by `risk-logic` (Workflow 6A Stage 2).
 */

/** The area this folder holds. */
export const REPORT_EMAIL_CHECKS_AREA = 'reports/email';

export * from './tables.js';
export * from './spf.js';
export * from './dmarc.js';
export * from './domain.js';
export * from './report.js';
