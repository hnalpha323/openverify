/**
 * C238.3, C238.4, C234.11 (Workflow 11A, `api-consent` checkpoint 5): the `share_consent` step on the
 * destination side, on an inquiry created for a share token. The view names the source and the
 * caller as recipient, with the token's stored categories; the accept records a destination `flow`
 * record citing the token, requests the `fill-inquiry` redemption into this inquiry in the same
 * transaction (the token `pending`, its job enqueued after the commit) and moves on. The token's
 * write is `cross-tenant.ts`'s entry point `api-connect` has not built, so the test passes a fake
 * port (as `api-redeem`'s suites do); the route answers 501 meanwhile and records nothing.
 *
 * Every value is synthetic.
 */
import { flowSessionResponseSchema, newId } from '@openverify/contracts';
import {
  createConsentRecord,
  getInquiry,
  listInquiryFlowConsents,
  type ConnectShareToken,
} from '@openverify/db';
import { createTestInquiry } from '@openverify/db/testing';
import { flowV2Schema } from '@openverify/flow-spec';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConnectRedeemJob } from '../../jobs/connect-queues.js';
import {
  seedConnection,
  seedShareToken,
  shareTokenRow,
} from '../../services/connect/consent.test-support.js';
import { crossTenant } from '../../services/connect/cross-tenant.js';
import type { RedemptionCrossTenant } from '../../services/connect/redeem.js';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import { notBuilt } from '../../workflows/not-built.js';
import { bearer, resumeInquiry } from '../../test-support/harness.js';
import { actOnShareConsent } from './share-consents.js';

const jobs: ConnectRedeemJob[] = [];
let api: InquiryTestApi;
let source: Awaited<ReturnType<InquiryTestApi['newTenant']>>;
let connection: { id: string; policyId: string };

beforeAll(async () => {
  api = await createInquiryTestApi({
    connect: { enabled: true },
    connectRedeems: {
      enqueueConnectRedeem: (job) => {
        jobs.push(job);
        return Promise.resolve();
      },
    },
  });
  source = await api.newTenant();
  // C238.9: the destination text states the retention term (here the environment's).
  await api.database.client.query(
    `update environments set settings = settings || '{"inquiry-retention-days": 365}'::jsonb
      where id = $1`,
    [api.environmentId],
  );
  connection = await seedConnection(api.database.db, {
    sourceOrganizationId: source.organizationId,
    destinationOrganizationId: api.organizationId,
  });
});

afterAll(async () => {
  await api.close();
});

const flow = flowV2Schema.parse({
  metadata: { specVersion: 2, id: 'fill', version: 1, name: 'Fill' },
  entry: 'share-in',
  steps: [
    {
      id: 'share-in',
      type: 'share_consent',
      side: 'destination',
      withdrawalContact: 'write to privacy@example.com',
    },
    {
      id: 'about',
      type: 'screen',
      components: [{ id: 'go', kind: 'button', labelKey: 'screen.continue', action: 'submit' }],
    },
    { id: 'done', type: 'completion' },
  ],
  edges: [
    { id: 'e1', from: 'share-in', port: 'next', to: 'about' },
    { id: 'e2', from: 'about', port: 'next', to: 'done' },
  ],
});

/** The redemption's token write, as `cross-tenant.ts`'s entry point would do it. */
const redemption: RedemptionCrossTenant = {
  getInboundShareToken: (db, caller, id) => crossTenant.getInboundShareToken(db, caller, id),
  lockInboundShareToken: (tx, caller, id) => crossTenant.lockInboundShareToken(tx, caller, id),
  async markInboundShareToken(tx, _caller, token, changes) {
    await tx.execute(sql`update connect_share_tokens set status = ${changes.status ?? token.status},
      pending_at = ${changes.pendingAt ?? null}, redeem_mode = ${changes.redeemMode ?? null},
      destination_type = ${changes.destinationType ?? null},
      destination_id = ${changes.destinationId ?? null},
      destination_consent_record_id = ${changes.destinationConsentRecordId ?? null}
      where id = ${token.id}`);
    return { ...token, ...changes } as ConnectShareToken;
  },
  readRedemptionSource: () => notBuilt('connect: readRedemptionSource'),
};

async function reserved() {
  const { inquiry } = await createTestInquiry(api.database.db, api.environmentId, { flow });
  const consent = await createConsentRecord(api.database.db, source.environmentId, {
    id: newId('cnsr'),
    side: 'source',
    outcome: 'accepted',
    purpose: 'share.reuse-kyc',
    subjectType: 'inquiry',
    subjectId: newId('inq'),
    connectionId: connection.id,
    recipientOrganizationId: api.organizationId,
    recipientName: 'Example Test Org',
    dataCategories: ['identity-fields', 'check-results'],
    explicitBiometric: false,
    textLocale: 'en',
    textKeys: ['share.consent.source'],
    textSha256: 'a'.repeat(64),
    method: 'flow',
    sessionId: newId('iqse'),
    acceptedAt: api.clock.now(),
    expiresAt: new Date(api.clock.now().getTime() + 86_400_000),
  });
  const token = await seedShareToken(api.database.db, {
    sourceEnvironmentId: source.environmentId,
    destinationEnvironmentId: api.environmentId,
    connection,
    consentRecordId: consent.id,
    reservedInquiryId: inquiry.id,
  });
  const sessionToken = await resumeInquiry(api, inquiry.id);
  const read = await api.app.inject({
    url: '/api/v1/flow/session',
    headers: { ...bearer(sessionToken), 'openverify-flow-spec': '2' },
  });
  expect(read.statusCode, read.body).toBe(200);
  const sessions = await api.database.client.query<{ id: string }>(
    'select id from inquiry_sessions where inquiry_id = $1',
    [inquiry.id],
  );
  return {
    inquiryId: inquiry.id,
    token,
    sessionToken,
    session: {
      id: sessions.rows[0]?.id ?? '',
      environmentId: api.environmentId,
      inquiryId: inquiry.id,
    },
    view: (
      flowSessionResponseSchema.parse(read.json()) as {
        step?: {
          side: string;
          recipientName: string;
          categories: string[];
          text: { sha256: string };
        };
      }
    ).step,
  };
}

describe('the destination side (C238.3, C238.4, C234.11)', () => {
  it('serves the token’s categories and requests the fill-inquiry redemption on the accept', async () => {
    const at = await reserved();
    expect(at.view).toMatchObject({
      side: 'destination',
      recipientName: 'Example Test Org',
      categories: ['identity-fields', 'check-results'],
    });
    await actOnShareConsent(
      api.deps,
      at.session,
      'share-in',
      {
        outcome: 'accepted',
        body: { 'text-sha256': at.view?.text.sha256 ?? '', 'explicit-biometric': false },
        evidence: { ip: '192.0.2.90', userAgent: 'synthetic-browser/5' },
      },
      redemption,
    );
    const [record] = await listInquiryFlowConsents(
      api.database.db,
      api.environmentId,
      at.inquiryId,
    );
    expect(record).toMatchObject({
      side: 'destination',
      shareTokenId: at.token,
      outcome: 'accepted',
    });
    expect(await shareTokenRow(api.database.db, at.token)).toMatchObject({ status: 'pending' });
    expect(jobs.at(-1)).toEqual({ environmentId: api.environmentId, shareTokenId: at.token });
    expect((await getInquiry(api.database.db, api.environmentId, at.inquiryId))?.flowStepId).toBe(
      'about',
    );
  });

  it('accepts through the route with the production binding: record kept, token pending, job queued (integration-11a)', async () => {
    const at = await reserved();
    const before = jobs.length;
    const response = await api.app.inject({
      method: 'POST',
      url: '/api/v1/flow/share-consents/share-in/accept',
      headers: { ...bearer(at.sessionToken), 'openverify-flow-spec': '2' },
      payload: { 'text-sha256': at.view?.text.sha256, 'explicit-biometric': false },
    });
    expect(response.statusCode, response.body).toBe(200);
    const [record] = await listInquiryFlowConsents(
      api.database.db,
      api.environmentId,
      at.inquiryId,
    );
    expect(record).toMatchObject({ side: 'destination', outcome: 'accepted' });
    expect((await shareTokenRow(api.database.db, at.token)).status).toBe('pending');
    expect(jobs.length).toBe(before + 1);
    expect(response.body).not.toContain(at.token);
  });

  it('records a decline without requesting a redemption, and the flow continues', async () => {
    const at = await reserved();
    const before = jobs.length;
    await actOnShareConsent(api.deps, at.session, 'share-in', { outcome: 'declined' }, redemption);
    const [record] = await listInquiryFlowConsents(
      api.database.db,
      api.environmentId,
      at.inquiryId,
    );
    expect(record).toMatchObject({ side: 'destination', outcome: 'declined' });
    expect(jobs.length).toBe(before);
    expect((await shareTokenRow(api.database.db, at.token)).status).toBe('created');
  });
});
