/**
 * The evaluator of every business registry and business website check of PLAN §4.3 (C61.7), by
 * verification type: a function of the type's shared context.
 */
import type { CheckResult } from '@openverify/core';
import { businessWebsiteBacklinkDetection } from './business-website-backlink-detection.js';
import { businessWebsiteDomainAgeDetection } from './business-website-domain-age-detection.js';
import { businessWebsiteMaliciousWebsiteDetection } from './business-website-malicious-website-detection.js';
import { businessWebsiteResolutionDetection } from './business-website-resolution-detection.js';
import type { BusinessWebsiteContext, DatabaseBusinessContext } from './context.js';
import { databaseBusinessActiveBusinessDetection } from './database-business-active-business-detection.js';
import { databaseBusinessAssociatedPersonsComparison } from './database-business-associated-persons-comparison.js';
import { databaseBusinessEnabledCountryDetection } from './database-business-enabled-country-detection.js';
import { databaseBusinessIdentityComparison } from './database-business-identity-comparison.js';
import { databaseBusinessServiceAvailableDetection } from './database-business-service-available-detection.js';

export type DatabaseBusinessEvaluator = (context: DatabaseBusinessContext) => CheckResult;
export type BusinessWebsiteEvaluator = (context: BusinessWebsiteContext) => CheckResult;

/** Every `database_business` check, by id. */
export const DATABASE_BUSINESS_EVALUATORS = Object.freeze({
  database_business_identity_comparison: databaseBusinessIdentityComparison,
  database_business_active_business_detection: databaseBusinessActiveBusinessDetection,
  database_business_associated_persons_comparison: databaseBusinessAssociatedPersonsComparison,
  database_business_enabled_country_detection: databaseBusinessEnabledCountryDetection,
  database_business_service_available_detection: databaseBusinessServiceAvailableDetection,
}) satisfies Readonly<Record<string, DatabaseBusinessEvaluator>>;

/** Every `business_website` check, by id. */
export const BUSINESS_WEBSITE_EVALUATORS = Object.freeze({
  business_website_resolution_detection: businessWebsiteResolutionDetection,
  business_website_domain_age_detection: businessWebsiteDomainAgeDetection,
  business_website_malicious_website_detection: businessWebsiteMaliciousWebsiteDetection,
  business_website_backlink_detection: businessWebsiteBacklinkDetection,
}) satisfies Readonly<Record<string, BusinessWebsiteEvaluator>>;
