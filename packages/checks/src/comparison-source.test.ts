/**
 * C149.4 (Phase 9, Workflow 9B, api-flow-carry; 9A Stage 3 amendment 21, B47): the two
 * inquiry-comparison checks say, under `comparison-source`, where each compared field's value came
 * from: `initial` (set by `POST /inquiries`, which the person cannot change) or `entered` (set later,
 * by the flow or the API). A field read from several keys (a name, an address) is `initial` only
 * when every key it read holds an initial value, so a value the person typed is never reported as
 * one they could not edit. The member names fields and kinds, never a value. Every value is
 * synthetic.
 */
import { describe, expect, it } from 'vitest';
import { COMPARISON_SOURCE_METADATA_KEY, type ComparisonSourceKind } from './comparison-source.js';
import { databaseContext } from './database/context.js';
import { databaseInquiryComparison } from './database/database-inquiry-comparison.js';
import { ENTERED, databaseInput, templateOf } from './database/testing.js';
import { idAccountComparison } from './government-id/id-account-comparison.js';
import { idInquiryComparison } from './government-id/id-inquiry-comparison.js';
import { contextFor, template } from './testing/context.js';

type Sources = Record<string, ComparisonSourceKind>;

describe('id_inquiry_comparison records where each compared value came from (C149.4)', () => {
  const MATCHING = {
    name_first: 'Quinn',
    name_last: 'Valemont',
    birthdate: '1990-02-14',
    address_street_1: '12 Lantern Row',
    address_city: 'North Haven',
    identification_number: 'X12K45P78',
  };
  const ALL_INITIAL: Sources = Object.fromEntries(
    Object.keys(MATCHING).map((key) => [key, 'initial']),
  );
  const run = (
    inquiryFields: Record<string, unknown>,
    inquiryFieldSources?: Sources | null,
    config = template(),
  ) =>
    idInquiryComparison(
      contextFor(
        {
          references: {
            inquiryFields,
            ...(inquiryFieldSources === undefined ? {} : { inquiryFieldSources }),
          },
        },
        config,
      ),
    );

  it('names each compared field initial or entered, keyed as compared-fields is', () => {
    const result = run(MATCHING, {
      ...ALL_INITIAL,
      birthdate: 'entered',
      address_city: 'entered',
    });
    expect(result.status).toBe('passed');
    expect(result.metadata[COMPARISON_SOURCE_METADATA_KEY]).toEqual({
      name: 'initial',
      birthdate: 'entered',
      address: 'entered',
      'identification-number': 'initial',
    });
  });

  it('reads a field as entered when any key it compared was entered, the middle name included', () => {
    const result = run(
      { ...MATCHING, name_middle: 'A' },
      { ...ALL_INITIAL, name_middle: 'entered' },
    );
    expect(result.metadata[COMPARISON_SOURCE_METADATA_KEY]).toMatchObject({ name: 'entered' });
  });

  it('never claims initial for a key the sources do not name', () => {
    const named = Object.fromEntries(
      Object.entries(ALL_INITIAL).filter(([key]) => key !== 'identification_number'),
    );
    expect(run(MATCHING, named).metadata[COMPARISON_SOURCE_METADATA_KEY]).toMatchObject({
      name: 'initial',
      'identification-number': 'entered',
    });
  });

  it('records the source of a mismatched field too, and only of the fields compared', () => {
    const failed = run({ ...MATCHING, birthdate: '1991-02-14' }, ALL_INITIAL);
    expect(failed).toMatchObject({ status: 'failed', reasons: ['birthdate_mismatch'] });
    expect(failed.metadata[COMPARISON_SOURCE_METADATA_KEY]).toMatchObject({
      birthdate: 'initial',
    });
    const nameOnly = run(
      MATCHING,
      ALL_INITIAL,
      template({ id_inquiry_comparison: { fields: ['name'] } }),
    );
    expect(nameOnly.metadata[COMPARISON_SOURCE_METADATA_KEY]).toEqual({ name: 'initial' });
  });

  it('leaves the member out when the worker passed no sources, and when there is nothing to compare', () => {
    expect(run(MATCHING).metadata).not.toHaveProperty(COMPARISON_SOURCE_METADATA_KEY);
    expect(run(MATCHING, null).metadata).not.toHaveProperty(COMPARISON_SOURCE_METADATA_KEY);
    const nothing = idInquiryComparison(
      contextFor({ references: { inquiryFields: null, inquiryFieldSources: ALL_INITIAL } }),
    );
    expect(nothing.reasons).toEqual(['no_reference_data']);
    expect(nothing.metadata).not.toHaveProperty(COMPARISON_SOURCE_METADATA_KEY);
  });

  it('is the inquiry comparison’s alone: the account comparison never carries it', () => {
    const account = idAccountComparison(
      contextFor({
        references: { accountFields: MATCHING, inquiryFieldSources: ALL_INITIAL },
      }),
    );
    expect(account.status).toBe('passed');
    expect(account.metadata).not.toHaveProperty(COMPARISON_SOURCE_METADATA_KEY);
  });

  it('copies no value into the result', () => {
    const serialized = JSON.stringify(run(MATCHING, ALL_INITIAL));
    for (const value of Object.values(MATCHING)) {
      expect(serialized).not.toContain(value);
    }
  });
});

describe('database_inquiry_comparison records where each compared value came from (C149.4)', () => {
  const ID = 'database_inquiry_comparison';
  const PREFILLED = {
    name_first: 'Ada',
    name_last: 'Vellacott',
    birthdate: '1987-04-12',
    address_street_1: '123 Quillon Street',
    address_city: 'Lanternfield',
  };
  const run = (
    inquiryFields: Record<string, unknown> | null,
    inquiryFieldSources?: Sources | null,
    values = ENTERED,
  ) =>
    databaseInquiryComparison(
      databaseContext(
        databaseInput({
          values,
          inquiryFields,
          ...(inquiryFieldSources === undefined ? {} : { inquiryFieldSources }),
        }),
        templateOf({ [ID]: {} }),
      ),
    );

  it('names each compared field initial or entered', () => {
    const result = run(PREFILLED, {
      name_first: 'initial',
      name_last: 'initial',
      birthdate: 'entered',
      address_street_1: 'initial',
      address_city: 'initial',
    });
    expect(result.status).toBe('passed');
    expect(result.metadata[COMPARISON_SOURCE_METADATA_KEY]).toEqual({
      name: 'initial',
      birthdate: 'entered',
      address: 'initial',
    });
  });

  it('reads an address as entered when any of its keys was entered', () => {
    const result = run(PREFILLED, {
      name_first: 'initial',
      name_last: 'initial',
      birthdate: 'initial',
      address_street_1: 'initial',
      address_city: 'entered',
    });
    expect(result.metadata[COMPARISON_SOURCE_METADATA_KEY]).toEqual({
      name: 'initial',
      birthdate: 'initial',
      address: 'entered',
    });
  });

  it('records a mismatched field’s source, and leaves the member out without sources', () => {
    const failed = run(
      { ...PREFILLED, birthdate: '1990-01-01' },
      { birthdate: 'initial', name_first: 'entered', name_last: 'initial' },
    );
    expect(failed).toMatchObject({ status: 'failed', reasons: ['inquiry_field_mismatch'] });
    expect(failed.metadata[COMPARISON_SOURCE_METADATA_KEY]).toMatchObject({
      birthdate: 'initial',
      name: 'entered',
    });
    expect(run(PREFILLED).metadata).not.toHaveProperty(COMPARISON_SOURCE_METADATA_KEY);
    expect(run(PREFILLED, null).metadata).not.toHaveProperty(COMPARISON_SOURCE_METADATA_KEY);
    expect(run(null, { name_first: 'initial' }).metadata).not.toHaveProperty(
      COMPARISON_SOURCE_METADATA_KEY,
    );
  });

  it('copies no value into the result', () => {
    const serialized = JSON.stringify(
      run(PREFILLED, { name_first: 'initial', name_last: 'entered' }),
    );
    for (const value of Object.values(PREFILLED)) {
      expect(serialized).not.toContain(value);
    }
  });
});
