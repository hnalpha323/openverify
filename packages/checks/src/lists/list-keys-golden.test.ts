/**
 * C98.2 (the version guard): every key input of fixed synthetic inputs hashes to one digest per
 * `LIST_KEYS_VERSION`. A change to any output without a new version fails here, and a row stored
 * under another version answers `normaliser_outdated`. A new version adds its own digest below and
 * never edits an earlier one. This covers the kinds of this folder, phone metadata and the address
 * dictionaries included; `packages/watchlist/src/list-keys/list-keys-golden.test.ts` covers the
 * name kinds.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { LIST_LIMITS } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import {
  LIST_KEYS_VERSION,
  LIST_VALUE_LIMITS,
  graphKeyInput,
  listKeyInputs,
  listProbeKeyInputs,
} from './index.js';

const GOLDEN: Readonly<Record<string, string>> = {
  'lists-1': '8b805642f55c9196049eabcc600625ff4c395c08c8fd21821621ec02826086cc',
};

const FINGERPRINT = 'ef'.repeat(32);

const ADDRESSES = [
  {
    'address-street-1': '12 N Main St',
    'address-city': 'Springfield',
    'address-subdivision': 'California',
    'address-postal-code': '94105-1234',
    'address-country-code': 'USA',
  },
  {
    'address-street-1': 'Rosenstraße 4',
    'address-street-2': 'Whg. 3',
    'address-city': 'München',
    'address-subdivision': 'Bayern',
    'address-postal-code': '80331',
    'address-country-code': 'DE',
  },
];

/** Every rule of C98.2 and C101.2, as text, in a fixed order. */
function outputs(): string[] {
  const rows: string[] = [];
  const add = (label: string, keys: unknown) => {
    rows.push(`${label} ${JSON.stringify(keys)}`);
  };
  for (const value of ['  Foo   Bar ', 'ＦＯＯ', 'ΣΑΣ', 'İstanbul', 'ẞtraße']) {
    add('string', listKeyInputs('string', { value }));
    add('string-cased', listKeyInputs('string', { value }, { 'case-sensitive': true }));
  }
  for (const value of ['Ana@EXAMPLE.org', 'a@b@bücher.example', 'user@example.com.']) {
    add('email', listKeyInputs('email-address', { value }));
    add('email-probe', listProbeKeyInputs('email-address', { value }));
  }
  add(
    'domain',
    listKeyInputs('email-address', { value: '@Sub.Example.org', 'match-type': 'domain' }),
  );
  for (const [value, region] of [
    ['+1 202 555 0100', null],
    ['(202) 555-0100', 'US'],
    ['07700 900123', 'GB'],
    ['030 12345678', 'DE'],
  ] as const) {
    add('phone', listKeyInputs('phone-number', { value }, { 'default-region': region }));
  }
  add('id', listKeyInputs('government-id-number', { 'id-number': 'l898 902-c3' }));
  add(
    'id-probe',
    listProbeKeyInputs('government-id-number', { 'id-number': 'x-1', 'id-class': 'visa' }),
  );
  add('id-any-probe', listProbeKeyInputs('government-id-number', { 'id-number': 'x-1' }));
  for (const value of [
    '192.0.2.1',
    '::ffff:192.0.2.1',
    '2001:DB8::1',
    '192.0.2.0/24',
    '::ffff:192.0.2.0/120',
    '2001:db8::/32',
    '192.0.2.1/32',
  ]) {
    add('ip', listKeyInputs('ip-address', { value }));
  }
  add('country', listKeyInputs('country', { 'country-code': 'us' }));
  add(
    'geo',
    listKeyInputs('geolocation', {
      latitude: -33.8688197,
      longitude: 151.2092955,
      'radius-meters': 1500,
    }),
  );
  add('browser', listKeyInputs('browser-fingerprint', { value: FINGERPRINT.toUpperCase() }));
  add('device', listKeyInputs('device-fingerprint', { value: FINGERPRINT }));
  for (const value of ['  Gold  Tier', '42.50', 42.5, true, '007', 1e21, 1.5e-7]) {
    add('field', listKeyInputs('field', { 'field-value': value }, { 'field-key': 'plan_id' }));
  }
  add('reference', graphKeyInput('reference_id', { value: 'customer-1' }));
  add('birthdate', graphKeyInput('birthdate', { value: '1990-02-03' }));
  add('postal', graphKeyInput('postal_code', { value: 'sw1a 1aa' }));
  add('email-domain', graphKeyInput('email_domain', { value: 'ana@Vanity.example' }));
  for (const address of ADDRESSES) {
    add('address', graphKeyInput('address', address));
  }
  return rows;
}

describe('LIST_KEYS_VERSION (C98.2)', () => {
  it('names the rules of every key input: a text, compared by equality (amendment 11)', () => {
    expect(LIST_KEYS_VERSION).toBe('lists-1');
  });

  it('holds its golden digest: a changed output needs a new version', () => {
    const digest = createHash('sha256').update(outputs().join('\n'), 'utf8').digest('hex');
    expect(digest).toBe(GOLDEN[LIST_KEYS_VERSION]);
  });
});

describe('the caps of the item values', () => {
  /** `packages/checks` cannot read contracts, so the caps are held to its source text. */
  const contract = readFileSync(
    new URL('../../../contracts/src/lists.ts', import.meta.url),
    'utf8',
  );

  it.each([
    ['EMAIL_MAX_LENGTH', LIST_VALUE_LIMITS.email],
    ['ID_NUMBER_MAX_LENGTH', LIST_VALUE_LIMITS.idNumber],
    ['IP_VALUE_MAX_LENGTH', LIST_VALUE_LIMITS.ip],
    ['NAME_MAX_LENGTH', LIST_VALUE_LIMITS.name],
    ['PHONE_MAX_LENGTH', LIST_VALUE_LIMITS.phone],
    ['FIELD_VALUE_MAX_LENGTH', LIST_VALUE_LIMITS.fieldValue],
  ])('holds %s to the contract, so an imported item can always be served', (name, value) => {
    expect(contract).toContain(`const ${name} = ${String(value)};`);
  });

  it('holds the string value to core', () => {
    expect(LIST_VALUE_LIMITS.string).toBe(LIST_LIMITS.stringValueLength);
  });
});
