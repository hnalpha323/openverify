/**
 * C101.2: the key inputs of the graph kinds `packages/checks` keys. The labels the graph shares
 * with a list give the list's input (decision 29, narrowed), so a list hit and a graph link meet on
 * one key. Every value is synthetic.
 */
import { GRAPH_KIND_REGISTRY, GRAPH_KINDS, type GraphKind } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { freeMailDomains } from '../reports/email/tables.js';
import {
  ListKeyInputError,
  graphKeyInput,
  listKeyInputs,
  listProbeKeyInputs,
  type ListValue,
} from './index.js';

const FINGERPRINT = 'cd'.repeat(32);

const ADDRESS = {
  'address-street-1': '12 North Main St',
  'address-street-2': 'Apt 4B',
  'address-city': 'Springfield',
  'address-subdivision': 'California',
  'address-postal-code': '94105-1234',
  'address-country-code': 'US',
};

const refusal = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    if (error instanceof ListKeyInputError) {
      return { code: error.code, member: error.member };
    }
    throw error;
  }
  throw new Error('the value was accepted');
};

/** A kind's example value, for the walk over every kind this folder keys. */
const EXAMPLES: Partial<Record<GraphKind, ListValue>> = {
  email_address: { value: 'ana@example.org' },
  phone_number: { value: '+12025550100' },
  email_address_unconfirmed: { value: 'ana@example.org' },
  phone_number_unconfirmed: { value: '+12025550100' },
  reference_id: { value: 'customer-1' },
  address: ADDRESS,
  device_fingerprint: { value: FINGERPRINT },
  device_class: { value: FINGERPRINT },
  browser_fingerprint: { value: FINGERPRINT },
  ip_address: { value: '192.0.2.1' },
  birthdate: { value: '1990-02-03' },
  postal_code: { value: '94105' },
  email_domain: { value: 'example.org' },
};

describe('graphKeyInput (C101.2)', () => {
  it.each(Object.entries(EXAMPLES) as [GraphKind, ListValue][])(
    'keys %s under the label of the registry',
    (kind, value) => {
      expect(graphKeyInput(kind, value).keyKind).toBe(GRAPH_KIND_REGISTRY[kind].key);
    },
  );

  it.each(GRAPH_KINDS.filter((kind) => EXAMPLES[kind] === undefined).map((kind) => [kind]))(
    'leaves %s to its owner: an existing index, or the name kinds',
    (kind) => {
      expect(() => graphKeyInput(kind, { value: 'x' })).toThrow(TypeError);
    },
  );

  it('meets the list keys on the labels they share (decision 29, narrowed)', () => {
    const email = 'Ana@Example.org';
    expect(graphKeyInput('email_address', { value: email })).toEqual(
      listKeyInputs('email-address', { value: email })[0],
    );
    expect(graphKeyInput('email_address_unconfirmed', { value: email })).toEqual(
      listKeyInputs('email-address', { value: email })[0],
    );
    const phone = '+1 202 555 0100';
    expect(graphKeyInput('phone_number', { value: phone })).toEqual(
      listKeyInputs('phone-number', { value: phone })[0],
    );
    expect(graphKeyInput('ip_address', { value: '::ffff:192.0.2.1' })).toEqual(
      listProbeKeyInputs('ip-address', { value: '::ffff:192.0.2.1' })[0],
    );
    expect(graphKeyInput('browser_fingerprint', { value: FINGERPRINT })).toEqual(
      listKeyInputs('browser-fingerprint', { value: FINGERPRINT })[0],
    );
    expect(graphKeyInput('device_fingerprint', { value: FINGERPRINT })).toEqual(
      listKeyInputs('device-fingerprint', { value: FINGERPRINT })[0],
    );
    expect(graphKeyInput('email_domain', { value: 'Example.org' })).toEqual(
      listKeyInputs('email-address', { value: 'example.org', 'match-type': 'domain' })[0],
    );
  });

  it('keys the device class under the device label: the kind column keeps the rows apart', () => {
    expect(graphKeyInput('device_class', { value: FINGERPRINT.toUpperCase() })).toEqual({
      keyKind: 'identifier-device-fingerprint',
      input: FINGERPRINT,
    });
  });

  it('reads a phone under the region it is given', () => {
    expect(
      graphKeyInput('phone_number', { value: '202 555 0100', 'default-region': 'US' }),
    ).toEqual({ keyKind: 'identifier-phone', input: '+12025550100' });
  });

  it('keeps a reference id exactly as the account holds it', () => {
    expect(graphKeyInput('reference_id', { value: ' Customer-1 ' })).toEqual({
      keyKind: 'identifier-reference-id',
      input: ' Customer-1 ',
    });
  });

  it('refuses an empty reference id', () => {
    expect(refusal(() => graphKeyInput('reference_id', { value: '  ' }))).toEqual({
      code: 'invalid_value',
      member: 'value',
    });
  });

  it.each(['1990-02-03', ' 1990-02-03 ', '2024-02-29'])('reads the birthdate %j', (value) => {
    expect(graphKeyInput('birthdate', { value }).input).toBe(value.trim());
  });

  it.each(['1990-2-3', '1990-13-01', '2023-02-29', '03/02/1990', '19900203', ''])(
    'refuses the birthdate %j',
    (value) => {
      expect(refusal(() => graphKeyInput('birthdate', { value }))).toEqual({
        code: 'invalid_value',
        member: 'value',
      });
    },
  );

  it.each([
    ['94105', '94105'],
    ['sw1a 1aa', 'SW1A1AA'],
    ['94105-1234', '941051234'],
  ])('reads the postal code %j', (value, input) => {
    expect(graphKeyInput('postal_code', { value })).toEqual({
      keyKind: 'identifier-postal-code',
      input,
    });
  });

  it('refuses a postal code with nothing in it', () => {
    expect(refusal(() => graphKeyInput('postal_code', { value: '--' }))).toEqual({
      code: 'invalid_value',
      member: 'value',
    });
  });

  it('reads the domain of an address or a domain', () => {
    expect(graphKeyInput('email_domain', { value: 'ana@Vanity.example' })).toEqual({
      keyKind: 'identifier-email-domain',
      input: 'vanity.example',
    });
  });

  it('refuses a free-mail domain: it links nobody (C101.2)', () => {
    const [domain = ''] = freeMailDomains();
    expect(refusal(() => graphKeyInput('email_domain', { value: `ana@${domain}` }))).toEqual({
      code: 'invalid_value',
      member: 'value',
    });
  });
});

describe('the address key (C101.2)', () => {
  const key = (changes: ListValue = {}) => graphKeyInput('address', { ...ADDRESS, ...changes });

  it('gives one canonical form', () => {
    expect(key()).toEqual({
      keyKind: 'identifier-address',
      input: 'US|CA|94105|springfield|12 north main street 4b',
    });
  });

  it.each([
    [{ 'address-street-1': '12 N. MAIN STREET' }],
    [{ 'address-street-1': '12 North Main St.', 'address-street-2': '#4B' }],
    [{ 'address-street-1': '12 North Main Street', 'address-street-2': 'Unit 4B' }],
    [{ 'address-city': 'SPRINGFIELD' }],
    [{ 'address-subdivision': 'CA' }],
    [{ 'address-postal-code': '94105' }],
    [{ 'address-country-code': 'usa' }],
  ])('reads %j as the same address', (changes) => {
    expect(key(changes)).toEqual(key());
  });

  it.each([
    [{ 'address-street-1': '12 South Main St' }],
    [{ 'address-street-1': '14 North Main St' }],
    [{ 'address-street-2': 'Apt 5B' }],
    [{ 'address-city': 'Oakland' }],
    [{ 'address-subdivision': 'NV' }],
    [{ 'address-postal-code': '94106' }],
    [{ 'address-country-code': 'CA' }],
  ])('keeps %j apart', (changes) => {
    expect(key(changes).input).not.toBe(key().input);
  });

  it('keeps a subdivision the data does not know, folded', () => {
    expect(key({ 'address-subdivision': 'Région Inconnue' }).input).toContain('|region inconnue|');
  });

  it('keeps the whole postal code outside the United States', () => {
    expect(
      key({ 'address-country-code': 'GB', 'address-postal-code': 'SW1A 1AA' }).input,
    ).toContain('|SW1A1AA|');
  });

  it('reads a street with no second line', () => {
    expect(key({ 'address-street-2': null }).input).toBe(
      'US|CA|94105|springfield|12 north main street',
    );
  });

  it('keeps a word that is no unit designator', () => {
    expect(key({ 'address-street-2': 'Apt Building' }).input).toContain('apt building');
  });

  it.each([
    ['address-street-1'],
    ['address-city'],
    ['address-subdivision'],
    ['address-postal-code'],
    ['address-country-code'],
  ])('needs %s: without all five there is no key (C101.2)', (member) => {
    expect(refusal(() => key({ [member]: null }))).toEqual({ code: 'invalid_value', member });
    expect(refusal(() => key({ [member]: '  ' }))).toEqual({ code: 'invalid_value', member });
  });

  it('refuses a line with no letter or digit, and a country it does not know', () => {
    expect(refusal(() => key({ 'address-street-1': '---' }))).toEqual({
      code: 'invalid_value',
      member: 'address-street-1',
    });
    expect(refusal(() => key({ 'address-city': '---' }))).toEqual({
      code: 'invalid_value',
      member: 'address-city',
    });
    expect(refusal(() => key({ 'address-subdivision': '---' }))).toEqual({
      code: 'invalid_value',
      member: 'address-subdivision',
    });
    expect(refusal(() => key({ 'address-postal-code': '---' }))).toEqual({
      code: 'invalid_value',
      member: 'address-postal-code',
    });
    expect(refusal(() => key({ 'address-country-code': 'ZZ' }))).toEqual({
      code: 'invalid_value',
      member: 'address-country-code',
    });
  });
});
