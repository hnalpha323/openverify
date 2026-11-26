/**
 * C59.2: the sandbox database provider returns a record, not a verdict: by default an echo of the
 * values it was asked about, changed by a whole magic token in the lower-cased `reference-id`
 * (the first in precedence order wins), never authoritative. The last block runs the C59 checks
 * of the default template on its answers, so each token reaches the outcome the docs promise.
 * Every value is synthetic.
 */
import { evaluateDatabaseChecks, type DatabaseStepField } from '@openverify/checks';
import { defaultTemplateConfig, type CheckResult } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import type { DatabaseLookupRequest, DatabaseLookupResult } from '../../ports.js';
import { createDatabaseProvider } from './index.js';
import { SANDBOX_DATABASE_MAGIC, createSandboxDatabaseProvider } from './sandbox.js';

const FIELDS = {
  'name-first': 'Bob',
  'name-last': 'Testerton',
  birthdate: '1990-05-17',
  'address-street-1': '123 Main Street',
  'address-street-2': 'Apartment 4',
  'address-city': 'Springfield',
  'address-postal-code': '62704',
  'address-country-code': 'US',
};
const REQUEST: DatabaseLookupRequest = { country: 'US', fields: FIELDS };
const provider = createSandboxDatabaseProvider();

const lookup = (referenceId: string | null, request: DatabaseLookupRequest = REQUEST) =>
  provider.lookup(request, { referenceId });

/** The record of a `found` answer. */
async function recordFor(referenceId: string | null, request?: DatabaseLookupRequest) {
  const answer = await lookup(referenceId, request);
  if (answer.outcome !== 'found') {
    throw new Error(`expected a record, got ${answer.outcome}`);
  }
  return answer.record;
}

describe('the sandbox database provider (C59.2)', () => {
  it('is labelled sandbox and is what the factory binds', () => {
    expect(provider).toMatchObject({ id: 'sandbox', sandbox: true });
    expect(createDatabaseProvider('sandbox')).toMatchObject({ id: 'sandbox', sandbox: true });
    expect(SANDBOX_DATABASE_MAGIC).toEqual([
      'not-found',
      'name-mismatch',
      'nickname',
      'address-mismatch',
      'address-variant',
      'birthdate-mismatch',
      'birthdate-partial',
      'no-birthdate',
    ]);
  });

  it('echoes the values it was asked about in a record that is not authoritative', async () => {
    await expect(lookup(null)).resolves.toEqual({
      outcome: 'found',
      record: FIELDS,
      authoritative: false,
    });
    await expect(lookup('customer-42')).resolves.toEqual({
      outcome: 'found',
      record: FIELDS,
      authoritative: false,
    });
  });

  it('says whether an identification number matched, never returning one', async () => {
    const record = await recordFor(null, {
      country: 'US',
      fields: { ...FIELDS, 'identification-number': '123-45-6789' },
    });

    expect(record['identification-number-match']).toBe(true);
    expect(Object.values(record)).not.toContain('123-45-6789');
    expect(record).not.toHaveProperty('identification-number');
  });

  it('echoes phone numbers and email addresses as given', async () => {
    const record = await recordFor(null, {
      country: 'US',
      fields: { ...FIELDS, 'phone-number': '+15555550100', 'email-address': 'a@example.test' },
    });

    expect(record).toMatchObject({
      'phone-number': '+15555550100',
      'email-address': 'a@example.test',
    });
  });

  it('finds no record for sandbox-database-not-found, without authority', async () => {
    await expect(lookup('sandbox-database-not-found')).resolves.toEqual({
      outcome: 'not_found',
      authoritative: false,
    });
  });

  it('gives another surname for sandbox-database-name-mismatch', async () => {
    const record = await recordFor('sandbox-database-name-mismatch');

    expect(record['name-first']).toBe('Bob');
    expect(record['name-last']).not.toBe('Testerton');
    expect(record['name-last']?.length).toBeGreaterThan(0);
  });

  it('gives another surname even when the entered one is the usual replacement', async () => {
    const first = (await recordFor('sandbox-database-name-mismatch'))['name-last'] ?? '';
    const again = await recordFor('sandbox-database-name-mismatch', {
      country: 'US',
      fields: { ...FIELDS, 'name-last': first.toUpperCase() },
    });

    expect(again['name-last']?.toLowerCase()).not.toBe(first.toLowerCase());
  });

  it('gives the formal given name of a nickname for sandbox-database-nickname, and a nickname of a formal one', async () => {
    expect((await recordFor('sandbox-database-nickname'))['name-first']).toBe('Robert');
    const formal = await recordFor('sandbox-database-nickname', {
      country: 'US',
      fields: { ...FIELDS, 'name-first': 'Robert' },
    });
    expect(formal['name-first']).not.toBe('Robert');
    expect(formal['name-first']?.length).toBeGreaterThan(0);
  });

  it('keeps a given name the nickname table does not hold', async () => {
    const record = await recordFor('sandbox-database-nickname', {
      country: 'US',
      fields: { ...FIELDS, 'name-first': 'Zyxwq' },
    });

    expect(record['name-first']).toBe('Zyxwq');
  });

  it('gives another street and postal code for sandbox-database-address-mismatch', async () => {
    const record = await recordFor('sandbox-database-address-mismatch');

    expect(record['address-street-1']).not.toBe(FIELDS['address-street-1']);
    expect(record['address-postal-code']).not.toBe(FIELDS['address-postal-code']);
    expect(record['address-city']).toBe(FIELDS['address-city']);
  });

  it('swaps the address abbreviations for sandbox-database-address-variant', async () => {
    const record = await recordFor('sandbox-database-address-variant');

    expect(record['address-street-1']).toBe('123 Main St');
    expect(record['address-street-2']).toBe('Apt 4');
    const abbreviated = await recordFor('sandbox-database-address-variant', {
      country: 'US',
      fields: { ...FIELDS, 'address-street-1': '9 Elm Ave', 'address-street-2': 'Ste 2' },
    });
    expect(abbreviated['address-street-1']).toBe('9 Elm Avenue');
    expect(abbreviated['address-street-2']).toBe('Suite 2');
  });

  it('shifts the birth date by a year for sandbox-database-birthdate-mismatch, even from 29 February', async () => {
    expect((await recordFor('sandbox-database-birthdate-mismatch')).birthdate).toBe('1991-05-17');
    const leap = await recordFor('sandbox-database-birthdate-mismatch', {
      country: 'US',
      fields: { ...FIELDS, birthdate: '1992-02-29' },
    });
    expect(leap.birthdate).toBe('1993-02-28');
  });

  it('gives the year and month only for sandbox-database-birthdate-partial', async () => {
    expect((await recordFor('sandbox-database-birthdate-partial')).birthdate).toBe('1990-05');
  });

  it('gives a thin file without a birth date for sandbox-database-no-birthdate', async () => {
    const record = await recordFor('sandbox-database-no-birthdate');

    expect(record).not.toHaveProperty('birthdate');
    expect(record['name-last']).toBe('Testerton');
  });

  it('reads whole tokens only, in any case, the first in precedence order winning', async () => {
    await expect(lookup('SANDBOX-DATABASE-NOT-FOUND')).resolves.toMatchObject({
      outcome: 'not_found',
    });
    await expect(lookup('customer:sandbox-database-not-found')).resolves.toMatchObject({
      outcome: 'not_found',
    });
    for (const near of [
      'xsandbox-database-not-found',
      'sandbox-database-not-found2',
      'sandbox-database-not-found-twice',
      'sandbox-database-not',
    ]) {
      await expect(lookup(near), near).resolves.toMatchObject({ outcome: 'found' });
    }
    const both = await recordFor('sandbox-database-no-birthdate sandbox-database-name-mismatch');
    expect(both.birthdate).toBe(FIELDS.birthdate);
    expect(both['name-last']).not.toBe('Testerton');
    await expect(
      lookup('sandbox-database-nickname sandbox-database-not-found'),
    ).resolves.toMatchObject({ outcome: 'not_found' });
  });

  it('answers the same request the same way every time', async () => {
    for (const token of SANDBOX_DATABASE_MAGIC) {
      const reference = `sandbox-database-${token}`;
      expect(await lookup(reference)).toEqual(await lookup(reference));
    }
  });
});

describe('the default template on the sandbox records (C59.2, C65.5)', () => {
  const config = defaultTemplateConfig('database');
  const collected: DatabaseStepField[] = [
    'name_first',
    'name_last',
    'birthdate',
    'address_street_1',
    'address_street_2',
    'address_city',
    'address_postal_code',
    'address_country_code',
  ];

  async function checksFor(referenceId: string | null): Promise<Record<string, CheckResult>> {
    const answer: DatabaseLookupResult = await lookup(referenceId);
    const results = evaluateDatabaseChecks(
      {
        values: FIELDS,
        collectedFields: collected,
        providers: {
          database: { kind: 'result', provider: { id: 'sandbox', sandbox: true }, result: answer },
        },
        inquiryFields: null,
        now: new Date('2026-10-23T12:00:00.000Z'),
      },
      config,
    );
    return Object.fromEntries(results.map((result) => [result.name, result]));
  }

  it.each([
    [null, 'passed', []],
    ['sandbox-database-nickname', 'passed', []],
    ['sandbox-database-address-variant', 'passed', []],
    ['sandbox-database-birthdate-partial', 'passed', []],
    ['sandbox-database-name-mismatch', 'failed', ['low_confidence_match']],
    ['sandbox-database-address-mismatch', 'failed', ['low_confidence_match']],
    ['sandbox-database-birthdate-mismatch', 'failed', ['low_confidence_match']],
    ['sandbox-database-no-birthdate', 'not_applicable', ['insufficient_data']],
    ['sandbox-database-not-found', 'not_applicable', ['no_matching_record']],
  ] as const)('reference %s: the identity check is %s %j', async (reference, status, reasons) => {
    const identity = (await checksFor(reference)).database_identity_comparison;

    expect(identity).toMatchObject({ status, reasons });
    expect(identity?.provenance.provider).toEqual({ id: 'sandbox', sandbox: true });
  });

  it('a nickname is matched by the nickname table, not by spelling', async () => {
    const name = (await checksFor('sandbox-database-nickname')).database_name_comparison;

    expect(name).toMatchObject({ status: 'passed', metadata: { level: 'partial' } });
    expect((name?.metadata as { methods: string[] }).methods).toContain('nickname');
  });
});
