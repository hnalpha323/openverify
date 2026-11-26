/**
 * The evaluator of every database and AAMVA check of PLAN §4.3 (C59), by verification type: a
 * function of the type's shared context. `evaluateDatabaseChecks` and `evaluateAamvaChecks` run
 * the enabled ones.
 */
import type { CheckResult } from '@openverify/core';
import { aamvaIdentificationNumberComparison } from './aamva-identification-number-comparison.js';
import { aamvaIdentityComparison } from './aamva-identity-comparison.js';
import { aamvaNameComparison } from './aamva-name-comparison.js';
import type { AamvaContext, DatabaseContext } from './context.js';
import { databaseAddressComparison } from './database-address-comparison.js';
import { databaseBirthdateComparison } from './database-birthdate-comparison.js';
import { databaseIdentityComparison } from './database-identity-comparison.js';
import { databaseInquiryComparison } from './database-inquiry-comparison.js';
import { databaseNameComparison } from './database-name-comparison.js';
import { databasePoBoxDetection } from './database-po-box-detection.js';

export type DatabaseEvaluator = (context: DatabaseContext) => CheckResult;
export type AamvaEvaluator = (context: AamvaContext) => CheckResult;

/** Every `database` check, by id. */
export const DATABASE_EVALUATORS = Object.freeze({
  database_identity_comparison: databaseIdentityComparison,
  database_name_comparison: databaseNameComparison,
  database_address_comparison: databaseAddressComparison,
  database_birthdate_comparison: databaseBirthdateComparison,
  database_inquiry_comparison: databaseInquiryComparison,
  database_po_box_detection: databasePoBoxDetection,
}) satisfies Readonly<Record<string, DatabaseEvaluator>>;

/** Every `aamva` check, by id. */
export const AAMVA_EVALUATORS = Object.freeze({
  aamva_identity_comparison: aamvaIdentityComparison,
  aamva_name_comparison: aamvaNameComparison,
  aamva_identification_number_comparison: aamvaIdentificationNumberComparison,
}) satisfies Readonly<Record<string, AamvaEvaluator>>;
