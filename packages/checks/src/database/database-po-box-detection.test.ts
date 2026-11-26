import { describe, expect, it } from 'vitest';
import { databaseContext } from './context.js';
import { databasePoBoxDetection } from './database-po-box-detection.js';
import type { DatabaseCheckInput } from './inputs.js';
import { ENTERED, databaseInput, templateOf } from './testing.js';

const run = (input: DatabaseCheckInput) =>
  databasePoBoxDetection(databaseContext(input, templateOf({ database_po_box_detection: {} })));
const street = (street1: string | null, street2?: string) =>
  databaseInput({
    values: {
      ...ENTERED,
      'address-street-1': street1,
      ...(street2 === undefined ? {} : { 'address-street-2': street2 }),
    },
    providers: {},
  });

describe('database_po_box_detection (C59.3)', () => {
  it('passes a street address, without a provider', () => {
    expect(run(street('123 Quillon Street'))).toMatchObject({
      status: 'passed',
      metadata: { 'matched-patterns': [] },
    });
  });

  it.each([
    ['PO Box 77', undefined, 'po_box'],
    ['P.O. Box 77', undefined, 'po_box'],
    ['123 Quillon Street', 'PMB 12', 'private_mailbox'],
    ['PSC 1234, Box 56', undefined, 'military'],
  ])('fails po_box_detected for %j %j', (street1, street2, pattern) => {
    expect(run(street(street1, street2))).toMatchObject({
      status: 'failed',
      reasons: ['po_box_detected'],
      metadata: { 'matched-patterns': expect.arrayContaining([pattern]) as unknown },
    });
  });

  it('answers not_requested (non-blocking) when the step collects no street', () => {
    expect(
      run(
        databaseInput({
          collectedFields: ['name_first', 'name_last', 'address_country_code', 'birthdate'],
        }),
      ),
    ).toMatchObject({ status: 'not_applicable', reasons: ['not_requested'] });
  });

  it('answers input_missing without values or without a street entered', () => {
    expect(run(databaseInput({ values: null })).reasons).toEqual(['input_missing']);
    expect(run(street(null)).reasons).toEqual(['input_missing']);
  });
});
