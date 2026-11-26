import type { CheckResult } from '@openverify/core';
import { z } from 'zod';
import { normalizeCountryCode } from './country-codes.js';
import { checkResult, parseCheckConfig, presentText } from './result.js';

const CHECK_ID = 'id_disallowed_country_detection';

const countryList = z
  .array(z.string())
  .min(1)
  .transform((codes, ctx) =>
    codes.map((code, index) => {
      const normalized = normalizeCountryCode(code);
      if (normalized === null) {
        ctx.addIssue({ code: 'custom', message: 'not a country code', path: [index] });
      }
      return normalized ?? code;
    }),
  );

/**
 * Internal options. Templates set the verification type's `allowed-countries` (C11), or the flow
 * step its `allowedCountries`; the evaluator passes whichever applies (C29.5).
 */
export const idDisallowedCountryOptionsSchema = z.strictObject({
  /** ISO alpha-2 or alpha-3 codes; when set, only these countries pass. */
  allowedCountries: countryList.optional(),
  /** ISO alpha-2 or alpha-3 codes that always fail. */
  disallowedCountries: countryList.optional(),
});
export type IdDisallowedCountryOptions = z.input<typeof idDisallowedCountryOptionsSchema>;

export interface IdDisallowedCountryInput {
  /** Issuing country as ISO alpha-2/alpha-3 or an ICAO MRZ code. */
  issuingCountry?: string | null | undefined;
  /** Whether the document itself established it (C30.2); defaults to true when given. */
  established?: boolean | undefined;
}

/**
 * `id_disallowed_country_detection`: the issuing country must be on the allowlist (if set) and
 * not on the denylist (if set). Codes are compared as three-letter codes, so `US`, `usa` and
 * `USA` are the same country and the MRZ code `D` is Germany. Without a policy an established
 * country passes (C29.6); a country the document did not establish, or no country at all, leaves
 * the check without evidence (`input_missing`). An issuer without an alpha-2 code, such as the
 * sandbox test issuer Utopia, passes without a policy and fails any allowlist (C30.7). The
 * country itself stays out of the metadata (C29.3).
 */
export function idDisallowedCountryDetection(
  input: IdDisallowedCountryInput,
  options: IdDisallowedCountryOptions,
): CheckResult {
  const { allowedCountries, disallowedCountries } = parseCheckConfig(
    CHECK_ID,
    idDisallowedCountryOptionsSchema,
    options,
  );
  const thresholds = {
    ...(options.allowedCountries === undefined
      ? {}
      : { 'allowed-countries': [...options.allowedCountries] }),
    ...(options.disallowedCountries === undefined
      ? {}
      : { 'disallowed-countries': [...options.disallowedCountries] }),
  };
  const raw = presentText(input.issuingCountry);
  const issuingCountry = raw === null ? null : normalizeCountryCode(raw);
  if (input.established === false || issuingCountry === null) {
    return checkResult(CHECK_ID, 'not_applicable', ['input_missing'], {}, { thresholds });
  }
  const reasons: string[] = [];
  if (allowedCountries && !allowedCountries.includes(issuingCountry)) {
    reasons.push('issuing_country_not_allowed');
  }
  if (disallowedCountries?.includes(issuingCountry)) {
    reasons.push('issuing_country_disallowed');
  }
  return checkResult(
    CHECK_ID,
    reasons.length > 0 ? 'failed' : 'passed',
    reasons,
    {},
    { thresholds },
  );
}
