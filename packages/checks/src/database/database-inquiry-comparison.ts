/**
 * `database_inquiry_comparison` (R, fraud; C59.3): the values entered for the database against the
 * ones the inquiry already held, at `min-match-level`. `not_requested` (non-blocking) for fields
 * the step did not collect, `no_reference_data` when the inquiry holds none. C149.4 (Workflow 9B,
 * api-flow-carry): with the worker's `inquiryFieldSources`, `comparison-source` names whether each
 * compared field's value was set at creation (`initial`) or later (`entered`).
 */
import type { CheckResult } from '@openverify/core';
import {
  COMPARED_ADDRESS_KEYS,
  COMPARED_NAME_KEYS,
  COMPARISON_SOURCE_METADATA_KEY,
  comparisonSourceOf,
} from '../comparison-source.js';
import { utcToday } from '../dates.js';
import { matchAddresses } from '../matching/addresses.js';
import {
  matchEmailAddresses,
  matchIdentificationNumbers,
  matchPhoneNumbers,
} from '../matching/identifiers.js';
import { meetsRequirement, type FieldMatch } from '../matching/levels.js';
import { matchPersonNames } from '../matching/names.js';
import { matchPartialDates } from '../matching/partial-dates.js';
import { checkResult, presentText } from '../result.js';
import { databaseCheckConfig, databaseResultOptions } from './config.js';
import {
  DATABASE_MATCH_FIELD_ORDER,
  addressOf,
  describeMatch,
  type DatabaseContext,
  type DatabaseMatchField,
} from './context.js';
import type { DatabaseValues } from './inputs.js';

const ID = 'database_inquiry_comparison';

/** The inquiry fields that hold each match field (snake_case, as the account fields schema). */
const INQUIRY_KEYS: Readonly<Record<DatabaseMatchField, readonly string[]>> = {
  name: ['name_first', 'name_last'],
  birthdate: ['birthdate'],
  address: ['address_street_1'],
  'identification-number': ['identification_number'],
  'phone-number': ['phone_number'],
  'email-address': ['email_address'],
};

/** C149.4: every inquiry key a compared field reads (`compare` below, `addressOf`). */
const READ_KEYS: Readonly<Record<DatabaseMatchField, readonly string[]>> = {
  ...INQUIRY_KEYS,
  name: COMPARED_NAME_KEYS,
  address: COMPARED_ADDRESS_KEYS,
};

function compare(
  field: DatabaseMatchField,
  values: DatabaseValues,
  inquiry: Readonly<Record<string, unknown>>,
  now: Date,
): FieldMatch {
  const text = (key: string) => presentText(inquiry[key]);
  switch (field) {
    case 'name':
      return matchPersonNames(
        { first: values['name-first'], middle: values['name-middle'], last: values['name-last'] },
        { first: text('name_first'), middle: text('name_middle'), last: text('name_last') },
      );
    case 'birthdate':
      return matchPartialDates(values.birthdate, text('birthdate'), { today: utcToday(now) });
    case 'address':
      return matchAddresses(addressOf(values, '-'), addressOf(inquiry, '_'));
    case 'identification-number':
      return matchIdentificationNumbers(
        values['identification-number'],
        text('identification_number'),
      );
    case 'phone-number':
      return matchPhoneNumbers(values['phone-number'], text('phone_number'));
    case 'email-address':
      return matchEmailAddresses(values['email-address'], text('email_address'));
  }
}

export function databaseInquiryComparison(context: DatabaseContext): CheckResult {
  const config = databaseCheckConfig(context.template, ID);
  const options = databaseResultOptions(config, ['min-match-level']);
  const { values, inquiryFields, inquiryFieldSources } = context.input;
  if (values === null || inquiryFields === undefined) {
    return checkResult(ID, 'not_applicable', ['input_missing'], {}, options);
  }
  if (inquiryFields === null) {
    return checkResult(ID, 'not_applicable', ['no_reference_data'], {}, options);
  }
  const referenced = DATABASE_MATCH_FIELD_ORDER.filter((field) =>
    INQUIRY_KEYS[field].some((key) => presentText(inquiryFields[key]) !== null),
  );
  const notRequested = referenced.filter((field) => !context.collected.has(field));
  const considered = referenced.filter((field) => context.collected.has(field));
  const unentered = considered.filter((field) => !context.entered.has(field));
  const matches = considered
    .filter((field) => context.entered.has(field))
    .map((field) => [field, compare(field, values, inquiryFields, context.now)] as const);
  const required = config.values['min-match-level'] === 'full' ? 'full' : 'partial';
  const compared = matches.filter(([, match]) => match.level !== 'missing');
  const mismatched = compared.filter(([, match]) => !meetsRequirement(match.level, required));
  const metadata = {
    'compared-fields': compared.map(([field]) => field),
    'mismatched-fields': mismatched.map(([field]) => field),
    'not-requested-fields': notRequested,
    fields: Object.fromEntries(matches.map(([field, match]) => [field, describeMatch(match)])),
  };
  const source = comparisonSourceOf(
    compared.map(([field]) => field),
    (field) => READ_KEYS[field],
    inquiryFields,
    inquiryFieldSources,
  );
  if (source !== null) {
    Object.assign(metadata, { [COMPARISON_SOURCE_METADATA_KEY]: source });
  }
  if (mismatched.length > 0) {
    return checkResult(ID, 'failed', ['inquiry_field_mismatch'], metadata, options);
  }
  if (compared.length > 0) {
    return checkResult(ID, 'passed', [], metadata, options);
  }
  const reason =
    unentered.length > 0
      ? 'input_missing'
      : notRequested.length > 0
        ? 'not_requested'
        : 'no_reference_data';
  return checkResult(ID, 'not_applicable', [reason], metadata, options);
}
