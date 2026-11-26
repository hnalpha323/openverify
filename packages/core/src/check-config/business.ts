/**
 * Business registry and website check config (C51.3, C61). Owned by the 5B business checks agent
 * once Workflow 5B starts; amendments to these keys are recorded in the plan.
 */
import { z } from 'zod';
import { defaultsTable, provisionalDefault } from './basis.js';
import { matchGroupsSchema, minMatchLevelSchema } from './match-groups.js';

/** The fields a business match group can name (C51.3). */
export const BUSINESS_MATCH_FIELDS = ['name', 'registration-number', 'address'] as const;

export const databaseBusinessIdentityComparisonConfigSchema = z.strictObject({
  'match-groups': matchGroupsSchema(BUSINESS_MATCH_FIELDS).optional(),
});

export const databaseBusinessActiveBusinessDetectionConfigSchema = z.strictObject({
  /** A lapsed LEI fails as inactive instead of going to review (C61.2). */
  'fail-on-lapsed-lei': z.boolean().optional(),
});

export const databaseBusinessAssociatedPersonsComparisonConfigSchema = z.strictObject({
  'min-match-level': minMatchLevelSchema.optional(),
});

export const businessWebsiteDomainAgeDetectionConfigSchema = z.strictObject({
  'min-domain-age-days': z.int().min(1).max(3650).optional(),
});

export const businessWebsiteBacklinkDetectionConfigSchema = z.strictObject({
  'min-backlinks': z.int().min(0).max(100_000).optional(),
});

/** C51.3: the business check defaults. */
export const BUSINESS_CHECK_CONFIG_DEFAULTS = defaultsTable({
  database_business_identity_comparison: {
    'match-groups': provisionalDefault(
      [
        { name: 'partial', 'registration-number': 'full' },
        { name: 'partial', address: 'partial' },
      ],
      'ours: the name with the registration number, or the name with the address; no external basis',
    ),
  },
  database_business_active_business_detection: {
    'fail-on-lapsed-lei': provisionalDefault(
      false,
      'ours (H12): a lapsed LEI is often an unpaid renewal of a live business, so it goes to review',
    ),
  },
  database_business_associated_persons_comparison: {
    'min-match-level': provisionalDefault(
      'partial',
      'ours: a partial name match with the month and year of birth; no external basis',
    ),
  },
  business_website_domain_age_detection: {
    'min-domain-age-days': provisionalDefault(90, 'ours: about a quarter; no external basis'),
  },
  business_website_backlink_detection: {
    'min-backlinks': provisionalDefault(10, 'ours: no external basis'),
  },
});
