/**
 * C236.1, C236.4, C236.11 (Workflow 11A, `api-consent` checkpoint 1): the resource of a record, and
 * the `flow` records the `share_consent` step makes. An accepted record stores its texts once per
 * digest and keeps the sealed address and user agent; a decline keeps neither, nor a text copy
 * beyond the digest, and is served `declined` whatever happens to it; the evidence matches the
 * method; the PII members are served only with `pii:view` and never on a decline; the events are
 * `consent-record.created` and `.declined`, valid under the contract. Every value is synthetic.
 */
import { buildEventResource, consentRecordResourceSchema, newId } from '@openverify/contracts';
import { getConsentText, getConsentRecord } from '@openverify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInquiry, createTestApi, type TestApi } from '../../test-support/harness.js';
import {
  consentBodyDigest,
  consentRecordResource,
  recordFlowConsentInTx,
  servedConsentRecord,
  type FlowConsentInput,
} from './consent.js';
import { seedConnection } from './consent.test-support.js';

let api: TestApi;
let connection: { id: string; policyId: string };
let recipient: string;

beforeAll(async () => {
  api = await createTestApi({ connect: { enabled: true } });
  recipient = (await api.newTenant()).organizationId;
  connection = await seedConnection(api.database.db, {
    sourceOrganizationId: api.organizationId,
    destinationOrganizationId: recipient,
  });
});

afterAll(async () => {
  await api.close();
});

const TEXT = 'Example Source shares your verification with Example Partner.';
const BIOMETRIC = 'Example Source shares your face images with Example Partner.';

const input = (inquiryId: string, overrides: Partial<FlowConsentInput> = {}): FlowConsentInput => ({
  environmentId: api.environmentId,
  side: 'source',
  outcome: 'accepted',
  inquiryId,
  sessionId: newId('iqse'),
  connectionId: connection.id,
  shareTokenId: null,
  recipientOrganizationId: recipient,
  recipientName: 'Example Partner',
  categories: ['identity-fields', 'biometric', 'check-results'],
  explicitBiometric: true,
  text: {
    locale: 'en',
    keys: ['share.consent.source'],
    sha256: consentBodyDigest(TEXT),
    body: TEXT,
  },
  biometric: { sha256: consentBodyDigest(BIOMETRIC), body: BIOMETRIC },
  ip: '192.0.2.44',
  userAgent: 'synthetic-browser/2.0',
  validSeconds: 1_209_600,
  now: api.clock.now(),
  ...overrides,
});

const record = async (overrides: Partial<FlowConsentInput> = {}) => {
  const inquiryId = await createInquiry(api);
  const { record: created, staged } = await api.database.db.transaction((tx) =>
    recordFlowConsentInTx(tx, api.deps, input(inquiryId, overrides)),
  );
  await api.deps.events.dispatch([staged]);
  return { created, inquiryId };
};

describe('a flow record accepted in the share_consent step (C236.4)', () => {
  it('keeps the session, the time, the sealed address and user agent, and both texts by digest', async () => {
    const { created, inquiryId } = await record();
    const stored = await getConsentRecord(api.database.db, api.environmentId, created.id);
    expect(stored).toMatchObject({
      method: 'flow',
      outcome: 'accepted',
      subjectType: 'inquiry',
      subjectId: inquiryId,
      evidenceIp: '192.0.2.44',
      evidenceUserAgent: 'synthetic-browser/2.0',
      biometricTextSha256: consentBodyDigest(BIOMETRIC),
      explicitBiometric: true,
    });
    expect(stored?.expiresAt.getTime()).toBe(api.clock.now().getTime() + 1_209_600_000);
    expect(
      (await getConsentText(api.database.db, api.environmentId, consentBodyDigest(TEXT)))?.body,
    ).toBe(TEXT);
    expect(
      (await getConsentText(api.database.db, api.environmentId, consentBodyDigest(BIOMETRIC)))
        ?.body,
    ).toBe(BIOMETRIC);

    const event = api.events.named('consent-record.created').at(-1);
    expect(() =>
      buildEventResource({
        id: newId('evt'),
        name: 'consent-record.created',
        payload: event?.payload as never,
        createdAt: new Date(),
      }),
    ).not.toThrow();
    expect(JSON.stringify(event?.payload)).not.toContain('192.0.2.44');
  });

  it('serves the evidence, and the PII members only with pii:view', async () => {
    const { created } = await record();
    const now = api.clock.now();
    const visible = consentRecordResourceSchema.parse(
      consentRecordResource(await servedConsentRecord(api.database.db, created, true), {
        pii: true,
        now,
      }),
    );
    expect(visible.attributes).toMatchObject({
      witnessed: true,
      evidence: {
        'session-id': created.sessionId,
        'accepted-at': now.toISOString(),
        'declined-at': null,
      },
      'ip-address': '192.0.2.44',
      'user-agent': 'synthetic-browser/2.0',
      'text-body': TEXT,
      'evidence-reference': null,
    });
    const masked = consentRecordResource(
      await servedConsentRecord(api.database.db, created, false),
      { pii: false, now },
    );
    expect(masked.attributes).toMatchObject({
      'ip-address': null,
      'user-agent': null,
      'text-body': null,
    });
  });
});

describe('a decline (C236.11)', () => {
  it('keeps the session and the time only, and is declined whatever else happens', async () => {
    const { created } = await record({ outcome: 'declined' });
    expect(created).toMatchObject({
      outcome: 'declined',
      evidenceIp: null,
      evidenceUserAgent: null,
      acceptedAt: null,
      biometricTextSha256: null,
      explicitBiometric: false,
    });
    const now = api.clock.now();
    const served = consentRecordResourceSchema.parse(
      consentRecordResource(await servedConsentRecord(api.database.db, created, true), {
        pii: true,
        now: new Date(now.getTime() + 30 * 86_400_000),
      }),
    );
    expect(served.attributes).toMatchObject({
      status: 'declined',
      evidence: { 'session-id': created.sessionId, 'accepted-at': null },
      'ip-address': null,
      'text-body': null,
    });
    expect(served.relationships['share-token'].data).toBeNull();
    expect(api.events.named('consent-record.declined').at(-1)?.environmentId).toBe(
      api.environmentId,
    );
  });
});

describe('the subject relationship (C236.1, C236.10)', () => {
  it('names a token subject as a share token and a verification by its resource type', () => {
    const now = api.clock.now();
    const base = {
      environmentId: api.environmentId,
      id: newId('cnsr'),
      side: 'destination' as const,
      outcome: 'accepted' as const,
      purpose: 'share.reuse-kyc' as const,
      connectionId: connection.id,
      shareTokenId: 'cnst_01M5CN0000000000000011A200',
      recipientOrganizationId: recipient,
      recipientName: 'Example Partner',
      dataCategories: ['identity-fields' as const],
      explicitBiometric: false,
      textLocale: 'en',
      textKeys: [],
      textSha256: 'a'.repeat(64),
      biometricTextSha256: null,
      attestedTextBody: 'Synthetic.',
      method: 'attested' as const,
      sessionId: null,
      evidenceIp: null,
      evidenceUserAgent: null,
      evidenceReference: 'synthetic-ref',
      acceptedAt: null,
      attestedAt: now,
      attestedByType: 'api-key' as const,
      attestedById: newId('key'),
      expiresAt: new Date(now.getTime() + 1000),
      withdrawnAt: null,
      withdrawnVia: null,
      withdrawalReason: null,
      redactedAt: null,
      createdAt: now,
    };
    const token = consentRecordResource(
      {
        record: { ...base, subjectType: 'share-token', subjectId: base.shareTokenId },
        citingTokenId: null,
        textBody: null,
      },
      { pii: true, now },
    );
    expect(consentRecordResourceSchema.parse(token).relationships.subject.data).toEqual({
      type: 'connect/share-token',
      id: base.shareTokenId,
    });
    expect(token.relationships['share-token'].data?.id).toBe(base.shareTokenId);
    expect(token.attributes['text-body']).toBe('Synthetic.');
    const verification = consentRecordResource(
      {
        record: { ...base, subjectType: 'verification', subjectId: newId('ver') },
        citingTokenId: null,
        textBody: null,
        subjectResourceType: 'verification/selfie',
      },
      { pii: false, now },
    );
    expect(verification.relationships.subject.data?.type).toBe('verification/selfie');
    const redacted = consentRecordResource(
      {
        record: { ...base, subjectType: null, subjectId: null, redactedAt: now },
        citingTokenId: null,
        textBody: null,
      },
      { pii: true, now },
    );
    expect(redacted.attributes).toMatchObject({
      status: 'redacted',
      evidence: null,
      'evidence-reference': null,
      'text-body': null,
    });
    expect(redacted.relationships.subject.data).toBeNull();
  });
});
