/**
 * The shared context of the database and AAMVA checks (C59): the input, the template, the
 * evaluation instant and, for database checks, the field levels of the entered values against
 * the record, computed once (C58).
 */
import type { VerificationTemplateConfig } from '@openverify/core';
import { utcToday } from '../dates.js';
import { presentText } from '../result.js';
import { matchAddresses, type AddressMatch, type PostalAddress } from '../matching/addresses.js';
import { matchEmailAddresses, matchPhoneNumbers } from '../matching/identifiers.js';
import { fieldMatch, type FieldMatch } from '../matching/levels.js';
import { matchPersonNames } from '../matching/names.js';
import { matchPartialDates } from '../matching/partial-dates.js';
import type {
  AamvaCheckInput,
  DatabaseCheckInput,
  DatabaseRecord,
  DatabaseStepField,
  DatabaseValueName,
  DatabaseValues,
} from './inputs.js';

/** The fields a database identity is matched on (C51.3 `DATABASE_MATCH_FIELDS`). */
export type DatabaseMatchField =
  'name' | 'birthdate' | 'address' | 'identification-number' | 'phone-number' | 'email-address';

/** The match fields, in the order results list them. */
export const DATABASE_MATCH_FIELD_ORDER: readonly DatabaseMatchField[] = [
  'name',
  'birthdate',
  'address',
  'identification-number',
  'phone-number',
  'email-address',
];

/** The step fields that collect each match field (as C50.4 maps them). */
const STEP_FIELDS: Readonly<Record<DatabaseMatchField, readonly DatabaseStepField[]>> = {
  name: ['name_first', 'name_last'],
  birthdate: ['birthdate'],
  address: ['address_street_1'],
  'identification-number': ['identification_number'],
  'phone-number': ['phone_number'],
  'email-address': ['email_address'],
};

/** The entered values that carry each match field. */
const VALUE_NAMES: Readonly<Record<DatabaseMatchField, readonly DatabaseValueName[]>> = {
  name: ['name-first', 'name-last'],
  birthdate: ['birthdate'],
  address: ['address-street-1'],
  'identification-number': ['identification-number'],
  'phone-number': ['phone-number'],
  'email-address': ['email-address'],
};

/** Each field's comparison of the entered values with the record. */
export interface DatabaseFieldMatches {
  readonly name: FieldMatch;
  readonly birthdate: FieldMatch;
  readonly address: AddressMatch;
  readonly 'identification-number': FieldMatch;
  readonly 'phone-number': FieldMatch;
  readonly 'email-address': FieldMatch;
}

export interface DatabaseContext {
  readonly input: DatabaseCheckInput;
  readonly template: VerificationTemplateConfig;
  readonly now: Date;
  /** The fields the step collected, as match fields. */
  readonly collected: ReadonlySet<DatabaseMatchField>;
  /** The fields the user entered, as match fields. */
  readonly entered: ReadonlySet<DatabaseMatchField>;
  /** The source's record, when it found one. */
  readonly record: DatabaseRecord | null;
  /** The entered values against the record, when there are both. */
  readonly fields: DatabaseFieldMatches | null;
}

export interface AamvaContext {
  readonly input: AamvaCheckInput;
  readonly template: VerificationTemplateConfig;
}

/** The address parts of entered values, a record or an inquiry's fields, by their key style. */
export function addressOf(source: object, separator: '-' | '_'): PostalAddress {
  const fields = source as Readonly<Record<string, unknown>>;
  const part = (name: string) => presentText(fields[`address${separator}${name}`]);
  const key = (name: string) => name.replaceAll('-', separator);
  return {
    street1: part(key('street-1')),
    street2: part(key('street-2')),
    city: part('city'),
    subdivision: part('subdivision'),
    postalCode: part(key('postal-code')),
    countryCode: part(key('country-code')),
  };
}

/** The entered values against a record, field by field (C58). */
export function databaseFieldMatches(
  values: DatabaseValues,
  record: DatabaseRecord,
  now: Date,
): DatabaseFieldMatches {
  const numberMatched = record['identification-number-match'];
  return {
    name: matchPersonNames(
      { first: values['name-first'], middle: values['name-middle'], last: values['name-last'] },
      { first: record['name-first'], middle: record['name-middle'], last: record['name-last'] },
    ),
    birthdate: matchPartialDates(values.birthdate, record.birthdate, { today: utcToday(now) }),
    address: matchAddresses(addressOf(values, '-'), addressOf(record, '-')),
    'identification-number':
      presentText(values['identification-number']) === null || numberMatched === undefined
        ? fieldMatch('missing')
        : fieldMatch(numberMatched ? 'full' : 'none'),
    'phone-number': matchPhoneNumbers(values['phone-number'], record['phone-number']),
    'email-address': matchEmailAddresses(values['email-address'], record['email-address']),
  };
}

/** Builds the context of one database verification: now unless given. */
export function databaseContext(
  input: DatabaseCheckInput,
  template: VerificationTemplateConfig,
): DatabaseContext {
  const now = input.now ?? new Date();
  const lookup = input.providers?.database;
  const record =
    lookup?.kind === 'result' && lookup.result.outcome === 'found' ? lookup.result.record : null;
  const values = input.values;
  return {
    input,
    template,
    now,
    collected: new Set(
      DATABASE_MATCH_FIELD_ORDER.filter((field) =>
        STEP_FIELDS[field].some((stepField) => input.collectedFields.includes(stepField)),
      ),
    ),
    entered: new Set(
      DATABASE_MATCH_FIELD_ORDER.filter((field) =>
        VALUE_NAMES[field].some((name) => presentText(values?.[name]) !== null),
      ),
    ),
    record,
    fields: values === null || record === null ? null : databaseFieldMatches(values, record, now),
  };
}

/** Builds the context of one AAMVA verification. */
export function aamvaContext(
  input: AamvaCheckInput,
  template: VerificationTemplateConfig,
): AamvaContext {
  return { input, template };
}

/** A field match as results record it: level, methods and flags, never a value. */
export const describeMatch = (match: FieldMatch) => ({
  level: match.level,
  methods: [...match.methods],
  flags: [...match.flags],
});
