/**
 * Phase 11, Workflow 11A Stage 1a, the (K) checkpoint (C236-C238): the consent record with its
 * routes, the three share-consent exits of the flow API with the session's one new member, the
 * inquiry create's `meta.share-token-id`, and the Connect publish codes. Everything is read through
 * the package root, so the export lines are held too.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as contracts from './index.js';
import { readFixture } from './test-support.js';

const pick = (name: string): unknown => (contracts as Readonly<Record<string, unknown>>)[name];
const schema = (name: string): z.ZodType => {
  const found = pick(name);
  if (!(found instanceof z.ZodType)) {
    throw new TypeError(`${name} is not exported as a schema`);
  }
  return found;
};
type Json = Record<string, unknown>;
const clone = <T>(value: T): T => structuredClone(value);
const attributesOf = (document: unknown): Json =>
  (document as { data: { attributes: Json } }).data.attributes;
const withAttributes = (document: unknown, change: (attributes: Json) => void): unknown => {
  const copy = clone(document);
  change(attributesOf(copy));
  return copy;
};

describe('the consent record (C236.1, C236.11)', () => {
  it.each([
    'consent-record-source-flow.json',
    'consent-record-destination-attested.json',
    'consent-record-declined.json',
    'consent-record-withdrawn.json',
  ])('reads api/connect/%s', (name) => {
    expect(
      contracts.consentRecordDocumentSchema.safeParse(readFixture(`api/connect/${name}`)).success,
    ).toBe(true);
  });

  it.each([
    ['a witnessed attestation', (attributes: Json) => (attributes.witnessed = true)],
    [
      'a declined attestation',
      (attributes: Json) => {
        attributes.outcome = 'declined';
        attributes.status = 'declined';
      },
    ],
    [
      'a withdrawal without its channel',
      (attributes: Json) => (attributes['withdrawn-at'] = '2026-10-21T08:00:00.000Z'),
    ],
  ])('refuses %s', (_name, change) => {
    const document = withAttributes(
      readFixture('api/connect/consent-record-destination-attested.json'),
      change,
    );
    expect(contracts.consentRecordDocumentSchema.safeParse(document).success).toBe(false);
  });

  it('keeps a declined record declined whatever else happened to it (review H27)', () => {
    const document = withAttributes(
      readFixture('api/connect/consent-record-declined.json'),
      (attributes) => {
        attributes.status = 'expired';
      },
    );
    expect(contracts.consentRecordDocumentSchema.safeParse(document).success).toBe(false);
  });
});

describe('the consent-record routes (C236.2, C236.5, C237.1)', () => {
  it.each(['consent-record-attest-source.json', 'consent-record-attest-destination.json'])(
    'attests with api/connect/%s',
    (name) => {
      expect(
        schema('attestConsentRecordBodySchema').safeParse(readFixture(`api/connect/${name}`))
          .success,
      ).toBe(true);
    },
  );

  it.each([
    [
      'a source side without its subject',
      'consent-record-attest-source.json',
      (a: Json) => delete a['subject-id'],
    ],
    [
      'a source side naming a token',
      'consent-record-attest-source.json',
      (a: Json) => (a['share-token-id'] = 'cnst_01M5CN0000000000000011A200'),
    ],
    [
      'a destination side without its token',
      'consent-record-attest-destination.json',
      (a: Json) => delete a['share-token-id'],
    ],
    [
      'a verification as the subject',
      'consent-record-attest-source.json',
      (a: Json) => (a['subject-id'] = 'ver_01M5CK16P0D13FXHZSS4TCFBVH'),
    ],
    ['no category', 'consent-record-attest-source.json', (a: Json) => (a['data-categories'] = [])],
    [
      'an empty evidence reference',
      'consent-record-attest-source.json',
      (a: Json) => (a['evidence-reference'] = ''),
    ],
    [
      'a reference over 500 characters',
      'consent-record-attest-source.json',
      (a: Json) => (a['evidence-reference'] = 'x'.repeat(501)),
    ],
    ['no text', 'consent-record-attest-source.json', (a: Json) => delete a['text-body']],
    [
      'a text over 20,000 characters',
      'consent-record-attest-source.json',
      (a: Json) => (a['text-body'] = 'x'.repeat(20_001)),
    ],
    [
      'a validity under 60 seconds',
      'consent-record-attest-source.json',
      (a: Json) => (a['expires-in-seconds'] = 59),
    ],
    ['a method member', 'consent-record-attest-source.json', (a: Json) => (a.method = 'flow')],
  ])('refuses %s', (_name, file, change) => {
    const body = withAttributes(readFixture(`api/connect/${file}`), change);
    expect(schema('attestConsentRecordBodySchema').safeParse(body).success).toBe(false);
  });

  it('withdraws with an optional reason from the closed list', () => {
    const withdraw = schema('withdrawConsentRecordBodySchema');
    expect(
      withdraw.safeParse(readFixture('api/connect/consent-record-withdraw.json')).success,
    ).toBe(true);
    expect(withdraw.safeParse({ data: { attributes: {} } }).success).toBe(true);
    expect(
      withdraw.safeParse({ data: { attributes: { 'withdrawal-reason': 'changed-mind' } } }).success,
    ).toBe(false);
  });

  it('lists by subject, side, status and connection', () => {
    const list = schema('listConsentRecordsQuerySchema');
    expect(
      list.safeParse({
        'filter[subject-id]': 'inq_01M5CJXHG07XPHF3HRM6NREDH7',
        'filter[side]': 'source',
        'filter[status]': 'active,withdrawn',
        'filter[connection-id]': 'cxn_01M5CN0000000000000011A100',
      }).success,
    ).toBe(true);
    expect(list.safeParse({ 'filter[status]': 'pending' }).success).toBe(false);
    expect(
      schema('consentRecordParamsSchema').safeParse({ id: 'cnsr_01M5CN0000000000000011A300' })
        .success,
    ).toBe(true);
  });
});

describe('the share-consent exits of the flow API (C238.4, C237.6)', () => {
  it('accepts with the digests of what was shown and the biometric tick', () => {
    const accept = schema('flowShareConsentAcceptBodySchema');
    expect(
      accept.safeParse(readFixture('api/connect/flow-share-consent-accept.json')).success,
    ).toBe(true);
    expect(
      accept.safeParse({ 'text-sha256': 'a'.repeat(64), 'explicit-biometric': false }).success,
    ).toBe(true);
    for (const body of [
      { 'explicit-biometric': false },
      { 'text-sha256': 'A'.repeat(64), 'explicit-biometric': false },
      { 'text-sha256': 'a'.repeat(64) },
      {
        'text-sha256': 'a'.repeat(64),
        'explicit-biometric': false,
        'share-token-id': 'cnst_01M5CN0000000000000011A200',
      },
    ]) {
      expect(accept.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });

  it('declines and withdraws with an empty body', () => {
    for (const name of [
      'flowShareConsentDeclineBodySchema',
      'flowShareConsentWithdrawBodySchema',
    ]) {
      expect(schema(name).safeParse({}).success, name).toBe(true);
      expect(schema(name).safeParse({ reason: 'x' }).success, name).toBe(false);
    }
    expect(
      schema('flowShareConsentDeclineBodySchema').parse(
        readFixture('api/connect/flow-share-consent-decline.json'),
      ),
    ).toEqual({});
    expect(
      schema('flowShareConsentWithdrawBodySchema').parse(
        readFixture('api/connect/flow-share-consent-withdraw.json'),
      ),
    ).toEqual({});
  });

  it('takes the step id in the path, as the screen exit does', () => {
    expect(schema('flowShareConsentParamsSchema').parse({ stepId: 'share-consent-1' })).toEqual({
      stepId: 'share-consent-1',
    });
  });

  it('serves the session at a share_consent step with the withdrawable consents, and nothing else new (V02)', () => {
    const session = contracts.flowSessionResponseSchema.parse(
      readFixture('api/flow-session-share-consent.json'),
    );
    expect(session.step).toMatchObject({
      type: 'share_consent',
      side: 'source',
      recipientName: 'Example Partner',
    });
    expect((session as Json)['withdrawable-share-consents']).toEqual([
      { 'step-id': 'share-consent-0', side: 'source', 'recipient-name': 'Example Partner' },
    ]);
    const extra = {
      ...(readFixture('api/flow-session-share-consent.json') as Json),
      'share-tokens': [],
    };
    expect(contracts.flowSessionResponseSchema.safeParse(extra).success).toBe(false);
  });

  it('never serves a token, a connection or a source id in a withdrawable entry (C238.5)', () => {
    const session = clone(readFixture('api/flow-session-share-consent.json')) as Json;
    session['withdrawable-share-consents'] = [
      {
        'step-id': 'share-consent-0',
        side: 'source',
        'recipient-name': 'Example Partner',
        'share-token-id': 'cnst_01M5CN0000000000000011A200',
      },
    ];
    expect(contracts.flowSessionResponseSchema.safeParse(session).success).toBe(false);
  });
});

describe('client-side redemption starts from the inquiry create (C238.5)', () => {
  it('takes meta.share-token-id, a cnst_ id, and only in meta', () => {
    expect(
      contracts.createInquiryBodySchema.safeParse(
        readFixture('api/connect/inquiry-create-share-token.json'),
      ).success,
    ).toBe(true);
    expect(
      contracts.createInquiryMetaSchema.safeParse({
        'share-token-id': 'cxn_01M5CN0000000000000011A100',
      }).success,
    ).toBe(false);
    const inAttributes = withAttributes(
      readFixture('api/connect/inquiry-create-share-token.json'),
      (attributes) => {
        attributes['share-token-id'] = 'cnst_01M5CN0000000000000011A200';
      },
    );
    expect(contracts.createInquiryBodySchema.safeParse(inAttributes).success).toBe(false);
  });
});

describe('the Connect publish codes (C238.2; V06, V09)', () => {
  const CODES = [
    'cloned_results_without_binding',
    'share_consent_connection_invalid',
    'share_consent_after_completion',
    'share_consent_after_cloned_step',
    'share_consent_connect_disabled',
    'share_consent_withdrawal_contact_missing',
    'share_consent_retention_missing',
  ];

  it('freezes every rule code and the one warning', () => {
    expect([...contracts.CONNECT_PUBLISH_RULE_CODES].sort()).toEqual([...CODES].sort());
    expect(pick('CONNECT_PUBLISH_WARNING_CODES')).toEqual(['share_consent_connection_not_active']);
  });

  it('holds a golden definition_invalid with every share_consent code', () => {
    const raw = readFixture('problems/connect-publish/definition-invalid-share-consent.json') as {
      errors: { code: string }[];
    };
    expect(contracts.problemSchema.parse(raw)).toEqual(raw);
    expect(raw.errors.map(({ code }) => code).sort()).toEqual(
      CODES.filter((code) => code.startsWith('share_consent_')).sort(),
    );
  });
});
