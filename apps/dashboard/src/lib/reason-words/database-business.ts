/**
 * C51.2, C61.1, C61.2, C61.7, C66: the reason codes of the `verification/database-business`
 * checks in words, for operators. Every reason of a check's C51.2 row is worded here, the
 * service-available check's `provider_not_configured` and `execution_error` included: a register
 * covers some countries only (C61.1). A miss is never fraud: a number the authoritative register
 * lacks, or a business no register holds, goes to review (V14).
 */
import type { ReasonWords } from './types';

export const DATABASE_BUSINESS_REASON_WORDS: ReasonWords = Object.freeze({
  // database_business_identity_comparison (C58.1, C61.7).
  low_confidence_match: {
    words: 'Register’s record does not match',
    explanation:
      'Every configured match group was unmet: the name, number or address differs from the register’s record.',
  },
  registration_number_not_found: {
    words: 'Number not on the register',
    explanation:
      'The authoritative register has no business under this number; a mistyped number goes to review, not to a failure.',
  },
  no_registry_record: {
    words: 'No register holds the business',
    explanation:
      'No bound register found it; sole traders, partnerships and businesses without an LEI are often on none, so a reviewer decides.',
  },
  insufficient_data: {
    words: 'Not enough data to decide',
    explanation:
      'No match group was met and not every group was unmet: a field a group needs is missing on one side.',
  },
  // database_business_active_business_detection (C61.2).
  business_inactive: {
    words: 'Business not active',
    explanation:
      'The register lists the business as dissolved, closed, in liquidation or otherwise inactive.',
  },
  status_not_available: {
    words: 'Status not available',
    explanation:
      'The register gave no status this check can map, such as a lapsed LEI or any SEC EDGAR record, so a reviewer decides.',
  },
  // database_business_associated_persons_comparison (C61.7).
  associated_person_not_on_register: {
    words: 'Person not on the register',
    explanation:
      'A person entered matches no active officer or person with significant control by name and month of birth.',
  },
  not_requested: {
    words: 'Persons not collected by the step',
    explanation: 'The step does not collect associated persons, so the check does not count.',
  },
  source_has_no_persons: {
    words: 'Register lists no persons',
    explanation:
      'The register that found the business publishes no officers or persons with significant control, as GLEIF and SEC EDGAR do not.',
  },
  // database_business_enabled_country_detection.
  country_not_enabled: {
    words: 'Country not allowed',
    explanation: 'The business’s country is outside the template’s allowed countries.',
  },
  no_allowlist: {
    words: 'No country allowlist set',
    explanation: 'The template sets no allowed countries, so the check does not count.',
  },
  // database_business_service_available_detection, and any register check without an answer.
  provider_not_configured: {
    words: 'No register bound for the country',
    explanation:
      'No business register is bound in this environment, or none of those bound covers the business’s country.',
  },
  execution_error: {
    words: 'Could not ask the register',
    explanation:
      'A register failed or timed out after the job’s retries and no other answered, so a reviewer decides.',
  },
});
