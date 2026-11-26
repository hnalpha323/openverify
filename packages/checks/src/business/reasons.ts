/**
 * The reasons each business registry and website evaluator may emit (C51.2, C61.7), in the order
 * of the C51.2 table: the shared reasons of the check's inputs, then its failures, then its
 * `not_applicable` reasons. `BUSINESS_CHECK_REASONS` in `@openverify/contracts` lists the same per
 * check; an API contract test asserts the two agree. No evaluator emits `not_implemented`.
 */
const frozen = (...reasons: string[]): readonly string[] => Object.freeze(reasons);

const PROVIDER = ['input_missing', 'execution_error', 'provider_not_configured'];

export const BUSINESS_EVALUATOR_REASONS: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    database_business_identity_comparison: frozen(
      ...PROVIDER,
      'low_confidence_match',
      'registration_number_not_found',
      'no_registry_record',
      'insufficient_data',
    ),
    database_business_active_business_detection: frozen(
      ...PROVIDER,
      'business_inactive',
      'no_registry_record',
      'status_not_available',
    ),
    database_business_associated_persons_comparison: frozen(
      ...PROVIDER,
      'associated_person_not_on_register',
      'not_requested',
      'source_has_no_persons',
      'no_registry_record',
    ),
    database_business_enabled_country_detection: frozen(
      'input_missing',
      'country_not_enabled',
      'no_allowlist',
    ),
    database_business_service_available_detection: frozen(...PROVIDER),
    business_website_resolution_detection: frozen(...PROVIDER, 'domain_not_resolving'),
    business_website_domain_age_detection: frozen(
      ...PROVIDER,
      'domain_recently_registered',
      'domain_age_unavailable',
    ),
    business_website_malicious_website_detection: frozen(
      ...PROVIDER,
      'malware',
      'phishing',
      'spam_source',
    ),
    business_website_backlink_detection: frozen(...PROVIDER, 'backlinks_below_threshold'),
  });
