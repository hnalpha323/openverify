import { describe, expect, it } from 'vitest';
import { databaseContext } from './context.js';
import { databaseInquiryComparison } from './database-inquiry-comparison.js';
import type { DatabaseCheckInput } from './inputs.js';
import { ENTERED, ENTERED_TEXT, databaseInput, templateOf } from './testing.js';

const ID = 'database_inquiry_comparison';
const run = (input: DatabaseCheckInput, config?: Record<string, unknown>) =>
  databaseInquiryComparison(
    databaseContext(input, templateOf({ [ID]: config === undefined ? {} : { config } })),
  );
const PREFILLED = { name_first: 'Ada', name_last: 'Vellacott', birthdate: '1987-04-12' };

describe('database_inquiry_comparison (C59.3)', () => {
  it('passes when the entered values agree with the prefilled ones, without a provider', () => {
    expect(run(databaseInput({ inquiryFields: PREFILLED, providers: {} }))).toMatchObject({
      status: 'passed',
      reasons: [],
      metadata: { 'compared-fields': ['name', 'birthdate'], 'mismatched-fields': [] },
      provenance: { thresholds: { 'min-match-level': 'partial' } },
    });
  });

  it('fails inquiry_field_mismatch on a field that disagrees, naming the field', () => {
    expect(
      run(databaseInput({ inquiryFields: { ...PREFILLED, birthdate: '1990-01-01' } })),
    ).toMatchObject({
      status: 'failed',
      reasons: ['inquiry_field_mismatch'],
      metadata: { 'mismatched-fields': ['birthdate'] },
    });
  });

  it('judges at min-match-level: a nickname passes at partial, fails at full', () => {
    const input = databaseInput({
      values: { ...ENTERED, 'name-first': 'Bill' },
      inquiryFields: { name_first: 'William', name_last: 'Vellacott' },
    });

    expect(run(input).status).toBe('passed');
    expect(run(input, { 'min-match-level': 'full' }).reasons).toEqual(['inquiry_field_mismatch']);
  });

  it('answers no_reference_data when the inquiry was prefilled with none of the compared fields', () => {
    expect(run(databaseInput({ inquiryFields: null })).reasons).toEqual(['no_reference_data']);
    expect(run(databaseInput({ inquiryFields: { favourite_colour: 'teal' } })).reasons).toEqual([
      'no_reference_data',
    ]);
  });

  it('answers not_requested (non-blocking) for prefilled fields the step does not collect', () => {
    expect(
      run(databaseInput({ inquiryFields: { email_address: 'ada@example.test' } })),
    ).toMatchObject({
      status: 'not_applicable',
      reasons: ['not_requested'],
      metadata: { 'not-requested-fields': ['email-address'] },
    });
  });

  it('answers input_missing without entered values, or for a collected field left blank', () => {
    expect(run(databaseInput({ values: null, inquiryFields: PREFILLED })).reasons).toEqual([
      'input_missing',
    ]);
    expect(run(databaseInput({ inquiryFields: undefined })).reasons).toEqual(['input_missing']);
    expect(
      run(
        databaseInput({
          values: { ...ENTERED, birthdate: null },
          inquiryFields: { birthdate: '1987-04-12' },
        }),
      ).reasons,
    ).toEqual(['input_missing']);
  });

  it('copies no value', () => {
    const serialized = JSON.stringify(
      run(databaseInput({ inquiryFields: { ...PREFILLED, name_last: 'Ostrander' } })),
    );
    for (const value of [...ENTERED_TEXT, 'Ostrander']) {
      expect(serialized).not.toContain(value);
    }
  });
});
