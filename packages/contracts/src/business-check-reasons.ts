/**
 * The reason codes of the business registry and business website checks (C51.2, C61). The 5B
 * business checks agent owns this file from 5B Stage 2 and may add fraud reasons only, recorded
 * as plan amendments; the user-behaviour failure reasons are frozen.
 */
import type { CheckId } from '@openverify/core';
import { checkReasonsOf, outcome, type CheckOutcomeTable } from './check-outcome-reasons.js';

export const BUSINESS_CHECK_IDS = Object.freeze([
  'database_business_identity_comparison',
  'database_business_active_business_detection',
  'database_business_associated_persons_comparison',
  'database_business_enabled_country_detection',
  'database_business_service_available_detection',
  'business_website_resolution_detection',
  'business_website_domain_age_detection',
  'business_website_malicious_website_detection',
  'business_website_backlink_detection',
] as const satisfies readonly CheckId[]);

export type BusinessCheckId = (typeof BUSINESS_CHECK_IDS)[number];

export const BUSINESS_CHECK_OUTCOMES: CheckOutcomeTable<BusinessCheckId> = Object.freeze({
  // `registration_number_not_found`: a number the authoritative register lacks goes to review
  // (V14): a one-digit slip is not fraud.
  database_business_identity_comparison: outcome(
    ['low_confidence_match'],
    ['registration_number_not_found', 'no_registry_record', 'insufficient_data'],
  ),
  database_business_active_business_detection: outcome(
    ['business_inactive'],
    ['no_registry_record', 'status_not_available'],
  ),
  database_business_associated_persons_comparison: outcome(
    ['associated_person_not_on_register'],
    ['not_requested', 'source_has_no_persons', 'no_registry_record'],
  ),
  database_business_enabled_country_detection: outcome(['country_not_enabled'], ['no_allowlist']),
  database_business_service_available_detection: outcome(
    [],
    ['provider_not_configured', 'execution_error'],
  ),
  business_website_resolution_detection: outcome(['domain_not_resolving'], ['execution_error']),
  business_website_domain_age_detection: outcome(
    ['domain_recently_registered'],
    ['domain_age_unavailable'],
  ),
  // `provider_not_configured` also for an empty feed list; `execution_error` for a stale feed.
  business_website_malicious_website_detection: outcome(
    ['malware', 'phishing', 'spam_source'],
    ['provider_not_configured', 'execution_error'],
  ),
  business_website_backlink_detection: outcome(['backlinks_below_threshold']),
});

export const BUSINESS_CHECK_REASONS = checkReasonsOf(BUSINESS_CHECK_OUTCOMES);
