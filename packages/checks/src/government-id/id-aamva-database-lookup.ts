/**
 * `id_aamva_database_lookup` (A, fraud): a US driver licence's data against the AAMVA DLDV
 * service, through a provider adapter (C35). Phase 3 ships the port and a deterministic sandbox
 * provider, no real adapter.
 * - An established document that is not a US AAMVA card has nothing to look up: `feature_absent`.
 * - No provider: `provider_not_configured`; a failed one: `execution_error`.
 * - The provider's answer: `match` passes, `no_match` fails (`aamva_record_mismatch`, the fields
 *   named), `not_found` fails (`aamva_record_not_found`). No number to look up: `input_missing`.
 * - C59.4 (a C35 amendment): a jurisdiction that does not take part in DLDV answers
 *   `not_applicable` with `aamva_jurisdiction_not_participating`, which blocks (review).
 */
import type { CheckResult } from '@openverify/core';
import { checkResult } from '../result.js';
import type { GovernmentIdContext } from './context.js';
import { isCheckResult, providerResult } from './provider.js';

const CHECK_ID = 'id_aamva_database_lookup';

export function idAamvaDatabaseLookup(context: GovernmentIdContext): CheckResult {
  const { features, extraction } = context;
  const usCard = features?.row === 'aamva-card' && extraction.document.issuer?.country === 'US';
  if (features !== null && !usCard) {
    return checkResult(CHECK_ID, 'not_applicable', ['feature_absent']);
  }
  const outcome = providerResult(CHECK_ID, context.input.providers?.aamva);
  if (isCheckResult(outcome)) {
    return outcome;
  }
  const options = { provider: outcome.provider };
  if (extraction.consolidated.fields['identification-number'] === null) {
    return checkResult(CHECK_ID, 'not_applicable', ['input_missing'], {}, options);
  }
  const { result } = outcome;
  switch (result.outcome) {
    case 'match':
      return checkResult(CHECK_ID, 'passed', [], {}, options);
    case 'no_match':
      return checkResult(
        CHECK_ID,
        'failed',
        ['aamva_record_mismatch'],
        { 'mismatched-fields': [...(result.mismatchedFields ?? [])] },
        options,
      );
    case 'not_found':
      return checkResult(CHECK_ID, 'failed', ['aamva_record_not_found'], {}, options);
    case 'jurisdiction_not_participating':
      // C59.4: the record cannot be looked up there; no evidence, so review (blocking).
      return checkResult(
        CHECK_ID,
        'not_applicable',
        ['aamva_jurisdiction_not_participating'],
        {},
        options,
      );
  }
}
