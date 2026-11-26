/**
 * The evaluator of every document check of PLAN §4.3 (C60.6): a function of the shared context.
 * `evaluateDocumentChecks` runs the enabled ones.
 */
import type { CheckResult } from '@openverify/core';
import type { DocumentContext } from './context.js';
import { documentAddressComparison } from './document-address-comparison.js';
import { documentExpiredDetection } from './document-expired-detection.js';
import { documentExtractedPropertiesDetection } from './document-extracted-properties-detection.js';
import { documentFabricationDetection } from './document-fabrication-detection.js';
import { documentNameComparison } from './document-name-comparison.js';
import { documentRecencyDetection } from './document-recency-detection.js';
import { documentTypeDetection } from './document-type-detection.js';

export type DocumentEvaluator = (context: DocumentContext) => CheckResult;

/** Every `document` check, by id. */
export const DOCUMENT_EVALUATORS = Object.freeze({
  document_type_detection: documentTypeDetection,
  document_extracted_properties_detection: documentExtractedPropertiesDetection,
  document_expired_detection: documentExpiredDetection,
  document_recency_detection: documentRecencyDetection,
  document_fabrication_detection: documentFabricationDetection,
  document_name_comparison: documentNameComparison,
  document_address_comparison: documentAddressComparison,
}) satisfies Readonly<Record<string, DocumentEvaluator>>;
