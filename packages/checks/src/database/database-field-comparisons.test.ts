/**
 * The per-field database comparisons (C59.3): name, address and birthdate against the record at
 * `min-match-level`.
 */
import type { CheckId } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { databaseContext } from './context.js';
import { databaseAddressComparison } from './database-address-comparison.js';
import { databaseBirthdateComparison } from './database-birthdate-comparison.js';
import { databaseNameComparison } from './database-name-comparison.js';
import type { DatabaseCheckInput } from './inputs.js';
import {
  ENTERED,
  ENTERED_TEXT,
  UNSUPPORTED_COUNTRY,
  databaseInput,
  echoedRecord,
  found,
  notFound,
  templateOf,
} from './testing.js';

type Evaluator = typeof databaseNameComparison;
const CHECKS: readonly (readonly [CheckId, Evaluator, string])[] = [
  ['database_name_comparison', databaseNameComparison, 'name_mismatch'],
  ['database_address_comparison', databaseAddressComparison, 'address_mismatch'],
  ['database_birthdate_comparison', databaseBirthdateComparison, 'birthdate_mismatch'],
];
const runner =
  (id: CheckId, evaluate: Evaluator) =>
  (input: DatabaseCheckInput, config?: Record<string, unknown>) =>
    evaluate(databaseContext(input, templateOf({ [id]: config === undefined ? {} : { config } })));
const withRecord = (changes: Parameters<typeof echoedRecord>[1]) =>
  databaseInput({ providers: { database: found(echoedRecord(ENTERED, changes)) } });

describe.each(CHECKS)('%s (shared rules)', (id, evaluate) => {
  const run = runner(id, evaluate);

  it('passes on the echoed record, judged at min-match-level partial by default', () => {
    expect(run(databaseInput())).toMatchObject({
      status: 'passed',
      metadata: { level: 'full' },
      provenance: {
        thresholds: { 'min-match-level': 'partial' },
        'threshold-basis': { 'min-match-level': 'provisional' },
      },
    });
  });

  it('answers no_matching_record for a miss or an unsupported country, whatever the authority', () => {
    for (const lookup of [notFound(true), notFound(false), UNSUPPORTED_COUNTRY]) {
      expect(run(databaseInput({ providers: { database: lookup } }))).toMatchObject({
        status: 'not_applicable',
        reasons: ['no_matching_record'],
      });
    }
  });

  it('never passes without a provider result or entered values', () => {
    expect(run(databaseInput({ providers: {} })).reasons).toEqual(['provider_not_configured']);
    expect(run(databaseInput({ providers: { database: { kind: 'error' } } })).reasons).toEqual([
      'execution_error',
    ]);
    expect(run(databaseInput({ values: null })).reasons).toEqual(['input_missing']);
  });

  it('is not_requested when the step does not collect the field', () => {
    const result = run(databaseInput({ collectedFields: ['email_address'] }));

    expect(result).toMatchObject({ status: 'not_applicable', reasons: ['not_requested'] });
  });

  it('copies no value', () => {
    const serialized = JSON.stringify(run(withRecord({ 'name-last': 'Velacott' })));
    for (const value of ENTERED_TEXT) {
      expect(serialized).not.toContain(value);
    }
  });
});

describe('database_name_comparison', () => {
  const run = runner('database_name_comparison', databaseNameComparison);

  it('passes a nickname at partial, and fails it at full', () => {
    const nickname = databaseInput({
      values: { ...ENTERED, 'name-first': 'Bill' },
      providers: { database: found(echoedRecord(ENTERED, { 'name-first': 'William' })) },
    });

    expect(run(nickname)).toMatchObject({
      status: 'passed',
      metadata: { level: 'partial', methods: ['nickname'] },
    });
    expect(run(nickname, { 'min-match-level': 'full' })).toMatchObject({
      status: 'failed',
      reasons: ['name_mismatch'],
    });
  });

  it('fails another name, and answers no_reference_data for a record without one or in another script', () => {
    expect(run(withRecord({ 'name-last': 'Ostrander' })).reasons).toEqual(['name_mismatch']);
    expect(run(withRecord({ 'name-first': undefined, 'name-last': undefined })).reasons).toEqual([
      'no_reference_data',
    ]);
    expect(run(withRecord({ 'name-first': 'Ада', 'name-last': 'Веллакотт' }))).toMatchObject({
      reasons: ['no_reference_data'],
      metadata: { level: 'missing', flags: ['script-mismatch'] },
    });
  });

  it('answers input_missing when no name was entered', () => {
    expect(run(databaseInput({ values: { 'address-country-code': 'US' } })).reasons).toEqual([
      'input_missing',
    ]);
  });
});

describe('database_address_comparison', () => {
  const run = runner('database_address_comparison', databaseAddressComparison);

  it('passes the same address written with other abbreviations (sandbox-database-address-variant)', () => {
    expect(
      run(withRecord({ 'address-street-1': '123 Quillon St.', 'address-city': 'LANTERNFIELD' })),
    ).toMatchObject({ status: 'passed', metadata: { level: 'full' } });
  });

  it("fails a neighbour's address (sandbox-database-address-mismatch)", () => {
    expect(
      run(withRecord({ 'address-street-1': '125 Quillon Street', 'address-postal-code': '00124' })),
    ).toMatchObject({
      status: 'failed',
      reasons: ['address_mismatch'],
      metadata: { level: 'none' },
    });
  });

  it('answers no_reference_data for a record without a street', () => {
    expect(run(withRecord({ 'address-street-1': undefined })).reasons).toEqual([
      'no_reference_data',
    ]);
  });

  it('records the component outcomes', () => {
    expect(run(databaseInput()).metadata).toMatchObject({
      components: { street: 'exact', 'house-number': 'exact', 'postal-code': 'exact' },
    });
  });
});

describe('database_birthdate_comparison', () => {
  const run = runner('database_birthdate_comparison', databaseBirthdateComparison);

  it('fails a birthdate one year off (sandbox-database-birthdate-mismatch), flagged near-match', () => {
    expect(run(withRecord({ birthdate: '1988-04-12' }))).toMatchObject({
      status: 'failed',
      reasons: ['birthdate_mismatch'],
      metadata: { level: 'none', flags: ['near-match'] },
    });
  });

  it('passes a year and month (sandbox-database-birthdate-partial) at partial, and fails it at full', () => {
    const partial = withRecord({ birthdate: '1987-04' });

    expect(run(partial)).toMatchObject({
      status: 'passed',
      metadata: { flags: ['precision-limited'] },
    });
    expect(run(partial, { 'min-match-level': 'full' }).reasons).toEqual(['birthdate_mismatch']);
  });

  it('answers birthdate_ambiguous for a day-month transposition', () => {
    expect(run(withRecord({ birthdate: '1987-12-04' }))).toMatchObject({
      status: 'not_applicable',
      reasons: ['birthdate_ambiguous'],
    });
  });

  it('answers no_reference_data for a record without a birthdate (sandbox-database-no-birthdate)', () => {
    expect(run(withRecord({ birthdate: undefined })).reasons).toEqual(['no_reference_data']);
  });
});
