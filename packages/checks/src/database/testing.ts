/**
 * Synthetic fixtures for the database and AAMVA evaluator tests: an invented person, street and
 * city, an unassigned ZIP code, a 555-01xx number and an `example.test` address. Not exported from
 * the package.
 */
import type { CheckId, VerificationTemplateConfig } from '@openverify/core';
import type { AamvaLookupResult, ProviderOutcome } from '../government-id/inputs.js';
import type {
  AamvaCheckInput,
  AamvaValues,
  DatabaseCheckInput,
  DatabaseLookup,
  DatabaseRecord,
  DatabaseStepField,
  DatabaseValues,
} from './inputs.js';

export const NOW = new Date('2026-10-23T12:00:00Z');
export const SANDBOX_PROVIDER = Object.freeze({ id: 'sandbox', sandbox: true });

export const ENTERED: DatabaseValues = Object.freeze({
  'name-first': 'Ada',
  'name-last': 'Vellacott',
  birthdate: '1987-04-12',
  'address-street-1': '123 Quillon Street',
  'address-city': 'Lanternfield',
  'address-subdivision': 'CA',
  'address-postal-code': '00123',
  'address-country-code': 'US',
});

export const COLLECTED: readonly DatabaseStepField[] = Object.freeze([
  'name_first',
  'name_last',
  'birthdate',
  'address_street_1',
  'address_city',
  'address_subdivision',
  'address_postal_code',
  'address_country_code',
]);

/** The record a sandbox source echoes: the entered values, the number as a match flag. */
export function echoedRecord(
  values: DatabaseValues = ENTERED,
  changes: Partial<Record<keyof DatabaseRecord, string | boolean | undefined>> = {},
): DatabaseRecord {
  const { 'identification-number': number, ...rest } = values;
  const record: Record<string, string | boolean | undefined> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (typeof value === 'string') {
      record[key] = value;
    }
  }
  if (typeof number === 'string') {
    record['identification-number-match'] = true;
  }
  return { ...record, ...changes } as DatabaseRecord;
}

export const found = (
  record: DatabaseRecord = echoedRecord(),
  authoritative = false,
): ProviderOutcome<DatabaseLookup> => ({
  kind: 'result',
  provider: SANDBOX_PROVIDER,
  result: { outcome: 'found', record, authoritative },
});

export const notFound = (authoritative: boolean): ProviderOutcome<DatabaseLookup> => ({
  kind: 'result',
  provider: SANDBOX_PROVIDER,
  result: { outcome: 'not_found', authoritative },
});

export const UNSUPPORTED_COUNTRY: ProviderOutcome<DatabaseLookup> = {
  kind: 'result',
  provider: SANDBOX_PROVIDER,
  result: { outcome: 'unsupported_country' },
};

export function databaseInput(changes: Partial<DatabaseCheckInput> = {}): DatabaseCheckInput {
  return {
    values: ENTERED,
    collectedFields: COLLECTED,
    providers: { database: found() },
    inquiryFields: null,
    now: NOW,
    ...changes,
  };
}

/** A template enabling `checks`, each required unless said otherwise. */
export function templateOf(
  checks: Partial<Record<CheckId, { required?: boolean; config?: Record<string, unknown> }>>,
): VerificationTemplateConfig {
  return {
    checks: Object.fromEntries(
      Object.entries(checks).map(([id, entry]) => [
        id,
        {
          enabled: true,
          required: entry.required ?? true,
          ...(entry.config === undefined ? {} : { config: entry.config }),
        },
      ]),
    ),
  };
}

export const AAMVA_ENTERED: AamvaValues = Object.freeze({
  'name-first': 'Ada',
  'name-last': 'Vellacott',
  birthdate: '1987-04-12',
  'identification-number': 'Q1234567',
  'issuing-authority': 'CA',
  'expiration-date': '2030-04-12',
});

export const aamvaAnswer = (result: AamvaLookupResult): ProviderOutcome<AamvaLookupResult> => ({
  kind: 'result',
  provider: SANDBOX_PROVIDER,
  result,
});

export function aamvaInput(changes: Partial<AamvaCheckInput> = {}): AamvaCheckInput {
  return {
    values: AAMVA_ENTERED,
    source: 'form',
    providers: { aamva: aamvaAnswer({ outcome: 'match' }) },
    ...changes,
  };
}

/** Every entered value and every word of one, so a test can show none reached a result. */
export const ENTERED_TEXT: readonly string[] = [
  ...Object.values(ENTERED),
  ...Object.values(AAMVA_ENTERED),
]
  .filter((value): value is string => typeof value === 'string')
  .flatMap((value) => [value, ...value.split(/[\s-]+/).filter((part) => part.length >= 4)]);
