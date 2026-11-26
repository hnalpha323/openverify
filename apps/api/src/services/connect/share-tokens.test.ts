/**
 * C232 (Workflow 11A, `api-connect` checkpoint 2): share tokens through the routes on PGlite. Create
 * with every check in the contract's order, each with its problem; the categories stored at
 * creation; one consent record, one token; list both directions; retrieve as each side sees it;
 * expire by the source; the deactivation's expiry (C231.4); the minute sweep (C232.5); and the one
 * generic 404 of C232.8, byte-identical for every token the caller may not see.
 */
import { readFileSync } from 'node:fs';
import { CONNECT_NOT_FOUND_PROBLEM, eventPayloadSchema, newId } from '@openverify/contracts';
import {
  connectShareTokens,
  consentRecords,
  createEnvironment,
  inquiries,
  listAuditLogs,
  organizations,
  setOrganizationConnectInbound,
  updateConnection,
  verifications,
} from '@openverify/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONNECT_TOKEN_EXPIRY_BATCH_SIZE } from '../../jobs/connect-queues.js';
import {
  CONNECT_TOKEN_EXPIRY_BATCH,
  runConnectTokenExpiry,
} from '../../jobs/connect-token-expiry.js';
import {
  bearer,
  createInquiry,
  createTestApi,
  seedVerification,
  type TestApi,
} from '../../test-support/harness.js';

const POLICY = JSON.parse(
  readFileSync(
    new URL('../../../../../contracts/fixtures/api/connect/share-policy.json', import.meta.url),
    'utf8',
  ),
) as Record<string, unknown>;
const ALL_CATEGORIES = [
  'identity-fields',
  'contact-fields',
  'other-fields',
  'document-images',
  'biometric',
  'check-results',
];
const DAY = 86_400_000;

let api: TestApi;
let callCount = 0;

interface Organisation {
  id: string;
  production: string;
  sandbox: string | null;
  productionKey: string;
  sandboxKey: string;
}

async function organisation(
  name: string,
  options: { inbound?: boolean; sandbox?: boolean } = {},
): Promise<Organisation> {
  const tenant = await api.newTenant({ kind: 'production' });
  const sandbox =
    options.sandbox === false
      ? null
      : await createEnvironment(api.database.db, {
          id: newId('env'),
          organizationId: tenant.organizationId,
          kind: 'sandbox',
        });
  await api.database.db
    .update(organizations)
    .set({ name })
    .where(eq(organizations.id, tenant.organizationId));
  if (options.inbound === true) {
    await setOrganizationConnectInbound(api.database.db, tenant.organizationId, true);
  }
  return {
    id: tenant.organizationId,
    production: tenant.environmentId,
    sandbox: sandbox?.id ?? null,
    productionKey: tenant.token,
    sandboxKey: sandbox === null ? '' : await api.newApiKey(sandbox.id),
  };
}

const call = (
  method: 'GET' | 'POST',
  url: string,
  token: string,
  payload?: Record<string, unknown>,
) =>
  api.app.inject({
    method,
    url,
    headers: { ...bearer(token), 'idempotency-key': `synthetic-cnst-${String((callCount += 1))}` },
    ...(payload === undefined ? {} : { payload }),
  });

const genericOf = (body: string) =>
  Object.fromEntries(
    Object.entries(JSON.parse(body) as Record<string, unknown>).filter(
      ([member]) => member !== 'instance' && member !== 'requestId',
    ),
  );

/** A connection from `source` to `destination`, `active` unless told otherwise. */
async function connection(
  source: Organisation,
  destination: Organisation,
  options: { active?: boolean; policy?: Record<string, unknown> } = {},
): Promise<string> {
  const response = await call('POST', '/api/v1/connect/connections', source.productionKey, {
    data: {
      attributes: {
        'destination-organization-id': destination.id,
        'share-policy': options.policy ?? POLICY,
      },
    },
  });
  const { data } = response.json<{
    data: { id: string; attributes: { 'share-policy': { id: string } } };
  }>();
  if (options.active !== false) {
    const now = api.clock.now();
    await updateConnection(api.database.db, data.id, {
      status: 'active',
      acceptedPolicyId: data.attributes['share-policy'].id,
      activatedAt: now,
      updatedAt: now,
    });
  }
  return data.id;
}

/** A source inquiry in `environment` with a passed government ID (checks and files). */
async function sourceInquiry(
  owner: Organisation,
  environment: string,
): Promise<{
  inquiryId: string;
  verificationId: string;
}> {
  const key = environment === owner.sandbox ? owner.sandboxKey : owner.productionKey;
  const inquiryId = await createInquiry(api, { token: key });
  const verification = await seedVerification(api, environment, inquiryId, {
    type: 'government_id',
    status: 'passed',
    checks: [{ name: 'id_blur_detection', status: 'passed' }],
    files: ['front', 'portrait'],
  });
  return { inquiryId, verificationId: verification.id };
}

/** A source-side consent record, a `flow` record about the inquiry unless told otherwise. */
async function consent(
  environment: string,
  connectionId: string,
  recipient: Organisation,
  subjectId: string,
  overrides: Partial<typeof consentRecords.$inferInsert> = {},
): Promise<string> {
  const id = newId('cnsr');
  const now = api.clock.now();
  await api.database.db.insert(consentRecords).values({
    environmentId: environment,
    id,
    side: 'source',
    outcome: 'accepted',
    purpose: 'share.reuse-kyc',
    subjectType: 'inquiry',
    subjectId,
    connectionId,
    recipientOrganizationId: recipient.id,
    recipientName: 'Example Partner',
    dataCategories: ALL_CATEGORIES,
    explicitBiometric: true,
    textLocale: 'en',
    textKeys: ['share.consent.source'],
    textSha256: 'a'.repeat(64),
    method: 'flow',
    acceptedAt: now,
    expiresAt: new Date(now.getTime() + 30 * DAY),
    ...overrides,
  });
  return id;
}

const createToken = (token: string, attributes: Record<string, unknown>) =>
  call('POST', '/api/v1/connect/share-tokens', token, { data: { attributes } });

interface TokenBody {
  data: {
    id: string;
    attributes: Record<string, unknown>;
    relationships: Record<string, unknown>;
  };
}

/** Two partners, an active connection and a share ready to be made (sandbox to sandbox). */
async function scene() {
  const source = await organisation('Example Source');
  const destination = await organisation('Example Partner', { inbound: true });
  const connectionId = await connection(source, destination);
  const sandbox = source.sandbox ?? '';
  const { inquiryId, verificationId } = await sourceInquiry(source, sandbox);
  const consentRecordId = await consent(sandbox, connectionId, destination, inquiryId);
  return { source, destination, connectionId, inquiryId, verificationId, consentRecordId, sandbox };
}

beforeAll(async () => {
  api = await createTestApi({ connect: { enabled: true } });
}, 120_000);
afterAll(async () => {
  await api.close();
});

describe('creating a share token (C232.1)', () => {
  it('answers 201 created and outbound, with the categories fixed at creation', async () => {
    const s = await scene();
    const response = await createToken(s.source.sandboxKey, {
      'connection-id': s.connectionId,
      'source-id': s.inquiryId,
      'consent-record-id': s.consentRecordId,
    });
    expect(response.statusCode, response.body).toBe(201);
    const { data } = response.json<TokenBody>();
    expect(data.id).toMatch(/^cnst_/);
    expect(data.attributes).toMatchObject({
      status: 'created',
      direction: 'outbound',
      'source-type': 'inquiry',
      'environment-kind': 'sandbox',
      'share-policy-version': 1,
      'peek-count': 0,
      'source-consent': {
        method: 'flow',
        witnessed: true,
        'text-sha256': 'a'.repeat(64),
      },
    });
    const categories = data.attributes['data-categories'] as string[];
    expect(categories).toContain('check-results');
    // 14 days by default, within a consent of 30.
    expect(data.attributes['expires-at']).toBe(
      new Date(api.clock.now().getTime() + 14 * DAY).toISOString(),
    );
    expect(data.relationships).toMatchObject({
      connection: { data: { type: 'connect/connection', id: s.connectionId } },
      source: { data: { type: 'inquiry', id: s.inquiryId } },
      'consent-record': { data: { type: 'consent-record', id: s.consentRecordId } },
      creator: { data: { type: 'api-key' } },
    });
    const [row] = await api.database.db
      .select()
      .from(connectShareTokens)
      .where(eq(connectShareTokens.id, data.id));
    expect(row?.dataCategories).toEqual(categories);
    expect(row?.explicitBiometric).toBe(categories.includes('biometric'));
  });

  it('stages outbound-created at the source and inbound-created at the destination, audited on both sides', async () => {
    const s = await scene();
    const { data } = (
      await createToken(s.source.sandboxKey, {
        'connection-id': s.connectionId,
        'source-id': s.inquiryId,
        'consent-record-id': s.consentRecordId,
      })
    ).json<TokenBody>();
    const outbound = api.events
      .named('connect/share-token.outbound-created')
      .filter((event) => (event.payload.data as { id: string }).id === data.id);
    const inbound = api.events
      .named('connect/share-token.inbound-created')
      .filter((event) => (event.payload.data as { id: string }).id === data.id);
    expect(outbound.map((event) => event.environmentId)).toEqual([s.sandbox]);
    expect(inbound.map((event) => event.environmentId)).toEqual([s.destination.sandbox]);
    for (const event of [...outbound, ...inbound]) {
      expect(() => eventPayloadSchema.parse(event.payload)).not.toThrow();
    }
    const inboundView = (inbound[0]?.payload.data as TokenBody['data']).relationships;
    expect(Object.keys(inboundView)).toEqual(['connection']);
    const entries = (await listAuditLogs(api.database.db, s.destination.sandbox ?? '')).filter(
      (entry) => entry.action === 'connect-share-token.created' && entry.resourceId === data.id,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.metadata).toMatchObject({
      counterparty: { 'organization-id': s.source.id, kind: 'api-key' },
    });
    expect(
      api.audit
        .withAction('connect-share-token.created')
        .filter((entry) => entry.resourceId === data.id),
    ).toHaveLength(1);
  });

  it('refuses in the contract’s order, each with its problem', async () => {
    const s = await scene();
    const base = {
      'connection-id': s.connectionId,
      'source-id': s.inquiryId,
      'consent-record-id': s.consentRecordId,
    };
    const unknownConnection = await createToken(s.source.sandboxKey, {
      ...base,
      'connection-id': newId('cxn'),
    });
    expect(unknownConnection.statusCode).toBe(404);
    expect(genericOf(unknownConnection.body)).toEqual(CONNECT_NOT_FOUND_PROBLEM);

    const pendingId = await connection(
      s.source,
      await organisation('Example Pending', { inbound: true }),
      { active: false },
    );
    const pending = await createToken(s.source.sandboxKey, { ...base, 'connection-id': pendingId });
    expect(pending.json()).toMatchObject({ status: 409, code: 'connection_not_active' });

    const productionOnly = await organisation('Example Production Only', {
      inbound: true,
      sandbox: false,
    });
    const kind = await createToken(s.source.sandboxKey, {
      ...base,
      'connection-id': await connection(s.source, productionOnly),
    });
    expect(kind.json()).toMatchObject({ status: 422, code: 'environment_kind_mismatch' });

    const unknownSource = await createToken(s.source.sandboxKey, {
      ...base,
      'source-id': newId('inq'),
    });
    expect(unknownSource.statusCode).toBe(404);

    const report = await createToken(s.source.sandboxKey, { ...base, 'source-id': newId('rep') });
    expect(report.json()).toMatchObject({ status: 422, code: 'share_source_not_supported' });

    const undecided = await seedVerification(api, s.sandbox, s.inquiryId, {
      type: 'government_id',
      status: 'submitted',
    });
    const notDecided = await createToken(s.source.sandboxKey, {
      ...base,
      'source-id': undecided.id,
    });
    expect(notDecided.json()).toMatchObject({ status: 409, code: 'source_not_decided' });

    const account = await createToken(s.source.sandboxKey, {
      ...base,
      'connection-id': await connection(
        s.source,
        await organisation('Example No Accounts', { inbound: true }),
        { policy: { ...POLICY, 'source-types': ['inquiry'], peek: {} } },
      ),
      'source-id': s.verificationId,
    });
    expect(account.json()).toMatchObject({ status: 422, code: 'share_source_not_allowed' });
  });

  it('answers 409 source_redacted and source_is_copy', async () => {
    const s = await scene();
    const base = { 'connection-id': s.connectionId, 'consent-record-id': s.consentRecordId };
    await api.database.db
      .update(verifications)
      .set({
        provenance: {
          kind: 'connect-clone',
          'share-token-id': newId('cnst'),
          'source-organization-name': 'Example Upstream',
          'source-environment-kind': 'sandbox',
          'source-created-at': '2026-10-01T00:00:00.000Z',
          'source-status': 'passed',
          'cloned-at': '2026-10-02T00:00:00.000Z',
        },
      })
      .where(eq(verifications.id, s.verificationId));
    const copy = await createToken(s.source.sandboxKey, { ...base, 'source-id': s.inquiryId });
    expect(copy.json()).toMatchObject({ status: 409, code: 'source_is_copy' });
    await api.database.db
      .update(inquiries)
      .set({ redactedAt: api.clock.now() })
      .where(eq(inquiries.id, s.inquiryId));
    const redacted = await createToken(s.source.sandboxKey, { ...base, 'source-id': s.inquiryId });
    expect(redacted.json()).toMatchObject({ status: 409, code: 'source_redacted' });
  });

  it.each([
    ['missing', () => ({ consent: newId('cnsr') })],
    [
      'recipient',
      () => ({ overrides: { recipientName: 'Example Partner' }, otherRecipient: true }),
    ],
    ['categories', () => ({ overrides: { dataCategories: ['identity-fields'] } })],
    [
      'withdrawn',
      () => ({ overrides: { withdrawnAt: new Date(0), withdrawnVia: 'api' as const } }),
    ],
    ['expired', () => ({ overrides: { expiresAt: new Date(0) } })],
  ])('answers 422 consent_required with reason %s', async (reason, setup) => {
    const s = await scene();
    const options = setup() as {
      consent?: string;
      overrides?: Partial<typeof consentRecords.$inferInsert>;
      otherRecipient?: boolean;
    };
    const recipient =
      options.otherRecipient === true ? await organisation('Example Other') : s.destination;
    const consentRecordId =
      options.consent ??
      (await consent(s.sandbox, s.connectionId, recipient, s.inquiryId, options.overrides));
    const response = await createToken(s.source.sandboxKey, {
      'connection-id': s.connectionId,
      'source-id': s.inquiryId,
      'consent-record-id': consentRecordId,
    });
    expect(response.statusCode, response.body).toBe(422);
    expect(response.json()).toMatchObject({ code: 'consent_required', reason });
  });

  it('lets one consent record authorise one token (already_used)', async () => {
    const s = await scene();
    const body = {
      'connection-id': s.connectionId,
      'source-id': s.inquiryId,
      'consent-record-id': s.consentRecordId,
    };
    expect((await createToken(s.source.sandboxKey, body)).statusCode).toBe(201);
    const again = await createToken(s.source.sandboxKey, body);
    expect(again.json()).toMatchObject({
      status: 422,
      code: 'consent_required',
      reason: 'already_used',
    });
  });

  it('caps the lifetime at the consent (share_token_outlives_consent), and defaults to the earlier', async () => {
    const s = await scene();
    const shortConsent = await consent(s.sandbox, s.connectionId, s.destination, s.inquiryId, {
      expiresAt: new Date(api.clock.now().getTime() + DAY),
    });
    const tooLong = await createToken(s.source.sandboxKey, {
      'connection-id': s.connectionId,
      'source-id': s.inquiryId,
      'consent-record-id': shortConsent,
      'expires-in-seconds': 2 * 86_400,
    });
    expect(tooLong.json()).toMatchObject({ status: 422, code: 'share_token_outlives_consent' });
    const defaulted = await createToken(s.source.sandboxKey, {
      'connection-id': s.connectionId,
      'source-id': s.inquiryId,
      'consent-record-id': shortConsent,
    });
    expect(defaulted.json<TokenBody>().data.attributes['expires-at']).toBe(
      new Date(api.clock.now().getTime() + DAY).toISOString(),
    );
  });
});

describe('listing, retrieving and expiring (C232.2-C232.4, C232.8)', () => {
  async function token() {
    const s = await scene();
    const { data } = (
      await createToken(s.source.sandboxKey, {
        'connection-id': s.connectionId,
        'source-id': s.inquiryId,
        'consent-record-id': s.consentRecordId,
      })
    ).json<TokenBody>();
    return { ...s, tokenId: data.id };
  }

  it('shows the destination its inbound view, without creator, source or consent record', async () => {
    const s = await token();
    const response = await call(
      'GET',
      `/api/v1/connect/share-tokens/${s.tokenId}`,
      s.destination.sandboxKey,
    );
    expect(response.statusCode, response.body).toBe(200);
    const { data } = response.json<TokenBody>();
    expect(data.attributes).toMatchObject({ direction: 'inbound', status: 'created' });
    expect(Object.keys(data.relationships)).toEqual(['connection']);
    expect(data.attributes).not.toHaveProperty('source-data');
  });

  it('lists each side’s tokens, newest first, filtered by direction', async () => {
    const s = await token();
    const outbound = await call('GET', '/api/v1/connect/share-tokens', s.source.sandboxKey);
    expect(outbound.json<{ data: { id: string }[] }>().data.map((item) => item.id)).toEqual([
      s.tokenId,
    ]);
    const inbound = await call(
      'GET',
      '/api/v1/connect/share-tokens?filter[direction]=inbound',
      s.destination.sandboxKey,
    );
    expect(inbound.json<{ data: { id: string }[] }>().data.map((item) => item.id)).toEqual([
      s.tokenId,
    ]);
    const none = await call(
      'GET',
      '/api/v1/connect/share-tokens?filter[direction]=outbound',
      s.destination.sandboxKey,
    );
    expect(none.json<{ data: unknown[] }>().data).toEqual([]);
  });

  it('answers one byte-identical 404 for every token the caller may not see', async () => {
    const s = await token();
    const third = await organisation('Example Third', { inbound: true });
    const bodies = await Promise.all([
      call('GET', `/api/v1/connect/share-tokens/${newId('cnst')}`, s.source.sandboxKey),
      call('GET', `/api/v1/connect/share-tokens/${s.tokenId}`, third.sandboxKey),
      // The other environment kind of either side.
      call('GET', `/api/v1/connect/share-tokens/${s.tokenId}`, s.source.productionKey),
      call('GET', `/api/v1/connect/share-tokens/${s.tokenId}`, s.destination.productionKey),
      // A source-only action by the destination.
      call(
        'POST',
        `/api/v1/connect/share-tokens/${s.tokenId}/expire`,
        s.destination.sandboxKey,
        {},
      ),
    ]);
    for (const response of bodies) {
      expect(response.statusCode).toBe(404);
    }
    const generic = bodies.map((response) => JSON.stringify(genericOf(response.body)));
    expect(new Set(generic).size).toBe(1);
    expect(JSON.parse(generic[0] ?? '{}')).toEqual(CONNECT_NOT_FOUND_PROBLEM);
  });

  it('lets the source expire a created token once (409 share_token_not_expirable after)', async () => {
    const s = await token();
    const expired = await call(
      'POST',
      `/api/v1/connect/share-tokens/${s.tokenId}/expire`,
      s.source.sandboxKey,
      {},
    );
    expect(expired.statusCode, expired.body).toBe(200);
    expect(expired.json<TokenBody>().data.attributes).toMatchObject({
      status: 'expired',
      'expiry-reason': 'source_expired',
    });
    const again = await call(
      'POST',
      `/api/v1/connect/share-tokens/${s.tokenId}/expire`,
      s.source.sandboxKey,
      {},
    );
    expect(again.json()).toMatchObject({ status: 409, code: 'share_token_not_expirable' });
    const events = api.events
      .named('connect/share-token.expired')
      .filter((event) => (event.payload.data as { id: string }).id === s.tokenId);
    expect(events.map((event) => event.environmentId).sort()).toEqual(
      [s.sandbox, s.destination.sandbox ?? ''].sort(),
    );
  });

  it('expires every created token when either side deactivates the connection (C231.4)', async () => {
    const s = await token();
    const response = await call(
      'POST',
      `/api/v1/connect/connections/${s.connectionId}/deactivate`,
      s.destination.productionKey,
      {},
    );
    expect(response.statusCode, response.body).toBe(200);
    const read = await call(
      'GET',
      `/api/v1/connect/share-tokens/${s.tokenId}`,
      s.source.sandboxKey,
    );
    expect(read.json<TokenBody>().data.attributes).toMatchObject({
      status: 'expired',
      'expiry-reason': 'connection_deactivated',
    });
    expect(
      api.events
        .named('connect/share-token.expired')
        .filter((event) => (event.payload.data as { id: string }).id === s.tokenId),
    ).toHaveLength(2);
  });
});

describe('the minute sweep (C232.5)', () => {
  it('takes batches of the queue’s size', () => {
    expect(CONNECT_TOKEN_EXPIRY_BATCH).toBe(CONNECT_TOKEN_EXPIRY_BATCH_SIZE);
  });

  it('expires created tokens past their expiry with expiry-reason time, and nothing else', async () => {
    const s = await scene();
    const due = (
      await createToken(s.source.sandboxKey, {
        'connection-id': s.connectionId,
        'source-id': s.inquiryId,
        'consent-record-id': s.consentRecordId,
        'expires-in-seconds': 60,
      })
    ).json<TokenBody>().data.id;
    const later = await consent(s.sandbox, s.connectionId, s.destination, s.inquiryId);
    const notDue = (
      await createToken(s.source.sandboxKey, {
        'connection-id': s.connectionId,
        'source-id': s.inquiryId,
        'consent-record-id': later,
      })
    ).json<TokenBody>().data.id;
    const now = new Date(api.clock.now().getTime() + 61_000);
    const logged: Record<string, unknown>[] = [];
    const result = await runConnectTokenExpiry({
      db: api.database.db,
      clock: { now: () => now },
      logger: {
        info: (entry) => logged.push(entry),
        warn: (entry) => logged.push(entry),
        error: (entry) => logged.push(entry),
      },
    });
    // Counts only, never a token's data.
    expect(logged.every((entry) => Object.keys(entry).join() === 'expired')).toBe(true);
    expect(result.expired).toBeGreaterThanOrEqual(1);
    const rows = await api.database.db
      .select({
        id: connectShareTokens.id,
        status: connectShareTokens.status,
        reason: connectShareTokens.expiryReason,
      })
      .from(connectShareTokens)
      .where(eq(connectShareTokens.connectionId, s.connectionId));
    expect(rows.find((row) => row.id === due)).toMatchObject({ status: 'expired', reason: 'time' });
    expect(rows.find((row) => row.id === notDue)).toMatchObject({
      status: 'created',
      reason: null,
    });
    const audit = (await listAuditLogs(api.database.db, s.destination.sandbox ?? '')).filter(
      (entry) => entry.action === 'connect-share-token.expired' && entry.resourceId === due,
    );
    expect(audit[0]?.metadata).toMatchObject({
      counterparty: { 'organization-id': s.source.id, kind: 'system' },
    });
  });
});
