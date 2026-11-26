/**
 * `database_business_enabled_country_detection` (R, user behaviour, required; C61.7): the business's
 * country is in the template's type-level `allowed-countries`; without the option every country is
 * allowed (`no_allowlist`, non-blocking); another country fails `country_not_enabled`.
 */
import type { CheckResult } from '@openverify/core';
import { checkResult, presentText } from '../result.js';
import type { DatabaseBusinessContext } from './context.js';

const ID = 'database_business_enabled_country_detection';

export function databaseBusinessEnabledCountryDetection(
  context: DatabaseBusinessContext,
): CheckResult {
  const allowed = context.template['allowed-countries'];
  const options =
    allowed === undefined ? {} : { thresholds: { 'allowed-countries': [...allowed] } };
  const country = presentText(context.input.values?.['country-code'])?.toUpperCase() ?? null;
  if (country === null) {
    return checkResult(ID, 'not_applicable', ['input_missing'], {}, options);
  }
  if (allowed === undefined) {
    return checkResult(ID, 'not_applicable', ['no_allowlist'], {}, options);
  }
  return allowed.includes(country)
    ? checkResult(ID, 'passed', [], {}, options)
    : checkResult(ID, 'failed', ['country_not_enabled'], {}, options);
}
