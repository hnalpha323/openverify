/**
 * What the business registry and business website evaluators read (C52.3, C61). The worker passes
 * the entered values as the inputs body names them (decrypted, PII, never logged), each bound
 * registry's answer in the C61.1 order of asking (the national register for the country, then
 * GLEIF; or the sandbox register alone), and the website's resolution, domain age, feed listing
 * and backlink count, each a {@link ProviderOutcome}. The registry types mirror the API's
 * `BusinessRegistryLookupResult` (`apps/api/src/ports.ts`), so a provider's answer is passed as
 * it arrives. An evaluator whose evidence is absent answers `input_missing` or
 * `provider_not_configured`, never `passed`.
 */
import type { EnvironmentKind } from '../data/feature-table.js';
import type { ProviderOutcome } from '../government-id/inputs.js';

/** The registers a `businessRegistry` binding may name, and the sandbox (C61.1). */
export type BusinessRegistrySourceName = 'gleif' | 'companies-house' | 'sec-edgar' | 'sandbox';

/** An officer or person with significant control (C61.7). Personal data: never cached. */
export interface BusinessPersonRecord {
  readonly name: string;
  /** `YYYY-MM`, the only part of a birth date the register publishes; `null` when none. */
  readonly birthMonth: string | null;
  readonly role: 'officer' | 'psc';
  /** Still in post (not resigned, not ceased). */
  readonly active: boolean;
}

/** A register's record of the business (C61.1). */
export interface BusinessRegistryRecord {
  readonly source: BusinessRegistrySourceName;
  readonly recordId: string;
  readonly legalName: string;
  /** Previous, trading and transliterated names. */
  readonly otherNames: readonly string[];
  /**
   * The source's own status value: GLEIF's registration status (`ISSUED`, `LAPSED` ...),
   * Companies House's `company_status`, `null` when the source has none (EDGAR).
   */
  readonly status: string | null;
  /**
   * GLEIF: `entity.status` (`ACTIVE`, `INACTIVE`; an entity expiration reads `INACTIVE`).
   * Companies House: `company_status_detail` (`active-proposal-to-strike-off`).
   */
  readonly statusDetail?: string | null | undefined;
  readonly registeredAddress?:
    | {
        readonly lines: readonly string[];
        readonly city: string | null;
        /** ISO 3166-2 (`US-CA`) or the register's own region. */
        readonly region: string | null;
        readonly postalCode: string | null;
        /** ISO 3166-1 alpha-2. */
        readonly country: string | null;
      }
    | null
    | undefined;
  readonly jurisdiction?: string | null | undefined;
  readonly registrationNumber?: string | null | undefined;
  /** Officers and PSCs, when the source publishes them. */
  readonly persons?: readonly BusinessPersonRecord[] | undefined;
}

/** A register's answer. `authoritative`: a miss there means the business is not on it. */
export type BusinessRegistryLookup =
  | {
      readonly outcome: 'found';
      readonly record: BusinessRegistryRecord;
      readonly authoritative: boolean;
      /** Whether the source publishes officers or PSCs (`source_has_no_persons` otherwise). */
      readonly personsAvailable: boolean;
    }
  | { readonly outcome: 'not_found'; readonly authoritative: boolean }
  | { readonly outcome: 'unsupported_country' };

/** One bound register's answer, or that it failed for good after the job's retries. */
export interface BusinessRegistryAnswer {
  readonly source: BusinessRegistrySourceName;
  readonly outcome: ProviderOutcome<BusinessRegistryLookup>;
}

/** An associated person as entered (C52.3). PII. */
export interface AssociatedPersonValues {
  readonly 'name-first'?: string | null | undefined;
  readonly 'name-last'?: string | null | undefined;
  /** `YYYY-MM` or `YYYY-MM-DD`. */
  readonly birthdate?: string | null | undefined;
}

/** The business as entered (C52.3), the inputs body's names. PII (a sole trader's name). */
export interface DatabaseBusinessValues {
  readonly 'business-name'?: string | null | undefined;
  /** ISO 3166-1 alpha-2. */
  readonly 'country-code'?: string | null | undefined;
  readonly 'registration-number'?: string | null | undefined;
  readonly lei?: string | null | undefined;
  readonly 'address-street-1'?: string | null | undefined;
  readonly 'address-street-2'?: string | null | undefined;
  readonly 'address-city'?: string | null | undefined;
  readonly 'address-subdivision'?: string | null | undefined;
  readonly 'address-postal-code'?: string | null | undefined;
  readonly 'associated-persons'?: readonly AssociatedPersonValues[] | null | undefined;
}

export interface DatabaseBusinessCheckInput {
  /** The entered values; `null` when none were received. */
  readonly values: DatabaseBusinessValues | null;
  /** The step's `collectAssociatedPersons` (C50.3). */
  readonly collectAssociatedPersons: boolean;
  /**
   * Each bound register's answer, in the C61.1 order of asking; empty or absent when no register
   * is bound (`none`), so the checks answer `provider_not_configured`.
   */
  readonly registry?: readonly BusinessRegistryAnswer[] | undefined;
}

/** C61.3: what the resolver port answered for the website's host. */
export type WebsiteHostResolution =
  | { readonly kind: 'addresses'; readonly addresses: readonly string[] }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'no_address' };

/** C61.4: the domain-age port's answer, as the API's `DomainAgeResult`. */
export type DomainAgeLookup =
  | { readonly outcome: 'registered'; readonly registeredAt: Date; readonly domain: string }
  | {
      readonly outcome: 'unavailable';
      readonly reason: 'no_rdap_service' | 'not_found' | 'subdomain' | 'no_registration_date';
    };

/** C61.5: the malicious-website port's answer, as the API's `MaliciousWebsiteResult`. */
export type MaliciousWebsiteLookup =
  | {
      readonly outcome: 'listed';
      readonly categories: readonly ('malware' | 'phishing' | 'spam_source')[];
      readonly feeds: readonly string[];
    }
  | { readonly outcome: 'not_listed'; readonly feeds: readonly string[] }
  | { readonly outcome: 'no_feeds' }
  | { readonly outcome: 'stale'; readonly feeds: readonly string[] };

/** C61.5: the backlink port's answer. */
export interface BacklinkLookup {
  readonly count: number;
}

/** The website as entered (C52.3). PII. */
export interface BusinessWebsiteValues {
  readonly 'website-url'?: string | null | undefined;
  readonly 'business-name'?: string | null | undefined;
}

export interface BusinessWebsiteCheckInput {
  /** The entered values; `null` when none were received. */
  readonly values: BusinessWebsiteValues | null;
  /** The resolver port's answer for the host (C61.3); not asked for a sandbox reserved name. */
  readonly resolution?: ProviderOutcome<WebsiteHostResolution> | undefined;
  readonly domainAge?: ProviderOutcome<DomainAgeLookup> | undefined;
  readonly maliciousWebsite?: ProviderOutcome<MaliciousWebsiteLookup> | undefined;
  readonly backlink?: ProviderOutcome<BacklinkLookup> | undefined;
  /** The environment kind; `production` when absent. */
  readonly environment?: EnvironmentKind | undefined;
  /** The evaluation instant (the domain's age); now by default. */
  readonly now?: Date | undefined;
}
