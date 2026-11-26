/**
 * C237 (Workflow 11A, `api-consent` checkpoint 2): withdrawal and its effects, in one transaction.
 *
 * - `POST /api/v1/connect/consent-records/:id/withdraw` (`connect-share-tokens:write`): the record is
 *   withdrawn (`withdrawn-via: api`, the optional `withdrawal-reason`), a second withdrawal is 409
 *   `consent_already_withdrawn`, anything the caller may not see the one 404.
 * - The token it authorised: `created` becomes `expired` with `consent_withdrawn` and
 *   `connect/share-token.expired` on both sides; `pending` is left to the redeem job, which fails at
 *   commit (`api-redeem`); `redeemed` recalls nothing, and the counterparty hears
 *   `connect/share-token.consent-withdrawn`.
 * - A destination record withdrawn after redemption marks the copies (`consent-withdrawn-at`).
 * - `consent-record.withdrawn` in the record's environment, with no evidence.
 *
 * Every value is synthetic.
 */
import {
  API_SCOPES,
  buildEventResource,
  CONNECT_NOT_FOUND_PROBLEM,
  consentRecordDocumentSchema,
  newId,
} from '@openverify/contracts';
import { createConsentRecord, type NewOpenedConsentRecord } from '@openverify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createInquiry, createTestApi, type TestApi } from '../../test-support/harness.js';
import { seedConnection, seedShareToken, shareTokenRow } from './consent.test-support.js';
import { withdrawConsentRecordInTx } from './withdrawal.js';

const PATH = '/api/v1/connect/consent-records';

let api: TestApi;
let destination: Awaited<ReturnType<TestApi['newTenant']>>;
let connection: { id: string; policyId: string };

beforeAll(async () => {
  api = await createTestApi({ connect: { enabled: true } });
  destination = await api.newTenant();
  connection = await seedConnection(api.database.db, {
    sourceOrganizationId: api.organizationId,
    destinationOrganizationId: destination.organizationId,
  });
});

afterAll(async () => {
  await api.close();
});

const sourceRecord = async (overrides: Partial<NewOpenedConsentRecord> = {}) =>
  createConsentRecord(api.database.db, api.environmentId, {
    id: newId('cnsr'),
    side: 'source',
    outcome: 'accepted',
    purpose: 'share.reuse-kyc',
    subjectType: 'inquiry',
    subjectId: await createInquiry(api),
    connectionId: connection.id,
    recipientOrganizationId: destination.organizationId,
    recipientName: 'Example Test Org',
    dataCategories: ['identity-fields', 'check-results'],
    explicitBiometric: false,
    textLocale: 'en',
    textKeys: ['share.consent.source'],
    textSha256: 'a'.repeat(64),
    method: 'flow',
    sessionId: newId('iqse'),
    evidenceIp: '192.0.2.55',
    acceptedAt: api.clock.now(),
    expiresAt: new Date(api.clock.now().getTime() + 86_400_000),
    ...overrides,
  });

let keys = 0;
const withdraw = (id: string, attributes: Record<string, unknown> = {}, token = api.token) =>
  api.app.inject({
    method: 'POST',
    url: `${PATH}/${id}/withdraw`,
    headers: { ...bearer(token), 'idempotency-key': `synthetic-withdraw-${String((keys += 1))}` },
    payload: { data: { type: 'consent-record', attributes } },
  });

const genericOf = (body: string) =>
  Object.fromEntries(
    Object.entries(JSON.parse(body) as Record<string, unknown>).filter(
      ([member]) => member !== 'instance' && member !== 'requestId',
    ),
  );

const eventsIn = (environmentId: string, name: string) =>
  api.events.named(name).filter((event) => event.environmentId === environmentId);

describe('POST /connect/consent-records/:id/withdraw (C237.1)', () => {
  it('withdraws once, with its channel and reason, and announces it in its environment', async () => {
    const record = await sourceRecord();
    const response = await withdraw(record.id, { 'withdrawal-reason': 'subject-request' });
    expect(response.statusCode, response.body).toBe(200);
    const attributes = consentRecordDocumentSchema.parse(response.json()).data.attributes;
    expect(attributes).toMatchObject({
      status: 'withdrawn',
      'withdrawn-via': 'api',
      'withdrawal-reason': 'subject-request',
      'withdrawn-at': api.clock.now().toISOString(),
    });
    const event = eventsIn(api.environmentId, 'consent-record.withdrawn').at(-1);
    expect(() =>
      buildEventResource({
        id: newId('evt'),
        name: 'consent-record.withdrawn',
        payload: event?.payload as never,
        createdAt: new Date(),
      }),
    ).not.toThrow();
    expect(JSON.stringify(event?.payload)).not.toContain('192.0.2.55');
    expect(api.audit.withAction('consent-record.withdrawn').at(-1)?.resourceId).toBe(record.id);

    const again = await withdraw(record.id);
    expect(again.statusCode).toBe(409);
    expect(again.json<{ code: string }>().code).toBe('consent_already_withdrawn');
  });

  it('answers the one 404 for a record the caller may not see', async () => {
    const record = await sourceRecord();
    for (const response of [
      await withdraw(record.id, {}, destination.token),
      await withdraw('cnsr_01M5CN0000000000000011A998'),
    ]) {
      expect(response.statusCode).toBe(404);
      expect(genericOf(response.body)).toEqual(CONNECT_NOT_FOUND_PROBLEM);
    }
  });

  it('is under connect-share-tokens:write', async () => {
    const record = await sourceRecord();
    const token = await api.newApiKey(api.environmentId, {
      scopes: API_SCOPES.filter((scope) => scope !== 'connect-share-tokens:write'),
    });
    expect((await withdraw(record.id, {}, token)).statusCode).toBe(403);
  });
});

describe('the token a withdrawn record authorised (C237.2)', () => {
  const tokenFor = (recordId: string, status: 'created' | 'pending' | 'redeemed') =>
    seedShareToken(api.database.db, {
      sourceEnvironmentId: api.environmentId,
      destinationEnvironmentId: destination.environmentId,
      connection,
      consentRecordId: recordId,
      status,
    });

  it('expires a created token with consent_withdrawn, with its events on both sides', async () => {
    const record = await sourceRecord();
    const token = await tokenFor(record.id, 'created');
    expect((await withdraw(record.id)).statusCode).toBe(200);
    expect(await shareTokenRow(api.database.db, token)).toMatchObject({
      status: 'expired',
      expiry_reason: 'consent_withdrawn',
    });
    for (const environmentId of [api.environmentId, destination.environmentId]) {
      expect(
        eventsIn(environmentId, 'connect/share-token.expired').some(
          (event) => (event.payload as { data: { id: string } }).data.id === token,
        ),
        environmentId,
      ).toBe(true);
    }
  });

  it('leaves a pending token to the redeem job, which fails at commit', async () => {
    const record = await sourceRecord();
    const token = await tokenFor(record.id, 'pending');
    expect((await withdraw(record.id)).statusCode).toBe(200);
    expect((await shareTokenRow(api.database.db, token)).status).toBe('pending');
  });

  it('recalls nothing of a redeemed share and tells the destination', async () => {
    const record = await sourceRecord();
    const token = await tokenFor(record.id, 'redeemed');
    expect((await withdraw(record.id)).statusCode).toBe(200);
    expect((await shareTokenRow(api.database.db, token)).status).toBe('redeemed');
    const told = eventsIn(destination.environmentId, 'connect/share-token.consent-withdrawn');
    expect(told.map((event) => (event.payload as { data: { id: string } }).data.id)).toContain(
      token,
    );
    expect(
      eventsIn(api.environmentId, 'connect/share-token.consent-withdrawn').some(
        (event) => (event.payload as { data: { id: string } }).data.id === token,
      ),
    ).toBe(false);
  });
});

describe('a destination record withdrawn (C237.2, C237.6 (2))', () => {
  const destinationRecord = async (shareTokenId: string, subject: { type: string; id: string }) =>
    createConsentRecord(api.database.db, destination.environmentId, {
      id: newId('cnsr'),
      side: 'destination',
      outcome: 'accepted',
      purpose: 'share.reuse-kyc',
      subjectType: subject.type as 'inquiry',
      subjectId: subject.id,
      connectionId: connection.id,
      shareTokenId,
      recipientOrganizationId: destination.organizationId,
      recipientName: 'Example Test Org',
      dataCategories: ['identity-fields', 'check-results'],
      explicitBiometric: false,
      textLocale: 'en',
      textKeys: [],
      textSha256: 'b'.repeat(64),
      method: 'attested',
      attestedTextBody: 'Synthetic destination consent.',
      evidenceReference: 'synthetic-dest-ref',
      attestedAt: api.clock.now(),
      attestedByType: 'api-key',
      attestedById: newId('key'),
      expiresAt: new Date(api.clock.now().getTime() + 86_400_000),
    });

  it('expires the created token in the source environment', async () => {
    const source = await sourceRecord();
    const token = await seedShareToken(api.database.db, {
      sourceEnvironmentId: api.environmentId,
      destinationEnvironmentId: destination.environmentId,
      connection,
      consentRecordId: source.id,
    });
    const record = await destinationRecord(token, { type: 'share-token', id: token });
    const response = await withdraw(record.id, {}, destination.token);
    expect(response.statusCode, response.body).toBe(200);
    expect(await shareTokenRow(api.database.db, token)).toMatchObject({
      status: 'expired',
      expiry_reason: 'consent_withdrawn',
    });
  });

  it('marks the copies after redemption and tells the source', async () => {
    const source = await sourceRecord();
    const clone = await createInquiry(api, { token: destination.token });
    const record = await destinationRecord('cnst_01M5CN0000000000000011B001', {
      type: 'inquiry',
      id: clone,
    });
    const token = await seedShareToken(api.database.db, {
      sourceEnvironmentId: api.environmentId,
      destinationEnvironmentId: destination.environmentId,
      connection,
      consentRecordId: source.id,
      status: 'redeemed',
      destinationConsentRecordId: record.id,
    });
    await api.database.client.query(
      'update consent_records set share_token_id = $2 where id = $1',
      [record.id, token],
    );
    await api.database.client.query(
      `update inquiries set provenance = jsonb_build_object('kind', 'connect-clone',
         'share-token-id', $2::text, 'source-organization-name', 'Example Test Org',
         'source-environment-kind', 'sandbox', 'source-created-at', '2026-11-01T00:00:00.000Z',
         'source-status', 'approved', 'cloned-at', '2026-11-02T00:00:00.000Z') where id = $1`,
      [clone, token],
    );
    const response = await withdraw(record.id, {}, destination.token);
    expect(response.statusCode, response.body).toBe(200);
    const provenance = (
      await api.database.client.query<{ provenance: Record<string, unknown> }>(
        'select provenance from inquiries where id = $1',
        [clone],
      )
    ).rows[0]?.provenance;
    expect(provenance?.['consent-withdrawn-at']).toBe(api.clock.now().toISOString());
    expect(
      eventsIn(api.environmentId, 'connect/share-token.consent-withdrawn').map(
        (event) => (event.payload as { data: { id: string } }).data.id,
      ),
    ).toContain(token);
  });
});

describe('the flow channel (C237.6)', () => {
  it('withdraws with withdrawn-via flow and no principal, in the caller’s transaction', async () => {
    const record = await sourceRecord();
    const { record: withdrawn, staged } = await api.database.db.transaction((tx) =>
      withdrawConsentRecordInTx(tx, api.deps, {
        environmentId: api.environmentId,
        id: record.id,
        via: 'flow',
        reason: null,
        actor: { kind: 'flow' },
      }),
    );
    await api.deps.events.dispatch(staged);
    expect(withdrawn).toMatchObject({ withdrawnVia: 'flow', withdrawalReason: null });
    expect(eventsIn(api.environmentId, 'consent-record.withdrawn').at(-1)).toBeDefined();
  });
});
