/** C79-C82, C84.2: the report query bodies, in the public request shapes (H22). */
import { REPORT_TYPES } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import {
  REPORT_QUERY_FIELDS,
  REPORT_QUERY_LIMITS,
  REPORT_QUERY_SCHEMAS,
  REPORT_QUERY_SOURCES,
  SERVED_REPORT_QUERY_SCHEMAS,
  addressLookupQuerySchema,
  adverseMediaQuerySchema,
  businessAdverseMediaQuerySchema,
  businessWatchlistQuerySchema,
  cryptoAddressWatchlistQuerySchema,
  emailAddressQuerySchema,
  phoneNumberQuerySchema,
  politicallyExposedPersonQuerySchema,
  watchlistQuerySchema,
} from './report-queries.js';

const ok = (schema: { safeParse: (value: unknown) => { success: boolean } }, value: unknown) =>
  schema.safeParse(value).success;

describe('REPORT_QUERY_LIMITS', () => {
  it('fixes the caps of the query members', () => {
    expect(REPORT_QUERY_LIMITS).toEqual({
      name: 300,
      additionalNames: 3,
      identifier: 100,
      cryptoAddress: 256,
      emailAddress: 254,
      addressee: 200,
      street: 200,
      city: 100,
      subdivision: 100,
      postalCode: 20,
      website: 500,
    });
  });
});

describe('the watchlist query (C79.1)', () => {
  it('takes name parts or a term, with the optional public members and ours', () => {
    expect(ok(watchlistQuerySchema, { 'name-first': 'Avery', 'name-last': 'Quillfeather' })).toBe(
      true,
    );
    expect(ok(watchlistQuerySchema, { term: 'Quillfeather' })).toBe(true);
    expect(
      ok(watchlistQuerySchema, {
        'name-first': 'Avery',
        'name-middle': 'Sandbox',
        'name-last': 'Quillfeather',
        birthdate: '1980-04',
        'address-country-code': 'GB',
        gender: 'female',
        'identification-number': 'SBX123456',
        'identification-type': 'passport',
        'identification-country-code': 'GB',
        'additional-names': [
          { 'name-first': 'Avy', 'name-last': 'Quill' },
          { term: 'Quillfeather' },
        ],
      }),
    ).toBe(true);
  });

  it('needs a first name, a last name or a term, each with a letter and at most 300 characters', () => {
    expect(ok(watchlistQuerySchema, {})).toBe(false);
    expect(ok(watchlistQuerySchema, { 'name-middle': 'Sandbox' })).toBe(false);
    expect(ok(watchlistQuerySchema, { term: '12345' })).toBe(false);
    expect(ok(watchlistQuerySchema, { term: 'a'.repeat(301) })).toBe(false);
    expect(ok(watchlistQuerySchema, { term: '' })).toBe(false);
  });

  it('takes a year, a month or a day as birthdate, and only real dates', () => {
    for (const birthdate of ['1980', '1980-04', '1980-04-12', '2024-02-29']) {
      expect(ok(watchlistQuerySchema, { term: 'Avery', birthdate }), birthdate).toBe(true);
    }
    for (const birthdate of ['1980-13', '1980-02-30', '2023-02-29', '80-04-12', '1980/04/12']) {
      expect(ok(watchlistQuerySchema, { term: 'Avery', birthdate }), birthdate).toBe(false);
    }
  });

  it('pairs an identification number with its type, and caps the additional names at three', () => {
    expect(ok(watchlistQuerySchema, { term: 'Avery', 'identification-number': 'SBX1' })).toBe(
      false,
    );
    expect(ok(watchlistQuerySchema, { term: 'Avery', 'identification-type': 'passport' })).toBe(
      false,
    );
    expect(
      ok(watchlistQuerySchema, {
        term: 'Avery',
        'additional-names': [{ term: 'A' }, { term: 'B' }, { term: 'C' }, { term: 'D' }],
      }),
    ).toBe(false);
    expect(ok(watchlistQuerySchema, { term: 'Avery', 'additional-names': [{}] })).toBe(false);
    expect(ok(watchlistQuerySchema, { term: 'Avery', 'reference-id': 'x' })).toBe(false);
  });
});

describe('the business watchlist query (C79.2)', () => {
  it('takes the term with its country and the exact identifiers', () => {
    expect(
      ok(businessWatchlistQuerySchema, {
        term: 'Sandbox Sanctioned Holdings Ltd',
        'address-country-code': 'GB',
        'registration-number': 'SBX00000001',
        lei: '5299000SANDBOXLEI047',
        website: 'https://holdings.sandbox.example/about',
        'swift-bic': 'SBXHGB2L',
        'imo-number': '9999993',
        mmsi: '235000001',
        'aircraft-serial': 'SBX-0001',
        'aircraft-tail': 'G-SBXA',
      }),
    ).toBe(true);
    expect(ok(businessWatchlistQuerySchema, { term: '7 Sandbox' })).toBe(true);
  });

  it('refuses malformed identifiers and a missing term', () => {
    expect(ok(businessWatchlistQuerySchema, { lei: '5299000SANDBOXLEI047' })).toBe(false);
    for (const [member, value] of [
      ['lei', '5299000SANDBOX'],
      ['swift-bic', 'SBX'],
      ['imo-number', '999999'],
      ['mmsi', '23500000'],
      ['aircraft-tail', 'G SBXA'],
    ] as const) {
      expect(ok(businessWatchlistQuerySchema, { term: 'Sandbox', [member]: value }), member).toBe(
        false,
      );
    }
  });
});

describe('the other query bodies (C79.3, C80.5, C81.5, C82)', () => {
  it('takes a crypto address of up to 256 characters and an optional C57.1 chain', () => {
    expect(
      ok(cryptoAddressWatchlistQuerySchema, {
        'crypto-address': '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
        'chain-id': 'eip155:1',
      }),
    ).toBe(true);
    expect(ok(cryptoAddressWatchlistQuerySchema, { 'crypto-address': 'x'.repeat(256) })).toBe(true);
    expect(ok(cryptoAddressWatchlistQuerySchema, { 'crypto-address': 'x'.repeat(257) })).toBe(
      false,
    );
    expect(ok(cryptoAddressWatchlistQuerySchema, { 'crypto-address': '   ' })).toBe(false);
    expect(
      ok(cryptoAddressWatchlistQuerySchema, { 'crypto-address': 'x', 'chain-id': 'eip155:0' }),
    ).toBe(false);
  });

  it('takes the public PEP and person media requests, and a business media term', () => {
    const person = { 'name-last': 'Testerton', birthdate: '1971', 'country-code': 'GB' };
    expect(ok(politicallyExposedPersonQuerySchema, person)).toBe(true);
    expect(ok(adverseMediaQuerySchema, person)).toBe(true);
    expect(ok(adverseMediaQuerySchema, { 'address-country-code': 'GB', term: 'X' })).toBe(false);
    expect(ok(businessAdverseMediaQuerySchema, { term: 'Sandbox-Media Trading Ltd' })).toBe(true);
    expect(ok(businessAdverseMediaQuerySchema, { 'name-last': 'Testerton' })).toBe(false);
  });

  it('takes an email address, an E.164 number and the public address request', () => {
    expect(ok(emailAddressQuerySchema, { 'email-address': 'avery@example.test' })).toBe(true);
    expect(ok(emailAddressQuerySchema, { 'email-address': 'not an address' })).toBe(false);
    expect(ok(phoneNumberQuerySchema, { 'phone-number': '+12025550103' })).toBe(true);
    expect(ok(phoneNumberQuerySchema, { 'phone-number': '2025550103' })).toBe(false);
    const address = {
      'address-street-1': '1002 Placeholder Avenue',
      'address-city': 'Springfield',
      'address-subdivision': 'IL',
      'address-postal-code': '62704',
      'address-country-code': 'US',
    };
    expect(ok(addressLookupQuerySchema, address)).toBe(true);
    expect(ok(addressLookupQuerySchema, { ...address, addressee: 'Avery Quillfeather' })).toBe(
      true,
    );
    const withoutSubdivision: Record<string, string> = { ...address };
    delete withoutSubdivision['address-subdivision'];
    expect(ok(addressLookupQuerySchema, withoutSubdivision)).toBe(false);
  });
});

describe('the served query (C70.2, C70.3)', () => {
  it('has a schema per type, and serves each member nullable so masking keeps its keys', () => {
    expect(Object.keys(REPORT_QUERY_SCHEMAS)).toEqual([...REPORT_TYPES]);
    expect(Object.keys(SERVED_REPORT_QUERY_SCHEMAS)).toEqual([...REPORT_TYPES]);
    for (const type of REPORT_TYPES) {
      const masked = Object.fromEntries(REPORT_QUERY_FIELDS[type].map((field) => [field, null]));
      expect(ok(SERVED_REPORT_QUERY_SCHEMAS[type], masked), type).toBe(true);
      expect(ok(SERVED_REPORT_QUERY_SCHEMAS[type], {}), type).toBe(true);
      expect(ok(SERVED_REPORT_QUERY_SCHEMAS[type], { unknown: 'x' }), type).toBe(false);
    }
    expect(REPORT_QUERY_FIELDS['phone-number']).toEqual(['phone-number']);
    expect(REPORT_QUERY_FIELDS.watchlist).toContain('additional-names');
  });

  it('says where a completion report took each field from (C84.2)', () => {
    expect(REPORT_QUERY_SOURCES).toEqual([
      'request',
      'government_id',
      'inquiry_fields',
      'account_fields',
      'otp_confirmed',
      'crypto_wallet',
      'business_registry',
      'business_entered',
      // C106.1 (Phase 7): the first evaluated session's address at completion.
      'inquiry_session',
      // C106.2 (Workflow 7B).
      'government_id_country',
    ]);
  });
});
