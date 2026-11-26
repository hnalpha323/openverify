/**
 * C233, C240.5 (Workflow 11A, `api-connect` checkpoint 3): the destination's peek and the
 * cross-tenant entry points it and the redemption read through, on PGlite. A peek is the vendor's
 * `{visibility, value}` envelope of the source's current rows, filtered by the token's policy
 * version (never a file byte, an image or face data); it needs `connect-share-tokens:peek` and, for
 * a user, `pii:view`; a `created` token over an `active` connection; at most 10 a token, counted
 * under the token row lock; audited on both sides with no value. `readRedemptionSource` re-reads
 * under the lock order, and `listSharesTouching` finds a person's shares on either side.
 */
import { readFileSync } from 'node:fs';
import {
  CONNECT_NOT_FOUND_PROBLEM,
  SHARE_TOKEN_PEEK_LIMIT,
  newId,
  sourceDataSchema,
} from '@openverify/contracts';
import { PERMISSIONS, type Permission } from '@openverify/core';
import {
  accounts,
  connectShareTokens,
  consentRecords,
  createAccount,
  createEnvironment,
  createTransaction,
  createTransactionType,
  createTransactionTypeVersion,
  inquiries,
  listAuditLogs,
  organizations,
  setOrganizationConnectInbound,
  updateConnection,
} from '@openverify/db';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bearer,
  createInquiry,
  createTestApi,
  seedVerification,
  type TestApi,
} from '../../test-support/harness.js';
import { crossTenant } from './cross-tenant.js';
import { loadShareSource, peekEnvelopeOf } from './peek.js';

const POLICY = JSON.parse(
  readFileSync(
    new URL('../../../../../contracts/fixtures/api/connect/share-policy.json', import.meta.url),
    'utf8',
  ),
) as Record<string, unknown>;
const DAY = 86_400_000;

let api: TestApi;
let callCount = 0;

const call = (method: 'GET' | 'POST', url: string, token: string, payload?: object) =>
  api.app.inject({
    method,
    url,
    headers: { ...bearer(token), 'idempotency-key': `synthetic-peek-${String((callCount += 1))}` },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });

async function organisation(name: string, inbound: boolean) {
  const tenant = await api.newTenant({ kind: 'production' });
  const sandbox = await createEnvironment(api.database.db, {
    id: newId('env'),
    organizationId: tenant.organizationId,
    kind: 'sandbox',
  });
  await api.database.db
    .update(organizations)
    .set({ name })
    .where(eq(organizations.id, tenant.organizationId));
  if (inbound) {
    await setOrganizationConnectInbound(api.database.db, tenant.organizationId, true);
  }
  return {
    id: tenant.organizationId,
    production: tenant.environmentId,
    productionKey: tenant.token,
    sandbox: sandbox.id,
    sandboxKey: await api.newApiKey(sandbox.id),
  };
}

/** Two partners, an active connection, a source inquiry with fields and a passed ID, a token. */
async function sharedToken(kind: 'sandbox' | 'production' = 'sandbox') {
  const source = await organisation('Example Source', false);
  const destination = await organisation('Example Partner', true);
  const created = await call('POST', '/api/v1/connect/connections', source.productionKey, {
    data: { attributes: { 'destination-organization-id': destination.id, 'share-policy': POLICY } },
  });
  const connection = created.json<{
    data: { id: string; attributes: { 'share-policy': { id: string } } };
  }>().data;
  const now = api.clock.now();
  await updateConnection(api.database.db, connection.id, {
    status: 'active',
    acceptedPolicyId: connection.attributes['share-policy'].id,
    activatedAt: now,
    updatedAt: now,
  });
  const sourceEnvironment = kind === 'sandbox' ? source.sandbox : source.production;
  const sourceKey = kind === 'sandbox' ? source.sandboxKey : source.productionKey;
  const inquiryId = await createInquiry(api, {
    token: sourceKey,
    fields: { name_first: 'Alex', name_last: 'Example' },
  });
  await seedVerification(api, sourceEnvironment, inquiryId, {
    type: 'government_id',
    status: 'passed',
    checks: [{ name: 'id_blur_detection', status: 'passed' }],
    files: ['front', 'portrait'],
  });
  const consentId = newId('cnsr');
  await api.database.db.insert(consentRecords).values({
    environmentId: sourceEnvironment,
    id: consentId,
    side: 'source',
    outcome: 'accepted',
    purpose: 'share.reuse-kyc',
    subjectType: 'inquiry',
    subjectId: inquiryId,
    connectionId: connection.id,
    recipientOrganizationId: destination.id,
    recipientName: 'Example Partner',
    dataCategories: [
      'identity-fields',
      'contact-fields',
      'other-fields',
      'document-images',
      'biometric',
      'check-results',
    ],
    explicitBiometric: true,
    textSha256: 'b'.repeat(64),
    method: 'flow',
    acceptedAt: now,
    expiresAt: new Date(now.getTime() + 30 * DAY),
  });
  const token = await call('POST', '/api/v1/connect/share-tokens', sourceKey, {
    data: {
      attributes: {
        'connection-id': connection.id,
        'source-id': inquiryId,
        'consent-record-id': consentId,
      },
    },
  });
  expect(token.statusCode, token.body).toBe(201);
  return {
    source,
    destination,
    connectionId: connection.id,
    inquiryId,
    consentId,
    tokenId: token.json<{ data: { id: string } }>().data.id,
  };
}

const peek = (tokenId: string, key: string) =>
  call('GET', `/api/v1/connect/share-tokens/${tokenId}?peek-source-data=true`, key);

interface PeekBody {
  data: {
    attributes: Record<string, unknown> & {
      'source-data'?: Record<string, unknown>;
      'peek-count': number;
    };
  };
}

beforeAll(async () => {
  api = await createTestApi({ connect: { enabled: true } });
}, 120_000);
afterAll(async () => {
  await api.close();
});

describe('peeking at an inbound token (C233)', () => {
  it('answers the vendor’s envelope of the source’s current rows, filtered by the policy', async () => {
    const s = await sharedToken();
    const response = await peek(s.tokenId, s.destination.sandboxKey);
    expect(response.statusCode, response.body).toBe(200);
    const { attributes } = response.json<PeekBody>().data;
    expect(attributes['peek-count']).toBe(1);
    const sourceData = sourceDataSchema.parse(attributes['source-data']);
    expect(sourceData.type).toBe('connect/source-data/inquiry');
    if (sourceData.type !== 'connect/source-data/inquiry') {
      throw new Error('not an inquiry envelope');
    }
    // `peek` names `inquiry.status` and `inquiry.fields.name_first` full; anything else shared is
    // a presence at most, and what the policy does not share is absent.
    expect(sourceData.attributes.status).toMatchObject({ visibility: 'full' });
    expect(sourceData.fields.name_first).toEqual({ visibility: 'full', value: 'Alex' });
    expect(sourceData.fields.name_last).toEqual({ visibility: 'presence', value: true });
    const [verification] = sourceData['related-objects'];
    expect(verification?.type).toBe('connect/source-data/verification/government-id');
    expect(verification?.files).toEqual({ visibility: 'presence', value: true });
    // C233.3: never a file byte, an id of a file or an image.
    expect(response.body).not.toMatch(/file_[0-9A-Z]{26}/);
    expect(response.body).not.toContain('base64');
  });

  it('counts each peek under the token lock and refuses the eleventh (429 share_token_peek_limit)', async () => {
    const s = await sharedToken();
    await api.database.db
      .update(connectShareTokens)
      .set({ peekCount: SHARE_TOKEN_PEEK_LIMIT - 1 })
      .where(eq(connectShareTokens.id, s.tokenId));
    expect((await peek(s.tokenId, s.destination.sandboxKey)).statusCode).toBe(200);
    const refused = await peek(s.tokenId, s.destination.sandboxKey);
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toMatchObject({ code: 'share_token_peek_limit' });
    const read = await call(
      'GET',
      `/api/v1/connect/share-tokens/${s.tokenId}`,
      s.source.sandboxKey,
    );
    expect(read.json<PeekBody>().data.attributes['peek-count']).toBe(SHARE_TOKEN_PEEK_LIMIT);
  });

  it('is the destination’s alone: the source gets the one 404', async () => {
    const s = await sharedToken();
    const response = await peek(s.tokenId, s.source.sandboxKey);
    expect(response.statusCode).toBe(404);
    expect(
      Object.fromEntries(
        Object.entries(response.json<Record<string, unknown>>()).filter(
          ([member]) => member !== 'instance' && member !== 'requestId',
        ),
      ),
    ).toEqual(CONNECT_NOT_FOUND_PROBLEM);
  });

  it('needs the peek scope, and pii:view for a user (403)', async () => {
    const s = await sharedToken();
    const withoutScope = await api.newApiKey(s.destination.sandbox, {
      scopes: ['connect-share-tokens:read'],
    });
    expect((await peek(s.tokenId, withoutScope)).statusCode).toBe(403);
    const production = await sharedToken('production');
    const permissions = PERMISSIONS.filter(
      (permission) => permission !== 'pii:view',
    ) as Permission[];
    const withoutPii = api.newUserToken(production.destination.production, { permissions });
    const refused = await peek(production.tokenId, withoutPii);
    expect(refused.statusCode).toBe(403);
    expect(refused.headers['www-authenticate']).toContain('pii:view');
    const allowed = await peek(
      production.tokenId,
      api.newUserToken(production.destination.production),
    );
    expect(allowed.statusCode, allowed.body).toBe(200);
  });

  it('answers 409 for a token no longer created and for a connection no longer active', async () => {
    const s = await sharedToken();
    await updateConnection(api.database.db, s.connectionId, {
      status: 'inactive',
      deactivatedAt: api.clock.now(),
      deactivatedBy: 'source',
      updatedAt: api.clock.now(),
    });
    const inactive = await peek(s.tokenId, s.destination.sandboxKey);
    expect(inactive.json()).toMatchObject({ status: 409, code: 'connection_not_active' });
    const expired = await call(
      'POST',
      `/api/v1/connect/share-tokens/${s.tokenId}/expire`,
      s.source.sandboxKey,
      {},
    );
    expect(expired.statusCode).toBe(200);
    const notCreated = await peek(s.tokenId, s.destination.sandboxKey);
    expect(notCreated.json()).toMatchObject({ status: 409, code: 'share_token_not_redeemable' });
  });

  it('is audited on both sides with no value, and never listed', async () => {
    const s = await sharedToken();
    await peek(s.tokenId, s.destination.sandboxKey);
    const own = api.audit
      .withAction('connect-share-token.peeked')
      .filter((entry) => entry.resourceId === s.tokenId);
    expect(own).toHaveLength(1);
    expect(own[0]?.environmentId).toBe(s.destination.sandbox);
    const counterparty = (await listAuditLogs(api.database.db, s.source.sandbox)).filter(
      (entry) => entry.action === 'connect-share-token.peeked' && entry.resourceId === s.tokenId,
    );
    expect(counterparty).toHaveLength(1);
    expect(JSON.stringify(counterparty[0]?.metadata)).not.toContain('Alex');
    expect(counterparty[0]?.metadata).toMatchObject({
      counterparty: { 'organization-id': s.destination.id, kind: 'api-key' },
    });
    const listed = await call('GET', '/api/v1/connect/share-tokens', s.destination.sandboxKey);
    expect(listed.body).not.toContain('source-data');
  });
});

describe('the redemption’s re-read and the access export’s read (C234.2, C253.2)', () => {
  it('re-reads the token, the connection, the policy, the consent and the source for the destination', async () => {
    const s = await sharedToken();
    const caller = {
      organizationId: s.destination.id,
      environmentId: s.destination.sandbox,
      environmentKind: 'sandbox' as const,
    };
    const token = await crossTenant.getInboundShareToken(api.database.db, caller, s.tokenId);
    const read = await api.database.db.transaction((tx) =>
      crossTenant.readRedemptionSource(tx, caller, token),
    );
    expect(read.token.id).toBe(s.tokenId);
    expect(read.connection.id).toBe(s.connectionId);
    expect(read.policy.purpose).toBe('share.reuse-kyc');
    expect(read.sourceConsent?.id).toBe(s.consentId);
    expect(read.destinationConsent).toBeNull();
    expect(read.source?.content.type).toBe('inquiry');
    expect(read.sourceOrganizationName).toBe('Example Source');
    await expect(
      api.database.db.transaction((tx) =>
        crossTenant.readRedemptionSource(
          tx,
          { ...caller, environmentId: s.source.sandbox, organizationId: s.source.id },
          token,
        ),
      ),
    ).rejects.toThrow(/not found/);
  });

  it('finds a person’s shares on either side, and nothing for another environment', async () => {
    const s = await sharedToken();
    const atSource = await crossTenant.listSharesTouching(api.database.db, s.source.sandbox, [
      s.inquiryId,
    ]);
    expect(atSource.tokens.map((token) => token.id)).toEqual([s.tokenId]);
    expect(atSource.consentRecords.map((record) => record.id)).toEqual([s.consentId]);
    const elsewhere = await crossTenant.listSharesTouching(api.database.db, s.destination.sandbox, [
      s.inquiryId,
    ]);
    expect(elsewhere.tokens).toEqual([]);
  });
});

describe('loading a share’s source (C232.1, C233.4)', () => {
  it('reads an account and a transaction with their declared field types, and nothing unknown', async () => {
    const owner = await organisation('Example Owner', false);
    const { db } = api.database;
    const account = await createAccount(db, owner.sandbox, {
      id: newId('acc'),
      fields: { name_first: 'Alex' },
    });
    const accountSource = await loadShareSource(db, owner.sandbox, 'account', account.id);
    expect(accountSource).toMatchObject({
      redacted: false,
      holdingInquiryId: null,
      content: {
        type: 'account',
        object: { id: account.id, cloned: false, attributes: { status: 'active' } },
      },
    });
    expect(
      accountSource?.content.type === 'account' ? accountSource.content.object.fields : [],
    ).toEqual([{ key: 'name_first', type: 'string', value: 'Alex' }]);

    const type = await createTransactionType(db, owner.sandbox, {
      id: newId('txntp'),
      name: 'Example payment',
    });
    const version = await createTransactionTypeVersion(db, owner.sandbox, {
      id: newId('txntpv'),
      transactionTypeId: type.id,
      version: 1,
      fieldSchemas: [{ key: 'amount', type: 'number' }],
      statuses: ['created'],
      relationSchemas: [],
      allowCardLikeStrings: false,
    });
    const transaction = await createTransaction(db, owner.sandbox, {
      id: newId('txn'),
      transactionTypeId: type.id,
      transactionTypeVersionId: version.id,
      referenceId: null,
      status: 'created',
      fields: { amount: 12, memo: 'synthetic' },
      tags: [],
    });
    const transactionSource = await loadShareSource(
      db,
      owner.sandbox,
      'transaction',
      transaction.id,
    );
    expect(
      transactionSource?.content.type === 'transaction'
        ? transactionSource.content.object.fields
        : [],
    ).toEqual([
      { key: 'amount', type: 'number', value: 12 },
      { key: 'memo', type: 'string', value: 'synthetic' },
    ]);

    for (const [sourceType, prefix] of [
      ['inquiry', 'inq'],
      ['account', 'acc'],
      ['transaction', 'txn'],
      ['verification', 'ver'],
    ] as const) {
      expect(await loadShareSource(db, owner.sandbox, sourceType, newId(prefix))).toBeNull();
    }
  });

  // F001/F002 (Workflow 11F review): a field hydrated from another organisation is a copy, so it
  // is never shared on under the destination's name; the object's own fields still are.
  it('leaves out the fields hydrated into an account or an inquiry', async () => {
    const owner = await organisation('Example Hydrated', false);
    const { db } = api.database;
    const hydrated = JSON.stringify([
      {
        'share-token-id': newId('cnst'),
        fields: ['name_first'],
        'hydrated-at': '2026-11-01T00:00:00.000Z',
      },
    ]);
    const account = await createAccount(db, owner.sandbox, {
      id: newId('acc'),
      fields: { name_first: 'Alex', name_last: 'Example' },
    });
    await db
      .update(accounts)
      .set({ hydratedFields: sql`${hydrated}::jsonb` })
      .where(eq(accounts.id, account.id));

    const accountSource = await loadShareSource(db, owner.sandbox, 'account', account.id);

    expect(
      accountSource?.content.type === 'account' ? accountSource.content.object.fields : null,
    ).toEqual([{ key: 'name_last', type: 'string', value: 'Example' }]);

    const s = await sharedToken();
    await db
      .update(inquiries)
      .set({
        fields: { name_first: 'Alex', name_middle: 'Sam' },
        hydratedFields: sql`${hydrated}::jsonb`,
      })
      .where(eq(inquiries.id, s.inquiryId));
    const inquirySource = await loadShareSource(db, s.source.sandbox, 'inquiry', s.inquiryId);
    const inquiryKeys =
      inquirySource?.content.type === 'inquiry'
        ? inquirySource.content.object.fields.map((field) => field.key)
        : null;
    expect(inquiryKeys).toContain('name_middle');
    expect(inquiryKeys).not.toContain('name_first');
  });

  it('reads a verification with its holding inquiry, redacted when the inquiry is', async () => {
    const s = await sharedToken();
    const { db } = api.database;
    const inquiry = await loadShareSource(db, s.source.sandbox, 'inquiry', s.inquiryId);
    const verificationId =
      inquiry?.content.type === 'inquiry' ? (inquiry.content.verifications[0]?.id ?? '') : '';
    const before = await loadShareSource(db, s.source.sandbox, 'verification', verificationId);
    expect(before).toMatchObject({ redacted: false, holdingInquiryId: s.inquiryId });
    await db
      .update(inquiries)
      .set({ redactedAt: api.clock.now() })
      .where(eq(inquiries.id, s.inquiryId));
    const after = await loadShareSource(db, s.source.sandbox, 'verification', verificationId);
    expect(after?.redacted).toBe(true);
    // A redacted source is never peeked: the read through the cross-tenant module answers null.
    const caller = {
      organizationId: s.destination.id,
      environmentId: s.destination.sandbox,
      environmentKind: 'sandbox' as const,
    };
    const token = await crossTenant.getInboundShareToken(db, caller, s.tokenId);
    expect(await crossTenant.readPeekSource(db, caller, token)).toBeNull();
  });

  it('answers no envelope for a source the policy does not share', async () => {
    const s = await sharedToken();
    const loaded = await loadShareSource(api.database.db, s.source.sandbox, 'inquiry', s.inquiryId);
    expect(
      peekEnvelopeOf(
        {
          ...(POLICY as never as Parameters<typeof peekEnvelopeOf>[0]),
          'source-types': ['account'],
        },
        loaded?.content ?? {
          type: 'account',
          object: { id: '', cloned: false, attributes: {}, fields: [] },
        },
      ),
    ).toBeNull();
  });
});
