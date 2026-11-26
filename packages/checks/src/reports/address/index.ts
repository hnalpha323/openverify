/**
 * C82.3: the address checks (postcode validity, US ZIP-to-state consistency, PO box, APO/FPO/DPO
 * and PMB designators, the CMRA hint), as pure functions. Owned by `risk-logic` (Workflow 6A
 * Stage 2).
 */

/** The area this folder holds. */
export const REPORT_ADDRESS_CHECKS_AREA = 'reports/address';

export * from './us-zip.js';
export * from './report.js';
