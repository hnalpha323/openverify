/**
 * C78.3, C79.2: identifier normalisation. Every identifier is synthetic: the LEI and the IMO
 * number are the sandbox values of C82.4.
 */
import { describe, expect, it } from 'vitest';
import { normaliseIdentifier, recordIdentifierRows } from './index.js';

describe('normaliseIdentifier', () => {
  it('keeps the letters and digits of document and registration numbers, upper case', () => {
    expect(normaliseIdentifier('passport', ' ab 123-456 ', 'gb')).toEqual({
      kind: 'passport',
      value: 'AB123456',
      country: 'GB',
      check: 'none',
    });
    expect(normaliseIdentifier('registration_number', 'hrb-12 345')?.value).toBe('HRB12345');
    expect(normaliseIdentifier('aircraft_tail', 'n-123ab')?.value).toBe('N123AB');
    expect(normaliseIdentifier('tax_id', ' - ')).toBeNull();
    expect(normaliseIdentifier('passport', 'AB1', 'G1')?.country).toBeNull();
  });

  it('checks an LEI (ISO 17442) and keeps a failing one', () => {
    expect(normaliseIdentifier('lei', '5299000sandboxlei047')).toMatchObject({
      value: '5299000SANDBOXLEI047',
      check: 'valid',
    });
    expect(normaliseIdentifier('lei', '5299000SANDBOXLEI048')?.check).toBe('invalid');
    expect(normaliseIdentifier('lei', '5299000SANDBOX')?.check).toBe('invalid');
  });

  it('compares a BIC by its first eight characters', () => {
    expect(normaliseIdentifier('swift_bic', 'abcd gb 2l xxx')).toMatchObject({
      value: 'ABCDGB2L',
      check: 'valid',
    });
    expect(normaliseIdentifier('swift_bic', '12CDGB2L')?.check).toBe('invalid');
  });

  it('checks an IMO number by its check digit, and an MMSI by its length', () => {
    expect(normaliseIdentifier('imo', 'IMO 9999993')).toMatchObject({
      value: '9999993',
      check: 'valid',
    });
    expect(normaliseIdentifier('imo', '9999994')?.check).toBe('invalid');
    expect(normaliseIdentifier('mmsi', '123 456 789')).toMatchObject({
      value: '123456789',
      check: 'valid',
    });
    expect(normaliseIdentifier('mmsi', '12345')?.check).toBe('invalid');
  });

  it('reads a website as its host and an email address in lower case', () => {
    expect(normaliseIdentifier('website', 'https://www.Example.COM:8443/path?x=1')?.value).toBe(
      'example.com',
    );
    expect(normaliseIdentifier('website', 'bücher.example')?.value).toBe('xn--bcher-kva.example');
    expect(normaliseIdentifier('website', 'http://someone@shop.example/')?.value).toBe(
      'shop.example',
    );
    expect(normaliseIdentifier('website', 'not a host ??')).toBeNull();
    expect(normaliseIdentifier('email', ' Jane.Doe@Example.ORG ')?.value).toBe(
      'jane.doe@example.org',
    );
    expect(normaliseIdentifier('email', 'no-at-sign')).toBeNull();
  });
});

describe('recordIdentifierRows', () => {
  it('normalises each identifier of a record and drops duplicates and empty values', () => {
    expect(
      recordIdentifierRows({
        identifiers: [
          { kind: 'imo', value: 'IMO 9999993' },
          { kind: 'imo', value: '9999993' },
          { kind: 'passport', value: 'X 1', country: 'ZZ' },
          { kind: 'other', value: '--' },
        ],
      }),
    ).toEqual([
      { kind: 'imo', value: '9999993', country: null, check: 'valid' },
      { kind: 'passport', value: 'X1', country: 'ZZ', check: 'none' },
    ]);
  });
});
