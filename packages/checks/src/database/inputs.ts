/**
 * What the database and AAMVA evaluators read (C52.3, C59). The worker passes the entered values
 * as the inputs body names them (decrypted, PII, never logged), the step's collected fields, the
 * provider's answer as a {@link ProviderOutcome}, and, for the inquiry comparison, the inquiry's
 * own fields (snake_case keys, as the account fields schema names them). An evaluator whose
 * evidence is absent answers `input_missing`, never `passed`.
 */
import type { AamvaLookupResult, ProviderOutcome } from '../government-id/inputs.js';
import type { ComparisonSourceKind } from '../comparison-source.js';

/** The values a database step can take, named as the inputs body names them (C52.3). */
export const DATABASE_VALUE_NAMES = [
  'name-first',
  'name-middle',
  'name-last',
  'birthdate',
  'address-street-1',
  'address-street-2',
  'address-city',
  'address-subdivision',
  'address-postal-code',
  'address-country-code',
  'identification-number',
  'phone-number',
  'email-address',
] as const;
export type DatabaseValueName = (typeof DATABASE_VALUE_NAMES)[number];

/** The entered values (PII). Any may be absent. */
export type DatabaseValues = Readonly<Partial<Record<DatabaseValueName, string | null>>>;

/** The fields a database step collects, as flow-spec names them (`DATABASE_FIELDS`, C50.3). */
export const DATABASE_STEP_FIELDS = [
  'name_first',
  'name_middle',
  'name_last',
  'birthdate',
  'address_street_1',
  'address_street_2',
  'address_city',
  'address_subdivision',
  'address_postal_code',
  'address_country_code',
  'identification_number',
  'phone_number',
  'email_address',
] as const;
export type DatabaseStepField = (typeof DATABASE_STEP_FIELDS)[number];

/**
 * C59.1: a record a database source holds (in memory only, PII). The birth date may be `YYYY`,
 * `YYYY-MM` or a full date; a source never returns the identification number, only whether it
 * matched the one it was given.
 */
export interface DatabaseRecord {
  readonly 'name-first'?: string | undefined;
  readonly 'name-middle'?: string | undefined;
  readonly 'name-last'?: string | undefined;
  readonly birthdate?: string | undefined;
  readonly 'address-street-1'?: string | undefined;
  readonly 'address-street-2'?: string | undefined;
  readonly 'address-city'?: string | undefined;
  readonly 'address-subdivision'?: string | undefined;
  readonly 'address-postal-code'?: string | undefined;
  readonly 'address-country-code'?: string | undefined;
  readonly 'identification-number-match'?: boolean | undefined;
  readonly 'phone-number'?: string | undefined;
  readonly 'email-address'?: string | undefined;
}

/** C59.1: a source's answer. `authoritative` says whether a miss is evidence (C59.3). */
export type DatabaseLookup =
  | { readonly outcome: 'found'; readonly record: DatabaseRecord; readonly authoritative: boolean }
  | { readonly outcome: 'not_found'; readonly authoritative: boolean }
  | { readonly outcome: 'unsupported_country' };

export interface DatabaseProviders {
  readonly database?: ProviderOutcome<DatabaseLookup> | undefined;
}

export interface DatabaseCheckInput {
  /** The entered values; `null` when none were received. */
  readonly values: DatabaseValues | null;
  /** The step's `fields` (C50.3). */
  readonly collectedFields: readonly DatabaseStepField[];
  readonly providers?: DatabaseProviders | undefined;
  /**
   * The inquiry's fields (snake_case keys) for `database_inquiry_comparison`: `null` when it holds
   * none, `undefined` when the worker passed none.
   */
  readonly inquiryFields?: Readonly<Record<string, unknown>> | null | undefined;
  /** C149.4 (Workflow 9B, (F)): by field key, where `inquiryFields`' value came from. */
  readonly inquiryFieldSources?: Readonly<Record<string, ComparisonSourceKind>> | null | undefined;
  /** The instant two-digit birth years are read against (R6); now by default. */
  readonly now?: Date | undefined;
}

/** The values of an AAMVA verification (C52.3), from the form or copied from the ID (C59.6). */
export const AAMVA_VALUE_NAMES = [
  'name-first',
  'name-last',
  'birthdate',
  'identification-number',
  'issuing-authority',
  'issue-date',
  'expiration-date',
  'address-postal-code',
] as const;
export type AamvaValueName = (typeof AAMVA_VALUE_NAMES)[number];
export type AamvaValues = Readonly<Partial<Record<AamvaValueName, string | null>>>;

/** Where an AAMVA verification's values came from: the user's form, or the government ID. */
export const AAMVA_VALUE_SOURCES = ['form', 'government_id'] as const;
export type AamvaValueSource = (typeof AAMVA_VALUE_SOURCES)[number];

export interface AamvaProviders {
  readonly aamva?: ProviderOutcome<AamvaLookupResult> | undefined;
}

export interface AamvaCheckInput {
  /** The values sent to DLDV; `null` when none were received. */
  readonly values: AamvaValues | null;
  readonly source: AamvaValueSource;
  readonly providers?: AamvaProviders | undefined;
}
