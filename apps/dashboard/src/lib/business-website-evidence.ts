/**
 * C61.3–C61.5, C66: what a `verification/business-website` answer records, shaped for its
 * evidence: the resolution and how it was read, the domain's registration day and age against the
 * minimum, the malicious-website listings and the backlinks. Read from the verification answer
 * alone (C53.7). The results record counts, routes, flags and public dates only, never an address
 * (C51.4), so nothing here is personal data; the URL and host are attributes, which the API masks.
 */
import type { VerificationCheck, VerificationResource } from '@openverify/contracts';
import {
  checkOutcomeOf,
  resultOf,
  sourceOf,
  textListOf,
  type CheckOutcome,
  type EvidenceSource,
} from './database-evidence';

export type BusinessWebsiteVerification = Extract<
  VerificationResource,
  { type: 'verification/business-website' }
>;

/** One website check's result, its provider, and what its metadata counts. */
export interface WebsiteCheckEvidence {
  readonly outcome: CheckOutcome | null;
  readonly provider: EvidenceSource | null;
}

export interface ResolutionEvidence extends WebsiteCheckEvidence {
  readonly route: string | null;
  readonly addresses: number | null;
  readonly publicAddresses: number | null;
}

export interface DomainAgeEvidence extends WebsiteCheckEvidence {
  /** The registration day the check read (`registered-at`, `YYYY-MM-DD`). */
  readonly registeredAt: string | null;
  readonly ageDays: number | null;
  /** `min-domain-age-days`. */
  readonly minimumDays: number | null;
  readonly flags: readonly string[];
}

export interface ListingEvidence extends WebsiteCheckEvidence {
  readonly feeds: number | null;
}

export interface BacklinkEvidence extends WebsiteCheckEvidence {
  readonly count: number | null;
  readonly threshold: number | null;
}

export interface BusinessWebsiteEvidenceData {
  /** Whether any check has a result yet. */
  readonly ran: boolean;
  readonly resolution: ResolutionEvidence;
  readonly domainAge: DomainAgeEvidence;
  readonly listings: ListingEvidence;
  readonly backlinks: BacklinkEvidence;
}

type Readable = Readonly<Record<string, unknown>>;

const numberOf = (record: Readable, key: string): number | null => {
  const value = record[key];
  return typeof value === 'number' ? value : null;
};

const textOf = (record: Readable, key: string): string | null => {
  const value = record[key];
  return typeof value === 'string' ? value : null;
};

/** A result's outcome and provider, and its metadata to read the rest from. */
function evidenceOf(check: VerificationCheck | undefined) {
  return {
    outcome: checkOutcomeOf(check),
    provider: sourceOf([check]),
    metadata: check?.metadata ?? {},
    thresholds: check?.provenance?.thresholds ?? {},
  };
}

/** A business website verification's evidence. */
export function businessWebsiteEvidenceOf(
  verification: BusinessWebsiteVerification,
): BusinessWebsiteEvidenceData {
  const { checks } = verification.attributes;
  const resolution = evidenceOf(resultOf(checks, 'business_website_resolution_detection'));
  const age = evidenceOf(resultOf(checks, 'business_website_domain_age_detection'));
  const listings = evidenceOf(resultOf(checks, 'business_website_malicious_website_detection'));
  const backlinks = evidenceOf(resultOf(checks, 'business_website_backlink_detection'));
  return {
    ran: checks.length > 0,
    resolution: {
      outcome: resolution.outcome,
      provider: resolution.provider,
      route: textOf(resolution.metadata, 'route'),
      addresses: numberOf(resolution.metadata, 'address-count'),
      publicAddresses: numberOf(resolution.metadata, 'public-address-count'),
    },
    domainAge: {
      outcome: age.outcome,
      provider: age.provider,
      registeredAt: textOf(age.metadata, 'registered-at'),
      ageDays: numberOf(age.metadata, 'age-days'),
      minimumDays: numberOf(age.thresholds, 'min-domain-age-days'),
      flags: textListOf(age.metadata, 'flags'),
    },
    listings: {
      outcome: listings.outcome,
      provider: listings.provider,
      feeds: numberOf(listings.metadata, 'feed-count'),
    },
    backlinks: {
      outcome: backlinks.outcome,
      provider: backlinks.provider,
      count: numberOf(backlinks.metadata, 'backlink-count'),
      threshold: numberOf(backlinks.metadata, 'backlink-threshold'),
    },
  };
}
