/**
 * C101.2, C101.3 (Workflow 7B; V09, P05): what an account and an inquiry hold that the graph links
 * on, keyed. The indexer, the `graph-index` job, the backfill, the rebuild and the audited unmask
 * all read through here, so a row and its unmask come from one rule.
 *
 * - An account (source `account`): its reference id (`reference_id`) and its typed fields
 *   (`*_unconfirmed`, `name_birthdate`, `address`, and the weak `name`, `birthdate`,
 *   `postal_code`, `email_domain`).
 * - An inquiry (source `inquiry`): its typed fields, the same way.
 * - Its verifications (source `verification`), a rejected handoff's left out (C96.3), a failed one
 *   kept (decision 49): a government ID's extraction (the C31.8 index, the name, birthdate and
 *   address read), a chip's indexes, a passed OTP verification's confirmed destination (the strong
 *   `email_address` and `phone_number`), a passed wallet's address index.
 * - Its sessions (source `inquiry-session`): the device HMACs, which exist only under the
 *   device-recognition tier, keyed only when made under the current key (a rotated device is never
 *   compared, C94.4); and the evaluated address, never for a `trust-all` address in production,
 *   a relay, or a non-global or documentation range outside a sandbox (P05).
 *
 * Weak kinds only with `graph-weak-kinds` on. `display` is what the unmask answers; nothing here
 * logs or leaves the process otherwise.
 */
import type { GraphKind } from '@openverify/core';
import {
  blindIndexKeyId,
  getChipRead,
  listCryptoChallenges,
  listGovernmentIdExtractions,
  listInquirySessions,
  listInquiryVerifications,
  listSessionDevices,
  listSessionNetworks,
  type Db,
  type Inquiry,
  type Network,
  type VerificationWithChecks,
} from '@openverify/db';
import { parseAddress } from '@openverify/signals/address';
import { classifyAddress } from '@openverify/signals/network';
import { loadVerificationAttributes } from '../attributes/index.js';
import type { GraphIndexSource } from './indexing.js';
import { graphValueKeys, type GraphPlainValue } from './keys.js';
import { writesGraphKind, type GraphSettings } from './settings.js';

/** One keyed value and where it came from. */
export interface GraphValue {
  kind: GraphKind;
  valueKey: string;
  keyId: string;
  source: GraphIndexSource;
  /** The plaintext the audited unmask answers; `null` for a value with none (a chip signature). */
  display: string | null;
  /** The value as keyed: a text, or a list item's members (a name, an address). */
  plain: GraphPlainValue | null;
}

type Values = Readonly<Record<string, unknown>>;

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

const asValues = (value: unknown): Values =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Values) : {};

/** A plaintext value before keying. */
interface Plain {
  kind: GraphKind;
  value: GraphPlainValue;
  display: string;
}

const ADDRESS_MEMBERS = [
  'address-street-1',
  'address-street-2',
  'address-city',
  'address-subdivision',
  'address-postal-code',
  'address-country-code',
] as const;

/**
 * The values of a person's fields: `snake` for an inquiry's and an account's `fields`
 * (`email_address`), hyphenated for an extraction's (`name-first`).
 */
function fieldValues(fields: Values, snake: boolean, typed: boolean): Plain[] {
  const read = (name: string) => text(fields[snake ? name.replaceAll('-', '_') : name]);
  const plain: Plain[] = [];
  const first = read('name-first');
  const last = read('name-last');
  const birthdate = read('birthdate');
  if (first !== null && last !== null) {
    const name = { 'name-first': first, 'name-last': last };
    plain.push({ kind: 'name', value: name, display: `${first} ${last}` });
    if (birthdate !== null) {
      plain.push({
        kind: 'name_birthdate',
        value: { ...name, birthdate },
        display: `${first} ${last}, ${birthdate}`,
      });
    }
  }
  if (birthdate !== null) {
    plain.push({ kind: 'birthdate', value: birthdate, display: birthdate });
  }
  const address = Object.fromEntries(
    ADDRESS_MEMBERS.flatMap((member) => {
      const value = read(member);
      return value === null ? [] : [[member, value]];
    }),
  );
  if (Object.keys(address).length > 0) {
    plain.push({
      kind: 'address',
      value: address,
      display: ADDRESS_MEMBERS.flatMap((member) => address[member] ?? []).join(', '),
    });
  }
  const postal = read('address-postal-code');
  if (postal !== null) {
    plain.push({ kind: 'postal_code', value: postal, display: postal });
  }
  if (typed) {
    const email = read('email-address');
    if (email !== null) {
      plain.push({ kind: 'email_address_unconfirmed', value: email, display: email });
      plain.push({ kind: 'email_domain', value: email, display: email.split('@').at(-1) ?? email });
    }
    const phone = read('phone-number');
    if (phone !== null) {
      const region = read('address-country-code');
      plain.push({
        kind: 'phone_number_unconfirmed',
        value: region === null ? phone : { value: phone, 'default-region': region },
        display: phone,
      });
    }
  }
  return plain;
}

/** Keys the plaintext values, the kinds the settings write only, one row per key. */
function keyed(
  key: Uint8Array,
  environmentId: string,
  settings: GraphSettings,
  source: GraphIndexSource,
  plain: readonly Plain[],
): GraphValue[] {
  return plain
    .filter(({ kind }) => writesGraphKind(settings, kind))
    .flatMap(({ kind, value, display }) =>
      graphValueKeys(key, environmentId, kind, value).map(({ valueKey, keyId }) => ({
        kind,
        valueKey,
        keyId,
        source,
        display,
        plain: value,
      })),
    );
}

/** An account's own values: its reference id and its fields (source `account`). */
export function accountGraphValues(
  key: Uint8Array,
  environmentId: string,
  settings: GraphSettings,
  account: { id: string; referenceId: string | null; fields: unknown },
): GraphValue[] {
  const plain = fieldValues(asValues(account.fields), true, true);
  if (account.referenceId !== null && account.referenceId !== '') {
    plain.unshift({
      kind: 'reference_id',
      value: account.referenceId,
      display: account.referenceId,
    });
  }
  return keyed(key, environmentId, settings, { type: 'account', id: account.id }, plain);
}

/** A value under an existing index (C31.8, C53), made under the current key. */
function indexed(
  key: Uint8Array,
  settings: GraphSettings,
  kind: GraphKind,
  valueKey: string | null,
  source: GraphIndexSource,
  display: string | null,
): GraphValue[] {
  return valueKey === null || !writesGraphKind(settings, kind)
    ? []
    : [{ kind, valueKey, keyId: blindIndexKeyId(key), source, display, plain: display }];
}

async function verificationValues(
  db: Db,
  key: Uint8Array,
  settings: GraphSettings,
  inquiry: Inquiry,
  verification: VerificationWithChecks,
): Promise<GraphValue[]> {
  const { environmentId } = inquiry;
  const source: GraphIndexSource = {
    type: 'verification',
    id: verification.id,
    inquiryId: inquiry.id,
  };
  switch (verification.type) {
    case 'government_id': {
      const extraction = (
        await listGovernmentIdExtractions(db, environmentId, [verification.id])
      ).get(verification.id);
      if (extraction === undefined || extraction.fields === null) {
        return [];
      }
      const fields = asValues(extraction.fields);
      return [
        ...indexed(
          key,
          settings,
          'government_id_number',
          extraction.identificationNumberIndex,
          source,
          text(fields['identification-number']),
        ),
        ...keyed(key, environmentId, settings, source, fieldValues(fields, false, false)),
      ];
    }
    case 'government_id_nfc': {
      const read = await getChipRead(db, environmentId, verification.id);
      if (read?.redactedAt !== null) {
        return [];
      }
      return [
        ...indexed(key, settings, 'chip_signature', read.sodSignatureIndex, source, null),
        ...indexed(key, settings, 'government_id_number', read.documentNumberIndex, source, null),
      ];
    }
    case 'email_address':
    case 'phone_number': {
      if (verification.status !== 'passed') {
        return [];
      }
      const attributes = asValues(await loadVerificationAttributes(db, verification));
      const member = verification.type === 'email_address' ? 'email-address' : 'phone-number';
      const destination = text(attributes[member]);
      if (attributes['confirmed-at'] == null || destination === null) {
        return [];
      }
      const plain: Plain[] =
        verification.type === 'email_address'
          ? [
              { kind: 'email_address', value: destination, display: destination },
              {
                kind: 'email_domain',
                value: destination,
                display: destination.split('@').at(-1) ?? destination,
              },
            ]
          : [{ kind: 'phone_number', value: destination, display: destination }];
      return keyed(key, environmentId, settings, source, plain);
    }
    case 'crypto_wallet': {
      if (verification.status !== 'passed') {
        return [];
      }
      const [challenge] = (await listCryptoChallenges(db, environmentId, verification.id)).filter(
        (candidate) => candidate.addressIndex !== null,
      );
      const attributes = asValues(await loadVerificationAttributes(db, verification));
      return indexed(
        key,
        settings,
        'crypto_address',
        challenge?.addressIndex ?? null,
        source,
        text(attributes['wallet-address']),
      );
    }
    default:
      return [];
  }
}

/**
 * P05: whether a session's evaluated address may be a graph row: never a `trust-all` address in
 * production, a relay, or a non-global or documentation range outside a sandbox.
 */
export function addressIndexable(network: Network, settings: GraphSettings): boolean {
  if (network.ip === null) {
    return false;
  }
  if (settings.sandbox) {
    return true;
  }
  const parsed = parseAddress(network.ip);
  return (
    network.clientAddressSource !== 'trust-all' &&
    network.privacyRelay !== true &&
    parsed !== null &&
    classifyAddress(parsed) === 'public'
  );
}

/** A session's evaluated address, when P05 allows it (source `inquiry-session`). */
export function sessionAddressValues(
  key: Uint8Array,
  environmentId: string,
  settings: GraphSettings,
  network: Network,
  source: GraphIndexSource,
): GraphValue[] {
  if (network.ip === null || !addressIndexable(network, settings)) {
    return [];
  }
  return keyed(key, environmentId, settings, source, [
    { kind: 'ip_address', value: network.ip, display: network.ip },
  ]);
}

const SESSION_PAGE = 100;

async function sessionValues(
  db: Db,
  key: Uint8Array,
  settings: GraphSettings,
  inquiry: Inquiry,
): Promise<GraphValue[]> {
  const { environmentId } = inquiry;
  const sessionIds: string[] = [];
  let after: string | undefined;
  do {
    const page = await listInquirySessions(db, environmentId, {
      inquiryId: inquiry.id,
      size: SESSION_PAGE,
      after,
    });
    sessionIds.push(...page.items.map(({ id }) => id));
    after = page.next ?? undefined;
  } while (after !== undefined);
  const keyId = blindIndexKeyId(key);
  const values: GraphValue[] = [];
  for (const { inquirySessionId, device } of await listSessionDevices(
    db,
    environmentId,
    sessionIds,
  )) {
    if (device.keyId !== keyId) {
      continue;
    }
    const source: GraphIndexSource = {
      type: 'inquiry-session',
      id: inquirySessionId,
      inquiryId: inquiry.id,
    };
    const hmacs: [GraphKind, string | null][] = [
      ['device_fingerprint', device.deviceFingerprint],
      ['device_class', device.deviceClass],
      ['browser_fingerprint', device.browserFingerprint],
    ];
    for (const [kind, hmac] of hmacs) {
      if (hmac !== null) {
        values.push(
          ...keyed(key, environmentId, settings, source, [{ kind, value: hmac, display: hmac }]),
        );
      }
    }
  }
  for (const network of await listSessionNetworks(db, environmentId, sessionIds)) {
    values.push(
      ...sessionAddressValues(key, environmentId, settings, network, {
        type: 'inquiry-session',
        id: network.inquirySessionId,
        inquiryId: inquiry.id,
      }),
    );
  }
  return values;
}

/** Everything an inquiry holds that the graph links on (its account's own values aside). */
export async function inquiryGraphValues(
  db: Db,
  key: Uint8Array,
  settings: GraphSettings,
  inquiry: Inquiry,
): Promise<GraphValue[]> {
  if (!settings.indexing || inquiry.redactedAt !== null) {
    return [];
  }
  const { environmentId } = inquiry;
  const values = keyed(
    key,
    environmentId,
    settings,
    { type: 'inquiry', id: inquiry.id },
    fieldValues(asValues(inquiry.fields), true, true),
  );
  const verifications = (await listInquiryVerifications(db, environmentId, inquiry.id)).filter(
    ({ fromRejectedHandoff }) => !fromRejectedHandoff,
  );
  for (const verification of verifications) {
    values.push(...(await verificationValues(db, key, settings, inquiry, verification)));
  }
  values.push(...(await sessionValues(db, key, settings, inquiry)));
  return values;
}
