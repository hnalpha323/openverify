/**
 * C51.2, C59.4, C59.5, C66: the reason codes of the `verification/aamva` checks in words, for
 * operators. The record is the issuing jurisdiction's, read through AAMVA's Driver's License Data
 * Verification service (DLDV), so its words differ from a database source's. `execution_error`
 * and `provider_not_configured` keep their shared words (`check-reasons.ts`).
 */
import type { ReasonWords } from './types';

export const AAMVA_REASON_WORDS: ReasonWords = Object.freeze({
  record_mismatch: {
    words: 'Issuer’s record differs',
    explanation:
      'The issuing jurisdiction’s record disagrees on a field outside the ignored fields; the evidence names the fields.',
  },
  record_not_found: {
    words: 'No record at the issuer',
    explanation: 'The issuing jurisdiction holds no license or ID card with this number.',
  },
  jurisdiction_not_participating: {
    words: 'Jurisdiction not in the AAMVA lookup',
    explanation:
      'The issuing state or territory does not answer DLDV lookups, so a reviewer decides or, as configured, the step is skipped.',
  },
  name_mismatch: { words: 'Name differs from the issuer’s record' },
  identification_number_mismatch: { words: 'Number differs from the issuer’s record' },
  input_missing: {
    words: 'A value the lookup needs is missing',
    explanation:
      'DLDV needs the first and last names, the birth date, the number and the issuing authority; one was not entered or copied.',
  },
});
