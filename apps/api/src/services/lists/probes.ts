/**
 * C99.5 (Workflow 7B): the probes of a screening, kind by kind, in the table's order. A kind reads
 * its first source that holds a value, as C84.2 does; an email in the fields never hides behind a
 * confirmed destination, because the confirmed one comes first. Names are the exception, as in
 * C84.2: every differing name is screened, so a prefilled name never replaces the verified one.
 * The sessions are read one by one: each is a value of its own.
 *
 * An address a client could have chosen (`trust-all` in production) is left out and says so (P05).
 * A session that recorded an address and has no network row is a value nothing here could read.
 */
import type { ListKind } from '@openverify/core';
import {
  listInquirySessions,
  listSessionDevices,
  listSessionNetworks,
  type Db,
  type Inquiry,
  type InquirySession,
  type ListRow,
} from '@openverify/db';
import type { EnvironmentKind } from '../../ports.js';
import type { ListProbe } from './match.js';
import { readListSubject, textOf, type ListSubject } from './subject.js';

/** The first of `candidates` that holds a value, as one probe. */
function firstOf(
  kind: ListKind,
  member: string,
  candidates: readonly [ListProbe['source'], unknown][],
): ListProbe[] {
  for (const [source, value] of candidates) {
    if (textOf(value) !== null) {
      return [{ source, kind, values: [{ [member]: value }] }];
    }
  }
  return [];
}

function governmentIdProbes(subject: ListSubject): ListProbe[] {
  const { governmentId, databaseNumber } = subject;
  if (governmentId?.number != null) {
    return [
      {
        source: 'government-id.identification-number',
        kind: 'government-id-number',
        values: [
          {
            'id-number': governmentId.number,
            ...(governmentId.idClass === null ? {} : { 'id-class': governmentId.idClass }),
          },
        ],
      },
    ];
  }
  return databaseNumber === null
    ? []
    : [
        {
          source: 'database.input',
          kind: 'government-id-number',
          values: [{ 'id-number': databaseNumber }],
        },
      ];
}

/** C84.2: the verified name first, then a name of the fields that differs from it. */
function nameProbes(subject: ListSubject): ListProbe[] {
  const { governmentId, inquiryFields } = subject;
  const verified = { first: governmentId?.nameFirst ?? null, last: governmentId?.nameLast ?? null };
  const entered = {
    first: textOf(inquiryFields.name_first),
    last: textOf(inquiryFields.name_last),
  };
  const sameName = verified.first === entered.first && verified.last === entered.last;
  const probe = (source: ListProbe['source'], name: typeof verified): ListProbe[] =>
    name.first === null && name.last === null
      ? []
      : [
          {
            source,
            kind: 'name',
            values: [{ 'name-first': name.first ?? '', 'name-last': name.last ?? '' }],
          },
        ];
  return [
    ...probe('government-id.name', verified),
    ...(sameName ? [] : probe('inquiry.fields', entered)),
  ];
}

function fieldProbes(subject: ListSubject, lists: readonly ListRow[]): ListProbe[] {
  const keys = new Set(lists.flatMap(({ type, fieldKey }) => (type === 'field' ? [fieldKey] : [])));
  return [...keys].flatMap((key) => {
    const value = key === null ? undefined : subject.inquiryFields[key];
    return value === undefined || value === null || value === ''
      ? []
      : [
          {
            source: 'inquiry.fields' as const,
            kind: 'field' as const,
            values: [{ 'field-key': key, 'field-value': value }],
          },
        ];
  });
}

/** Every session of the inquiry, every page. */
async function sessionsOf(tx: Db, inquiry: Inquiry): Promise<InquirySession[]> {
  const sessions: InquirySession[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await listInquirySessions(tx, inquiry.environmentId, {
      inquiryId: inquiry.id,
      size: 100,
      after,
    });
    sessions.push(...page.items);
    if (page.next === null) {
      return sessions;
    }
    after = page.next;
  }
}

/** C99.5: what the sessions say: each address, IP country and IP city point, and fingerprint. */
async function sessionProbes(
  tx: Db,
  inquiry: Inquiry,
  environmentKind: EnvironmentKind,
): Promise<ListProbe[]> {
  const { environmentId } = inquiry;
  const sessions = await sessionsOf(tx, inquiry);
  const ids = sessions.map(({ id }) => id);
  const networks = new Map(
    (await listSessionNetworks(tx, environmentId, ids)).map((row) => [row.inquirySessionId, row]),
  );
  const probes: ListProbe[] = [];
  for (const session of sessions) {
    const network = networks.get(session.id);
    if (network === undefined) {
      if (session.ip !== null) {
        probes.push(
          { source: 'session.ip-address', kind: 'ip-address', values: [], unreadable: true },
          { source: 'session.ip-country', kind: 'country', values: [], unreadable: true },
          { source: 'session.ip-point', kind: 'geolocation', values: [], unreadable: true },
        );
      }
      continue;
    }
    if (network.clientAddressSource === 'trust-all' && environmentKind === 'production') {
      probes.push(
        { source: 'session.ip-address', kind: 'ip-address', values: [], untrusted: true },
        { source: 'session.ip-country', kind: 'country', values: [], untrusted: true },
        { source: 'session.ip-point', kind: 'geolocation', values: [], untrusted: true },
      );
      continue;
    }
    if (network.ip !== null) {
      probes.push({
        source: 'session.ip-address',
        kind: 'ip-address',
        values: [{ value: network.ip }],
      });
    }
    if (session.countryCode !== null) {
      probes.push({
        source: 'session.ip-country',
        kind: 'country',
        values: [{ 'country-code': session.countryCode }],
      });
    }
    const point = session.location;
    if (point?.latitude != null && point.longitude != null) {
      probes.push({
        source: 'session.ip-point',
        kind: 'geolocation',
        values: [{ latitude: point.latitude, longitude: point.longitude }],
      });
    }
  }
  for (const { device } of await listSessionDevices(tx, environmentId, ids)) {
    if (device.browserFingerprint !== null) {
      probes.push({
        source: 'session.browser-fingerprint',
        kind: 'browser-fingerprint',
        values: [{ value: device.browserFingerprint }],
      });
    }
    // C99.5 (V10): the web device class is shared by many people and is never a probe.
    if (device.deviceFingerprint !== null) {
      probes.push({
        source: 'session.device-fingerprint',
        kind: 'device-fingerprint',
        values: [{ value: device.deviceFingerprint }],
      });
    }
  }
  return probes;
}

/** C99.5: the probes of the inquiry for the selected `lists`. */
export async function screeningProbes(
  tx: Db,
  inquiry: Inquiry,
  lists: readonly ListRow[],
  environmentKind: EnvironmentKind,
): Promise<ListProbe[]> {
  const subject = await readListSubject(tx, inquiry);
  const { inquiryFields: fields, accountFields: account } = subject;
  const country = subject.governmentId?.country ?? null;
  return [
    ...firstOf('email-address', 'value', [
      ['otp.email-address', subject.email],
      ['inquiry.fields', fields.email_address],
      ['account.fields', account.email_address],
    ]),
    ...firstOf('phone-number', 'value', [
      ['otp.phone-number', subject.phone],
      ['inquiry.fields', fields.phone_number],
      ['account.fields', account.phone_number],
    ]),
    ...governmentIdProbes(subject),
    ...nameProbes(subject),
    ...(country === null
      ? []
      : [
          {
            source: 'government-id.issuing-country' as const,
            kind: 'country' as const,
            values: [{ 'country-code': country }],
          },
        ]),
    ...firstOf('country', 'country-code', [['inquiry.fields', fields.address_country_code]]),
    ...fieldProbes(subject, lists),
    ...(await sessionProbes(tx, inquiry, environmentKind)),
  ];
}
