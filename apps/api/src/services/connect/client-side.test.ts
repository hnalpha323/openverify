/**
 * C238.1, C238.4, C238.5 (Workflow 11A, `api-consent` checkpoint 5): client-side redemption.
 *
 * - `POST /api/v1/inquiries` with `meta.share-token-id` (through `createInquiryWithShareToken`): the
 *   token inbound to the caller (the one 404), `created` and unexpired, from an inquiry or a
 *   verification (422 `share_redeem_mode_invalid`), the template with a destination-side
 *   `share_consent` step (422 `share_consent_step_missing`), one inquiry per token (409
 *   `share_token_in_use`); the inquiry created and the token reserved in one transaction. The
 *   reservation is `cross-tenant.ts`'s entry point, which `api-connect` has not built: the test passes
 *   a fake port, as `api-redeem`'s suites do, and the production binding answers 501 until then.
 * - The engine skips a destination-side step on an inquiry without a share token (`skipped`).
 *
 * Every value is synthetic.
 */
import { newId } from '@openverify/contracts';
import { createConsentRecord, getInquiry, listInquiryFlowSteps } from '@openverify/db';
import { createTestInquiry } from '@openverify/db/testing';
import { flowV2Schema } from '@openverify/flow-spec';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UNMASKED } from '../../auth/pii.js';
import { bearer, expectStatus, resumeInquiry } from '../../test-support/harness.js';
import { createInquiryTestApi, type InquiryTestApi } from '../inquiries.test-support.js';
import {
  clientSideCrossTenant,
  createInquiryWithShareToken,
  type ClientSideCrossTenant,
} from './client-side.js';
import { seedConnection, seedShareToken } from './consent.test-support.js';
import { crossTenant } from './cross-tenant.js';

let api: InquiryTestApi;
let source: Awaited<ReturnType<InquiryTestApi['newTenant']>>;
let connection: { id: string; policyId: string };

beforeAll(async () => {
  api = await createInquiryTestApi({ connect: { enabled: true } });
  source = await api.newTenant();
  connection = await seedConnection(api.database.db, {
    sourceOrganizationId: source.organizationId,
    destinationOrganizationId: api.organizationId,
  });
});

afterAll(async () => {
  await api.close();
});

const CONTACT = 'write to privacy@example.com';

const destinationFlow = flowV2Schema.parse({
  metadata: { specVersion: 2, id: 'fill', version: 1, name: 'Fill' },
  entry: 'share-in',
  steps: [
    { id: 'share-in', type: 'share_consent', side: 'destination', withdrawalContact: CONTACT },
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

/** A token of the source environment, inbound to the test's environment. */
async function inboundToken(
  options: { status?: 'created' | 'expired'; sourceType?: 'inquiry' | 'account' } = {},
) {
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
  return seedShareToken(api.database.db, {
    sourceEnvironmentId: source.environmentId,
    destinationEnvironmentId: api.environmentId,
    connection,
    consentRecordId: consent.id,
    ...(options.status === undefined ? {} : { status: options.status }),
    ...(options.sourceType === 'account' ? { sourceType: 'account', sourceId: newId('acc') } : {}),
  });
}

/** The fake reservation: the row written as `cross-tenant.ts`'s entry point would. */
const port: ClientSideCrossTenant = {
  getInboundShareToken: (db, caller, id) => crossTenant.getInboundShareToken(db, caller, id),
  lockInboundShareToken: (tx, caller, id) => crossTenant.lockInboundShareToken(tx, caller, id),
  async reserveInboundShareToken(tx, _caller, token, inquiryId) {
    const result: unknown = await tx.execute(
      sql`update connect_share_tokens set reserved_inquiry_id = ${inquiryId}
          where id = ${token.id} returning id`,
    );
    expect((result as { rows: unknown[] }).rows).toHaveLength(1);
    return { ...token, reservedInquiryId: inquiryId };
  },
};

const acting = () => ({
  ctx: { organizationId: api.organizationId, environmentId: api.environmentId },
  actor: { type: 'api-key' as const, id: newId('key') },
  mask: UNMASKED,
  environmentKind: 'sandbox' as const,
});

async function templateWith(flow: Record<string, unknown>) {
  const { template } = await createTestInquiry(api.database.db, api.environmentId, { flow });
  return template.id;
}

const create = (templateId: string, tokenId: string, use = port) =>
  createInquiryWithShareToken(
    api.deps,
    acting(),
    { 'inquiry-template-id': templateId },
    { 'share-token-id': tokenId },
    use,
  );

describe('POST /inquiries with meta.share-token-id (C238.5)', () => {
  it('creates the inquiry and reserves the token for it, once', async () => {
    const templateId = await templateWith(destinationFlow);
    const token = await inboundToken();
    const inquiry = await create(templateId, token);
    const reserved = await api.database.client.query<{ reserved_inquiry_id: string }>(
      'select reserved_inquiry_id from connect_share_tokens where id = $1',
      [token],
    );
    expect(reserved.rows[0]?.reserved_inquiry_id).toBe(inquiry.id);
    await expect(create(templateId, token)).rejects.toMatchObject({ code: 'share_token_in_use' });
  });

  it('answers the one 404 for a token not inbound to the caller', async () => {
    const templateId = await templateWith(destinationFlow);
    await expect(create(templateId, 'cnst_01M5CN0000000000000011A999')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('refuses an expired token, an account source and a template without the step', async () => {
    const templateId = await templateWith(destinationFlow);
    await expect(
      create(templateId, await inboundToken({ status: 'expired' })),
    ).rejects.toMatchObject({ code: 'share_token_expired' });
    await expect(
      create(templateId, await inboundToken({ sourceType: 'account' })),
    ).rejects.toMatchObject({ code: 'share_redeem_mode_invalid' });
    const plain = await templateWith({});
    await expect(create(plain, await inboundToken())).rejects.toMatchObject({
      code: 'share_consent_step_missing',
    });
  });

  it('reserves the token through the route with the production binding (integration-11a)', async () => {
    const templateId = await templateWith(destinationFlow);
    const tokenId = await inboundToken();
    const response = await api.app.inject({
      method: 'POST',
      url: '/api/v1/inquiries',
      headers: { ...bearer(api.token), 'idempotency-key': 'synthetic-reserve-1' },
      payload: {
        data: { attributes: { 'inquiry-template-id': templateId } },
        meta: { 'share-token-id': tokenId },
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    const inquiryId = (JSON.parse(response.body) as { data: { id: string } }).data.id;
    const reserved = await api.database.client.query<{ reserved_inquiry_id: string }>(
      'select reserved_inquiry_id from connect_share_tokens where id = $1',
      [tokenId],
    );
    expect(reserved.rows[0]?.reserved_inquiry_id).toBe(inquiryId);
    expect(response.body).not.toContain(tokenId);
  });

  it('needs connect-share-tokens:redeem beside inquiries:write, reserving nothing without it (C238.5; integration-11a)', async () => {
    const templateId = await templateWith(destinationFlow);
    const tokenId = await inboundToken();
    const key = await api.newApiKey(api.environmentId, { scopes: ['inquiries:write'] });
    const response = await api.app.inject({
      method: 'POST',
      url: '/api/v1/inquiries',
      headers: { ...bearer(key), 'idempotency-key': 'synthetic-reserve-scope' },
      payload: {
        data: { attributes: { 'inquiry-template-id': templateId } },
        meta: { 'share-token-id': tokenId },
      },
    });
    expect(response.statusCode, response.body).toBe(403);
    expect(response.body).toContain('connect-share-tokens:redeem');
    const reserved = await api.database.client.query<{ reserved_inquiry_id: string | null }>(
      'select reserved_inquiry_id from connect_share_tokens where id = $1',
      [tokenId],
    );
    expect(reserved.rows[0]?.reserved_inquiry_id).toBeNull();
  });

  it('refuses a second reservation of the same token with 409 share_token_in_use', async () => {
    const templateId = await templateWith(destinationFlow);
    const tokenId = await inboundToken();
    const first = await create(templateId, tokenId, clientSideCrossTenant);
    expect(first).toBeDefined();
    await expect(create(templateId, tokenId, clientSideCrossTenant)).rejects.toMatchObject({
      code: 'share_token_in_use',
    });
  });
});

describe('a destination-side step without a share token (C238.1)', () => {
  it('is skipped by the engine: the position moves on to the next step', async () => {
    const { inquiry } = await createTestInquiry(api.database.db, api.environmentId, {
      flow: destinationFlow,
    });
    const token = await resumeInquiry(api, inquiry.id);
    const session = expectStatus(
      await api.app.inject({
        url: '/api/v1/flow/session',
        headers: { ...bearer(token), 'openverify-flow-spec': '2' },
      }),
      200,
    ) as unknown as { position?: { 'step-id': string } };
    expect(session.position?.['step-id']).toBe('about');
    const record = await listInquiryFlowSteps(api.database.db, api.environmentId, inquiry.id);
    expect(record.find((entry) => entry.stepId === 'share-in')?.outcome).toBe('skipped');
    expect((await getInquiry(api.database.db, api.environmentId, inquiry.id))?.flowStepId).toBe(
      'about',
    );
  });
});
