/**
 * C98.2: the key inputs of a stored item and of a probe, per kind. The first key of an item is
 * `list_items.match_key`; the rest go to `list_item_keys`. Countries and geolocations match on a
 * plaintext column, and their key only dedups; a range matches on its `cidr` row, whose text is the
 * input of its `identifier-ip-range` key.
 */
import { ID_CLASSES } from '@openverify/core';
import type { KeyedListKind, ListKeyInput, ListKeyOptions, ListValue } from './key-input.js';
import {
  canonicalCountry,
  canonicalEmail,
  canonicalEmailDomain,
  canonicalFieldValue,
  canonicalFingerprint,
  canonicalGeolocation,
  canonicalIdNumber,
  canonicalIp,
  canonicalPhone,
  canonicalProbeAddress,
  canonicalString,
  checkedPoint,
  emailMatchType,
  idClassOf,
} from './normalise.js';

type KeysOf = (value: ListValue, options: ListKeyOptions) => ListKeyInput[];

const oneKey = (keyKind: ListKeyInput['keyKind'], input: string): ListKeyInput[] => [
  { keyKind, input },
];

const stringKeys: KeysOf = (value, options) =>
  oneKey('identifier-string', canonicalString(value, options['case-sensitive'] === true));

const phoneKeys: KeysOf = (value, options) =>
  oneKey('identifier-phone', canonicalPhone(value, options['default-region']));

const countryKeys: KeysOf = (value) => oneKey('identifier-country', canonicalCountry(value));

const browserKeys: KeysOf = (value) =>
  oneKey('identifier-browser-fingerprint', canonicalFingerprint(value));

const deviceKeys: KeysOf = (value) =>
  oneKey('identifier-device-fingerprint', canonicalFingerprint(value));

/** A list's key names its field; a probe may name it too (C99.4), and the list's wins. */
function fieldKeys(value: ListValue, options: ListKeyOptions): ListKeyInput[] {
  const fieldKey = options['field-key'] ?? value['field-key'];
  if (typeof fieldKey !== 'string') {
    throw new TypeError('A field key input needs the field-key of its list');
  }
  return oneKey('identifier-field', `${fieldKey}|${canonicalFieldValue(value)}`);
}

const ITEM_KEYS: Readonly<Record<KeyedListKind, KeysOf>> = {
  'browser-fingerprint': browserKeys,
  'device-fingerprint': deviceKeys,
  country: countryKeys,
  'email-address': (value) =>
    emailMatchType(value) === 'domain'
      ? oneKey('identifier-email-domain', canonicalEmailDomain(value))
      : oneKey('identifier-email', canonicalEmail(value).address),
  geolocation: (value) => oneKey('identifier-geolocation', canonicalGeolocation(value)),
  'government-id-number': (value) =>
    oneKey(
      'identifier-government-id-number',
      `${idClassOf(value) ?? '*'}|${canonicalIdNumber(value)}`,
    ),
  field: fieldKeys,
  'ip-address': (value) => {
    const { form, text } = canonicalIp(value);
    return oneKey(form === 'range' ? 'identifier-ip-range' : 'identifier-ip', text);
  },
  'phone-number': phoneKeys,
  string: stringKeys,
};

/** C98.2: `a.b.example`, then `b.example`, then `example`, one key per level. */
function domainWithParents(domain: string): ListKeyInput[] {
  const labels = domain.split('.');
  return labels.map((_, depth) => ({
    keyKind: 'identifier-email-domain',
    input: labels.slice(depth).join('.'),
  }));
}

const PROBE_KEYS: Readonly<Record<KeyedListKind, KeysOf>> = {
  'browser-fingerprint': browserKeys,
  'device-fingerprint': deviceKeys,
  country: countryKeys,
  'email-address': (value) => {
    const { address, domain } = canonicalEmail(value);
    return [...oneKey('identifier-email', address), ...domainWithParents(domain)];
  },
  // C99.2: a point matches through the box on the plaintext column, so it has no key.
  geolocation: (value) => {
    checkedPoint(value);
    return [];
  },
  // C98.2: `<class>|<n>` and `*|<n>`. A probe with no class sends every class too, because a stored
  // class it did not name is still a match, and "no match" for it would be false.
  'government-id-number': (value) => {
    const number = canonicalIdNumber(value);
    const idClass = idClassOf(value);
    const classes = idClass === null ? ['*', ...ID_CLASSES] : [idClass, '*'];
    return classes.map((name) => ({
      keyKind: 'identifier-government-id-number',
      input: `${name}|${number}`,
    }));
  },
  field: fieldKeys,
  'ip-address': (value) => oneKey('identifier-ip', canonicalProbeAddress(value)),
  'phone-number': phoneKeys,
  string: stringKeys,
};

/**
 * C98.2: the keys of a stored item. The first is `list_items.match_key`; the rest go to
 * `list_item_keys`.
 * @throws {ListKeyInputError} for a value the kind refuses.
 * @throws {TypeError} for a field item without its list's `field-key`.
 */
export function listKeyInputs(
  kind: KeyedListKind,
  item: ListValue,
  options: ListKeyOptions = {},
): ListKeyInput[] {
  return ITEM_KEYS[kind](item, options);
}

/**
 * C98.2: the keys a probe sends: an email's address, its domain and every parent; `<class>|<n>` and
 * `*|<n>` for an ID number, every class for a probe with none; none for a point. A phone probe's
 * national form needs the region of the list it reads, so a probe is keyed per list.
 * @throws {ListKeyInputError} for a value the kind refuses.
 * @throws {TypeError} for a field probe that names no `field-key`.
 */
export function listProbeKeyInputs(
  kind: KeyedListKind,
  probe: ListValue,
  options: ListKeyOptions = {},
): ListKeyInput[] {
  return PROBE_KEYS[kind](probe, options);
}
