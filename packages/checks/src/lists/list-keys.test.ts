/**
 * C98.2: the key inputs of every kind `packages/checks` keys, one golden vector per rule of the
 * table. Every value is synthetic: addresses from the documentation ranges, emails at example.com
 * and .org, phone numbers from the fictional ranges, invented ID numbers and points.
 */
import { ID_CLASSES } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import {
  ListKeyInputError,
  listKeyInputs,
  listProbeKeyInputs,
  type KeyedListKind,
  type ListKeyOptions,
  type ListValue,
} from './index.js';

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

const FINGERPRINT = 'ab'.repeat(32);

describe('string (C98.2)', () => {
  const key = (value: string, options?: ListKeyOptions) =>
    listKeyInputs('string', { value }, options);

  it.each([
    ['  Foo   Bar ', 'foo bar'],
    ['ＦＯＯ', 'foo'],
    ['ﬁeld', 'field'],
    ['a\tb c', 'a b c'],
    ['ÉTÉ', 'été'],
  ])('normalises %j', (value, input) => {
    expect(key(value)).toEqual([{ keyKind: 'identifier-string', input }]);
  });

  it('keeps the case of a case-sensitive list, after the same folding', () => {
    expect(key('  Foo   BAR ', { 'case-sensitive': true })).toEqual([
      { keyKind: 'identifier-string', input: 'Foo BAR' },
    ]);
  });

  it('refuses nothing left, too much, and a lone surrogate', () => {
    expect(refusal(() => key('   '))).toEqual({ code: 'invalid_value', member: 'value' });
    expect(refusal(() => key('a'.repeat(256)))).toEqual({ code: 'out_of_range', member: 'value' });
    expect(refusal(() => key('a\ud800b'))).toEqual({ code: 'invalid_value', member: 'value' });
  });

  it('is idempotent: its output keys alike', () => {
    for (const value of ['  Foo   Bar ', 'ẞtraße', 'ΣΑΣ', 'İstanbul', 'ﬁ  ﬂ']) {
      const [first] = key(value);
      expect(key(first?.input ?? '')).toEqual([first]);
    }
  });
});

describe('email address (C98.2)', () => {
  const key = (value: string, matchType?: string) =>
    listKeyInputs(
      'email-address',
      matchType === undefined ? { value } : { value, 'match-type': matchType },
    );

  it.each([
    [' Ana.Example@EXAMPLE.com ', 'ana.example@example.com'],
    ['a@b@EXAMPLE.org', 'a@b@example.org'],
    ['user@bücher.example', 'user@xn--bcher-kva.example'],
    ['user@example.com.', 'user@example.com'],
  ])('normalises the address %j', (value, input) => {
    expect(key(value)).toEqual([{ keyKind: 'identifier-email', input }]);
    expect(key(value, 'email_address')).toEqual([{ keyKind: 'identifier-email', input }]);
  });

  it.each(['no-at', '@example.com', 'a@', 'a@[192.0.2.1]', 'a@exa_mple.com', 'a@b..com'])(
    'refuses %j',
    (value) => {
      expect(refusal(() => key(value))).toEqual({ code: 'invalid_value', member: 'value' });
    },
  );

  it('refuses a domain the URL parser reads as an address', () => {
    expect(refusal(() => key('a@192.0.2.1'))).toEqual({ code: 'invalid_value', member: 'value' });
    expect(refusal(() => key('a@0x7f.1'))).toEqual({ code: 'invalid_value', member: 'value' });
  });

  it('refuses an address longer than the contract serves', () => {
    expect(refusal(() => key(`${'a'.repeat(250)}@example.com`))).toEqual({
      code: 'out_of_range',
      member: 'value',
    });
  });

  it.each([
    ['EXAMPLE.com', 'example.com'],
    ['@Example.org', 'example.org'],
    ['bücher.example', 'xn--bcher-kva.example'],
    ['xyz', 'xyz'],
  ])('reads the domain item %j', (value, input) => {
    expect(key(value, 'domain')).toEqual([{ keyKind: 'identifier-email-domain', input }]);
  });

  it('refuses a whole address as a domain item, which would list every mailbox of the domain', () => {
    expect(refusal(() => key('ana@example.com', 'domain'))).toEqual({
      code: 'invalid_value',
      member: 'value',
    });
  });

  it('refuses a match type it does not know', () => {
    expect(refusal(() => key('ana@example.com', 'mailbox'))).toEqual({
      code: 'invalid_value',
      member: 'match-type',
    });
  });

  it('probes the address, its domain and every parent (C98.2)', () => {
    expect(listProbeKeyInputs('email-address', { value: 'Ana@mail.sub.Example.org' })).toEqual([
      { keyKind: 'identifier-email', input: 'ana@mail.sub.example.org' },
      { keyKind: 'identifier-email-domain', input: 'mail.sub.example.org' },
      { keyKind: 'identifier-email-domain', input: 'sub.example.org' },
      { keyKind: 'identifier-email-domain', input: 'example.org' },
      { keyKind: 'identifier-email-domain', input: 'org' },
    ]);
  });

  it('meets a stored address and a stored domain on one key', () => {
    const probe = listProbeKeyInputs('email-address', { value: 'ana@mail.example.org' });
    for (const item of [key('ANA@mail.example.org'), key('example.org', 'domain')]) {
      expect(probe).toContainEqual(item[0]);
    }
  });

  it('refuses a probe with no address', () => {
    expect(refusal(() => listProbeKeyInputs('email-address', { value: 'example.org' }))).toEqual({
      code: 'invalid_value',
      member: 'value',
    });
  });
});

describe('phone number (C98.2)', () => {
  const key = (value: string, region?: string | null) =>
    listKeyInputs(
      'phone-number',
      { value },
      region === undefined ? undefined : { 'default-region': region },
    );

  it.each([
    ['+1 202 555 0100', undefined, '+12025550100'],
    ['+1 (202) 555-0100', null, '+12025550100'],
    ['(202) 555-0100', 'US', '+12025550100'],
    ['+44 7700 900123', 'US', '+447700900123'],
    ['07700 900123', 'GB', '+447700900123'],
  ])('reads %j under the region %j', (value, region, input) => {
    expect(key(value, region)).toEqual([{ keyKind: 'identifier-phone', input }]);
  });

  it('reads an international number under a region the metadata does not hold', () => {
    expect(key('+12025550100', 'AQ')).toEqual([
      { keyKind: 'identifier-phone', input: '+12025550100' },
    ]);
  });

  it.each([
    ['(202) 555-0100', undefined],
    ['(202) 555-0100', null],
    ['not a number', 'US'],
    ['call +12025550100', undefined],
    ['+999123456', undefined],
    ['+1202', undefined],
    [`+1${'2'.repeat(40)}`, undefined],
  ])('refuses %j under the region %j as unparseable', (value, region) => {
    expect(refusal(() => key(value, region))).toEqual({
      code: 'unparseable_phone',
      member: 'value',
    });
  });

  it('probes with the region of the list it reads', () => {
    expect(
      listProbeKeyInputs('phone-number', { value: '202 555 0100' }, { 'default-region': 'US' }),
    ).toEqual([{ keyKind: 'identifier-phone', input: '+12025550100' }]);
  });
});

describe('government ID number (C98.2)', () => {
  it.each([
    [{ 'id-number': 'l898 902-c3', 'id-class': 'passport' }, 'passport|L898902C3'],
    [{ 'id-number': 'l898 902-c3' }, '*|L898902C3'],
    [{ 'id-number': 'L898902C3<<', 'id-class': null }, '*|L898902C3'],
    [{ 'id-number': 'L898902C3', 'id-class': '' }, '*|L898902C3'],
  ])('keys %j', (item, input) => {
    expect(listKeyInputs('government-id-number', item)).toEqual([
      { keyKind: 'identifier-government-id-number', input },
    ]);
  });

  it('refuses a class outside C31 by its own code', () => {
    expect(
      refusal(() =>
        listKeyInputs('government-id-number', { 'id-number': 'X1', 'id-class': 'library_card' }),
      ),
    ).toEqual({ code: 'unsupported_class', member: 'id-class' });
  });

  it('refuses a number with nothing to index, and one the contract cannot serve', () => {
    expect(refusal(() => listKeyInputs('government-id-number', { 'id-number': '--' }))).toEqual({
      code: 'invalid_value',
      member: 'id-number',
    });
    expect(
      refusal(() => listKeyInputs('government-id-number', { 'id-number': '1'.repeat(101) })),
    ).toEqual({ code: 'out_of_range', member: 'id-number' });
  });

  it('probes the class and any class (C98.2)', () => {
    expect(
      listProbeKeyInputs('government-id-number', { 'id-number': 'x-1', 'id-class': 'visa' }),
    ).toEqual([
      { keyKind: 'identifier-government-id-number', input: 'visa|X1' },
      { keyKind: 'identifier-government-id-number', input: '*|X1' },
    ]);
  });

  it('probes every class when the probe has none: a stored class is never "no match"', () => {
    const inputs = listProbeKeyInputs('government-id-number', { 'id-number': 'x-1' }).map(
      ({ input }) => input,
    );
    expect(inputs).toEqual(['*|X1', ...ID_CLASSES.map((idClass) => `${idClass}|X1`)]);
  });
});

describe('IP address (C98.2)', () => {
  const key = (value: string) => listKeyInputs('ip-address', { value });

  it.each([
    ['192.0.2.1', '192.0.2.1'],
    [' 192.0.2.1 ', '192.0.2.1'],
    ['::ffff:192.0.2.1', '192.0.2.1'],
    ['2001:DB8:0:0::1', '2001:db8::1'],
    ['192.0.2.1/32', '192.0.2.1'],
    ['2001:db8::1/128', '2001:db8::1'],
    ['::ffff:192.0.2.1/128', '192.0.2.1'],
  ])('reads %j as a single address', (value, input) => {
    expect(key(value)).toEqual([{ keyKind: 'identifier-ip', input }]);
  });

  it.each([
    ['192.0.2.0/24', '192.0.2.0/24'],
    ['192.0.2.0/31', '192.0.2.0/31'],
    ['2001:db8::/32', '2001:db8::/32'],
    ['2001:DB8::/127', '2001:db8::/127'],
    ['::ffff:192.0.2.0/120', '192.0.2.0/24'],
  ])('reads %j as a range', (value, input) => {
    expect(key(value)).toEqual([{ keyKind: 'identifier-ip-range', input }]);
  });

  it('refuses host bits by their own code', () => {
    expect(refusal(() => key('192.0.2.1/24'))).toEqual({ code: 'host_bits_set', member: 'value' });
    expect(refusal(() => key('2001:db8::1/64'))).toEqual({
      code: 'host_bits_set',
      member: 'value',
    });
  });

  it.each(['', 'fe80::1%eth0', '[2001:db8::1]', '192.0.2.0/33', '192.0.2.0/', '::/0', 'host'])(
    'refuses %j',
    (value) => {
      expect(refusal(() => key(value))).toEqual({ code: 'invalid_value', member: 'value' });
    },
  );

  it('probes a single address', () => {
    expect(listProbeKeyInputs('ip-address', { value: '::ffff:192.0.2.1' })).toEqual([
      { keyKind: 'identifier-ip', input: '192.0.2.1' },
    ]);
  });

  it('refuses a range as a probe: a session has one address', () => {
    expect(refusal(() => listProbeKeyInputs('ip-address', { value: '192.0.2.0/24' }))).toEqual({
      code: 'invalid_value',
      member: 'value',
    });
  });
});

describe('country (C98.2)', () => {
  it.each(['US', ' us '])('reads %j', (code) => {
    expect(listKeyInputs('country', { 'country-code': code })).toEqual([
      { keyKind: 'identifier-country', input: 'US' },
    ]);
    expect(listProbeKeyInputs('country', { 'country-code': code })).toEqual([
      { keyKind: 'identifier-country', input: 'US' },
    ]);
  });

  it.each(['USA', 'U', '1A', ''])('refuses %j', (code) => {
    expect(refusal(() => listKeyInputs('country', { 'country-code': code }))).toEqual({
      code: 'invalid_value',
      member: 'country-code',
    });
  });
});

describe('geolocation (C98.2)', () => {
  const point = (latitude: unknown, longitude: unknown, radius: unknown) => ({
    latitude,
    longitude,
    'radius-meters': radius,
  });
  const key = (item: ListValue) => listKeyInputs('geolocation', item);

  it.each([
    [point(48.8566, 2.3522, 1000), '48.856600,2.352200,1000'],
    [point('48.8566', '2.3522', '1000'), '48.856600,2.352200,1000'],
    [point(-33.8688197, 151.2092956, 500000), '-33.868820,151.209296,500000'],
    [point(0, 0, 1), '0.000000,0.000000,1'],
    [point(-0.0000001, 0.0000001, 1.5), '0.000000,0.000000,1.5'],
    [point(90, -180, 2), '90.000000,-180.000000,2'],
    [point(-90, 180, 2), '-90.000000,-180.000000,2'],
    [point(0, 179.9999999, 2), '0.000000,-180.000000,2'],
  ])('reads %j', (item, input) => {
    expect(key(item)).toEqual([{ keyKind: 'identifier-geolocation', input }]);
  });

  it.each([
    [point(90.1, 0, 1), 'latitude'],
    [point(-90.1, 0, 1), 'latitude'],
    [point(0, 180.1, 1), 'longitude'],
    [point(0, -180.1, 1), 'longitude'],
    [point(0, 0, 0.5), 'radius-meters'],
    [point(0, 0, 500_001), 'radius-meters'],
  ])('refuses %j as out of range', (item, member) => {
    expect(refusal(() => key(item))).toEqual({ code: 'out_of_range', member });
  });

  it.each([
    [point('north', 0, 1), 'latitude'],
    [point('1e2', 0, 1), 'latitude'],
    [point(Number.NaN, 0, 1), 'latitude'],
    [point(0, undefined, 1), 'longitude'],
    [point(0, 0, Number.POSITIVE_INFINITY), 'radius-meters'],
    [point(0, 0, null), 'radius-meters'],
  ])('refuses %j as not a number', (item, member) => {
    expect(refusal(() => key(item))).toEqual({ code: 'invalid_value', member });
  });

  it('sends no key for a probe: the box on the plaintext column matches (C99.2)', () => {
    expect(listProbeKeyInputs('geolocation', { latitude: 48.85, longitude: 2.35 })).toEqual([]);
  });

  it('checks a probe point all the same', () => {
    expect(
      refusal(() => listProbeKeyInputs('geolocation', { latitude: 91, longitude: 0 })),
    ).toEqual({ code: 'out_of_range', member: 'latitude' });
  });
});

describe.each([
  ['browser-fingerprint', 'identifier-browser-fingerprint'],
  ['device-fingerprint', 'identifier-device-fingerprint'],
] as const)('%s (C98.2, Stage 1a amendment 3)', (kind, keyKind) => {
  it('trims and lower-cases the 64-hex value a device resource serves', () => {
    const value = ` ${FINGERPRINT.toUpperCase()}\n`;
    expect(listKeyInputs(kind, { value })).toEqual([{ keyKind, input: FINGERPRINT }]);
    expect(listProbeKeyInputs(kind, { value })).toEqual([{ keyKind, input: FINGERPRINT }]);
  });

  it.each(['abc', `${FINGERPRINT}0`, 'g'.repeat(64)])('refuses %j', (value) => {
    expect(refusal(() => listKeyInputs(kind, { value }))).toEqual({
      code: 'invalid_value',
      member: 'value',
    });
  });
});

describe('field (C98.2)', () => {
  const OPTIONS = { 'field-key': 'plan_id' };
  const key = (value: unknown) => listKeyInputs('field', { 'field-value': value }, OPTIONS);

  it.each([
    ['  Gold   Tier ', 'plan_id|gold tier'],
    ['2000-01-02', 'plan_id|2000-01-02'],
    ['TRUE', 'plan_id|true'],
    [true, 'plan_id|true'],
    [false, 'plan_id|false'],
    ['42.50', 'plan_id|42.5'],
    [42.5, 'plan_id|42.5'],
    ['42.000', 'plan_id|42'],
    [42, 'plan_id|42'],
    ['-0.0', 'plan_id|0'],
    [-0, 'plan_id|0'],
    ['-1.10', 'plan_id|-1.1'],
    [1e21, 'plan_id|1000000000000000000000'],
    [1.5e-7, 'plan_id|0.00000015'],
    [-2.5e21, 'plan_id|-2500000000000000000000'],
  ])('keys %j', (value, input) => {
    expect(key(value)).toEqual([{ keyKind: 'identifier-field', input }]);
  });

  it.each([
    ['007', 'plan_id|007'],
    ['+7', 'plan_id|+7'],
    ['1e3', 'plan_id|1e3'],
    ['.5', 'plan_id|.5'],
    ['5.', 'plan_id|5.'],
    ['1,000', 'plan_id|1,000'],
  ])('leaves the text %j alone: it does not read as a canonical decimal', (value, input) => {
    expect(key(value)).toEqual([{ keyKind: 'identifier-field', input }]);
  });

  it('meets a typed value and its text on one key', () => {
    expect(key('12.50')).toEqual(key(12.5));
    expect(key('true')).toEqual(key(true));
  });

  it('refuses a number that is not finite, a null, and too much', () => {
    expect(refusal(() => key(Number.NaN))).toEqual({
      code: 'invalid_value',
      member: 'field-value',
    });
    expect(refusal(() => key(null))).toEqual({ code: 'invalid_value', member: 'field-value' });
    expect(refusal(() => key('a'.repeat(1025)))).toEqual({
      code: 'out_of_range',
      member: 'field-value',
    });
  });

  it('needs the field key of the list, which is a caller error when absent', () => {
    expect(() => listKeyInputs('field', { 'field-value': 'x' })).toThrow(TypeError);
  });

  it('probes under the list field key, or the one the probe names', () => {
    const expected = [{ keyKind: 'identifier-field', input: 'plan_id|gold' }];
    expect(listProbeKeyInputs('field', { 'field-value': 'Gold' }, OPTIONS)).toEqual(expected);
    expect(listProbeKeyInputs('field', { 'field-key': 'plan_id', 'field-value': 'Gold' })).toEqual(
      expected,
    );
  });
});

describe('a member that is absent or of the wrong type', () => {
  it.each<[KeyedListKind, string]>([
    ['string', 'value'],
    ['email-address', 'value'],
    ['ip-address', 'value'],
    ['browser-fingerprint', 'value'],
    ['country', 'country-code'],
    ['government-id-number', 'id-number'],
  ])('refuses %s without %s', (kind, member) => {
    expect(refusal(() => listKeyInputs(kind, {}))).toEqual({ code: 'invalid_value', member });
    expect(refusal(() => listKeyInputs(kind, { [member]: 7 }))).toEqual({
      code: 'invalid_value',
      member,
    });
  });

  it('refuses a phone item without a value as unparseable', () => {
    expect(refusal(() => listKeyInputs('phone-number', {}))).toEqual({
      code: 'unparseable_phone',
      member: 'value',
    });
  });
});

describe('a refusal echoes no value (C100.4)', () => {
  it('carries a code, in its message too', () => {
    const value = 'ana@example.com';
    try {
      listKeyInputs('email-address', { value, 'match-type': 'domain' });
      throw new Error('the value was accepted');
    } catch (error) {
      expect(error).toBeInstanceOf(ListKeyInputError);
      expect(String(error)).not.toContain('ana');
      expect((error as ListKeyInputError).message).toBe('invalid_value');
    }
  });
});
