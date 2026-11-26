/**
 * What the AAMVA checks share (C59.4, C59.5): the inputs DLDV needs, the provider's verdict, and
 * the mismatched field names it gives (C31.5 names only, at most 20, anything else dropped).
 */
import type { CheckId, CheckProvider, CheckResult } from '@openverify/core';
import type { AamvaLookupResult } from '../government-id/inputs.js';
import { checkResult, presentText, type CheckResultOptions } from '../result.js';
import type { AamvaContext } from './context.js';
import type { AamvaValueName } from './inputs.js';
import { providerAnswer } from './provider.js';

const FIELD_NAME = /^[a-z][a-z0-9-]{0,63}$/;
const MAX_FIELDS = 20;

/** The verdict, or the result that stands in for it (inputs or provider missing). */
export function aamvaVerdict(
  context: AamvaContext,
  checkId: CheckId,
  needed: readonly AamvaValueName[],
  options: CheckResultOptions,
): { readonly provider: CheckProvider; readonly result: AamvaLookupResult } | CheckResult {
  const { values } = context.input;
  if (values === null || needed.some((name) => presentText(values[name]) === null)) {
    return checkResult(checkId, 'not_applicable', ['input_missing'], {}, options);
  }
  return providerAnswer(checkId, context.input.providers?.aamva, options);
}

/** The mismatched field names a no-match gives, cleaned; `null` when it gives none. */
export function mismatchedFieldsOf(result: AamvaLookupResult): readonly string[] | null {
  const fields = (result.mismatchedFields ?? [])
    .filter((field) => FIELD_NAME.test(field))
    .slice(0, MAX_FIELDS);
  return fields.length === 0 ? null : [...new Set(fields)];
}
