/**
 * C101.2: the key inputs of the graph kinds this folder keys. The labels the graph shares with the
 * lists take the list's input (decision 29, narrowed), so a list hit and a graph link meet on one
 * key. `government_id_number`, `chip_signature` and `crypto_address` keep their existing indexes,
 * and `name_birthdate` and `name` are `packages/watchlist/src/list-keys/`'s, so none has a key here.
 */
import type { GraphKind } from '@openverify/core';
import { canonicalPostalCode } from '../matching/postal-codes.js';
import { freeMailProviderOf } from '../reports/email/tables.js';
import { addressKeyInput } from './address-key.js';
import { ListKeyInputError, type GraphKeyInput, type ListValue } from './key-input.js';
import {
  canonicalEmail,
  canonicalFingerprint,
  canonicalPhone,
  canonicalProbeAddress,
  domainOf,
  textMember,
} from './normalise.js';

type GraphKeyOf = (value: ListValue) => GraphKeyInput;

const emailKey: GraphKeyOf = (value) => ({
  keyKind: 'identifier-email',
  input: canonicalEmail(value).address,
});

const phoneKey: GraphKeyOf = (value) => {
  const region = value['default-region'];
  return {
    keyKind: 'identifier-phone',
    input: canonicalPhone(value, typeof region === 'string' ? region : null),
  };
};

const deviceKey: GraphKeyOf = (value) => ({
  keyKind: 'identifier-device-fingerprint',
  input: canonicalFingerprint(value),
});

/** A reference id is opaque and unique as written, so it is keyed as the account holds it. */
const referenceKey: GraphKeyOf = (value) => {
  const input = textMember(value, 'value');
  if (input.trim() === '') {
    throw new ListKeyInputError('invalid_value', 'value');
  }
  return { keyKind: 'identifier-reference-id', input };
};

/** `YYYY-MM-DD`, a day of the calendar. */
const birthdateKey: GraphKeyOf = (value) => {
  const input = textMember(value, 'value').trim();
  const day = /^\d{4}-\d{2}-\d{2}$/u.test(input) ? new Date(`${input}T00:00:00Z`) : null;
  if (day === null || Number.isNaN(day.getTime()) || !day.toISOString().startsWith(input)) {
    throw new ListKeyInputError('invalid_value', 'value');
  }
  return { keyKind: 'identifier-birthdate', input };
};

/** The bare code: a parameter carries no country, and the kind is weak. */
const postalKey: GraphKeyOf = (value) => {
  const input = canonicalPostalCode(textMember(value, 'value'));
  if (input === '') {
    throw new ListKeyInputError('invalid_value', 'value');
  }
  return { keyKind: 'identifier-postal-code', input };
};

/** C101.2: a free-mail domain links strangers, so it has no key and nothing can be written. */
const emailDomainKey: GraphKeyOf = (value) => {
  const input = domainOf(value);
  if (freeMailProviderOf(input) !== null) {
    throw new ListKeyInputError('invalid_value', 'value');
  }
  return { keyKind: 'identifier-email-domain', input };
};

const GRAPH_KEYS: Readonly<Partial<Record<GraphKind, GraphKeyOf>>> = {
  email_address: emailKey,
  email_address_unconfirmed: emailKey,
  phone_number: phoneKey,
  phone_number_unconfirmed: phoneKey,
  reference_id: referenceKey,
  address: addressKeyInput,
  device_fingerprint: deviceKey,
  // Stage 1a amendment 3: the device label; the `kind` column keeps the rows apart.
  device_class: deviceKey,
  browser_fingerprint: (value) => ({
    keyKind: 'identifier-browser-fingerprint',
    input: canonicalFingerprint(value),
  }),
  ip_address: (value) => ({ keyKind: 'identifier-ip', input: canonicalProbeAddress(value) }),
  birthdate: birthdateKey,
  postal_code: postalKey,
  email_domain: emailDomainKey,
};

/**
 * C101.2: the key input of a graph kind this folder keys, from `{ value }`, a phone's optional
 * `default-region`, or an address under its `address-*` members.
 * @throws {ListKeyInputError} for a value the kind refuses. The indexer writes no row for it.
 * @throws {TypeError} for a kind with no key here.
 */
export function graphKeyInput(kind: GraphKind, value: ListValue): GraphKeyInput {
  const keyOf = GRAPH_KEYS[kind];
  if (keyOf === undefined) {
    throw new TypeError(`The graph kind ${kind} is not keyed in packages/checks`);
  }
  return keyOf(value);
}
