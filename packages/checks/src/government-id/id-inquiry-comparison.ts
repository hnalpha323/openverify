/**
 * `id_inquiry_comparison` (R, fraud): the extraction against the inquiry's fields (C34). C149.4
 * (Workflow 9B, api-flow-carry): with the worker's `inquiryFieldSources`, the result also names, under
 * `comparison-source`, whether each compared field's value was set at creation (`initial`) or later
 * (`entered`).
 */
import type { CheckResult } from '@openverify/core';
import {
  COMPARED_ADDRESS_KEYS,
  COMPARED_NAME_KEYS,
  COMPARISON_SOURCE_METADATA_KEY,
  comparisonSourceOf,
} from '../comparison-source.js';
import { compareWithReference } from './comparison.js';
import type { GovernmentIdContext } from './context.js';

/** The inquiry keys each compared field reads (`comparison.ts`, the default account fields). */
const INQUIRY_KEYS: Readonly<Record<string, readonly string[]>> = {
  name: COMPARED_NAME_KEYS,
  birthdate: ['birthdate'],
  'identification-number': ['identification_number'],
  address: COMPARED_ADDRESS_KEYS,
};

export function idInquiryComparison(context: GovernmentIdContext): CheckResult {
  const references = context.input.references;
  const reference = references === undefined ? undefined : (references.inquiryFields ?? null);
  const result = compareWithReference(context, 'id_inquiry_comparison', reference);
  const compared = result.metadata['compared-fields'];
  if (reference === undefined || reference === null || !Array.isArray(compared)) {
    return result;
  }
  const source = comparisonSourceOf(
    compared.filter((field): field is string => typeof field === 'string'),
    (field) => INQUIRY_KEYS[field] ?? [],
    reference,
    references?.inquiryFieldSources,
  );
  return source === null
    ? result
    : { ...result, metadata: { ...result.metadata, [COMPARISON_SOURCE_METADATA_KEY]: source } };
}
