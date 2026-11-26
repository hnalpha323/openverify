/**
 * C238.3, C238.4, C237.6 (Workflow 11A, `api-consent` checkpoint 3): the `share_consent` step on the
 * flow API, source side.
 *
 * - The view (C238.3): composed by the server from the built-in text (the flow's export), the
 *   connection's names, the categories the policy can carry, the step's withdrawal contact and
 *   validity, NFC, its digest the logical form's (`consentTextDigest(body, {}, false)`); the biometric
 *   tick's own text when the share can carry `biometric`; no token, connection or source id anywhere.
 * - The accept (C238.4): only at the current position (409 `flow_step_not_current`), the digests of
 *   what was served (422 `consent_text_mismatch`), the tick when biometric (422
 *   `explicit_consent_required`), a `flow` record with the session, the time and the request's
 *   address and user agent sealed; the flow moves on through `next`.
 * - The decline (C236.11, C238.1): a declined record without address, agent or copy, and the flow
 *   moves on.
 * - The withdraw exit (C237.6, V02): listed in `withdrawable-share-consents` after an accept, refused
 *   for a step not listed (409 `flow_step_not_current`), withdrawing without moving the position.
 *
 * Every value is synthetic.
 */
import { createHash } from 'node:crypto';
import { flowSessionResponseSchema } from '@openverify/contracts';
import { getConsentRecord, getInquiry, listInquiryFlowConsents } from '@openverify/db';
import { createTestInquiry } from '@openverify/db/testing';
import { flowV2Schema } from '@openverify/flow-spec';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FULL_POLICY, seedConnection } from '../../services/connect/consent.test-support.js';
import { shareConsentPreviewView } from '../../services/flow-views/share-consent.js';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import { consentTextDigest } from '../../services/templates/consent-texts.js';
import { bearer, resumeInquiry } from '../../test-support/harness.js';

let api: InquiryTestApi;
let connectionId: string;
let plainConnectionId: string;

beforeAll(async () => {
  api = await createInquiryTestApi({ connect: { enabled: true } });
  const partner = await api.newTenant();
  connectionId = (
    await seedConnection(api.database.db, {
      sourceOrganizationId: api.organizationId,
      destinationOrganizationId: partner.organizationId,
    })
  ).id;
  const other = await api.newTenant();
  plainConnectionId = (
    await seedConnection(api.database.db, {
      sourceOrganizationId: api.organizationId,
      destinationOrganizationId: other.organizationId,
      policy: {
        ...FULL_POLICY,
        biometric: false,
        verifications: { ...FULL_POLICY.verifications, types: ['government-id'] },
      },
    })
  ).id;
});

afterAll(async () => {
  await api.close();
});

const CONTACT = 'write to privacy@example.com';

const flowOf = (connection: string) =>
  flowV2Schema.parse({
    metadata: { specVersion: 2, id: 'share', version: 1, name: 'Share' },
    entry: 'share-out',
    steps: [
      {
        id: 'share-out',
        type: 'share_consent',
        side: 'source',
        connectionId: connection,
        consentValidSeconds: 1_209_600,
        withdrawalContact: CONTACT,
      },
      {
        id: 'about',
        type: 'screen',
        components: [{ id: 'go', kind: 'button', labelKey: 'screen.continue', action: 'submit' }],
      },
      { id: 'done', type: 'completion' },
    ],
    edges: [
      { id: 'e1', from: 'share-out', port: 'next', to: 'about' },
      { id: 'e2', from: 'about', port: 'next', to: 'done' },
    ],
  });

interface Session {
  inquiryId: string;
  token: string;
}

async function open(connection = connectionId): Promise<Session> {
  const { inquiry } = await createTestInquiry(api.database.db, api.environmentId, {
    flow: flowOf(connection),
  });
  return { inquiryId: inquiry.id, token: await resumeInquiry(api, inquiry.id) };
}

const read = async (session: Session) => {
  const response = await api.app.inject({
    url: '/api/v1/flow/session',
    headers: { ...bearer(session.token), 'openverify-flow-spec': '2' },
  });
  expect(response.statusCode, response.body).toBe(200);
  return flowSessionResponseSchema.parse(response.json()) as unknown as {
    position?: { 'step-id': string };
    step?: {
      type: string;
      text: { sha256: string; body: string; keys: string[]; locale: string };
      biometric?: { sha256: string; body: string };
      recipientName: string;
      sourceName: string;
      categories: string[];
    };
    'withdrawable-share-consents'?: { 'step-id': string; side: string; 'recipient-name': string }[];
  };
};

const exit = (session: Session, stepId: string, action: string, payload: unknown = {}) =>
  api.app.inject({
    method: 'POST',
    url: `/api/v1/flow/share-consents/${stepId}/${action}`,
    headers: {
      ...bearer(session.token),
      'openverify-flow-spec': '2',
      'user-agent': 'synthetic-browser/3.0',
    },
    payload: payload as Record<string, unknown>,
  });

describe('the view (C238.3)', () => {
  it('composes the text, its digest and the biometric tick, with no id of the share', async () => {
    const session = await open();
    const served = await read(session);
    expect(served.position?.['step-id']).toBe('share-out');
    const step = served.step;
    expect(step?.type).toBe('share_consent');
    expect(step?.recipientName).toBe('Example Test Org');
    expect(step?.sourceName).toBe('Example Test Org');
    expect(step?.text.keys).toEqual(['share.consent.source']);
    expect(step?.text.body).toContain(CONTACT);
    expect(step?.text.body).toBe(step?.text.body.normalize('NFC'));
    // The digest is the logical form's, the same as Phase 9's consentTextDigest of the body.
    expect(step?.text.sha256).toBe(consentTextDigest(step?.text.body ?? '', {}, false));
    expect(step?.text.sha256).toBe(
      createHash('sha256')
        .update(step?.text.body ?? '', 'utf8')
        .digest('hex'),
    );
    expect(step?.categories).toContain('biometric');
    expect(step?.biometric?.sha256).toBe(consentTextDigest(step?.biometric?.body ?? '', {}, false));
    const serialized = JSON.stringify(served);
    expect(serialized).not.toContain(connectionId);
    expect(serialized).not.toContain('cnst_');
  });

  it('serves no biometric tick when the policy cannot carry biometric', async () => {
    const served = await read(await open(plainConnectionId));
    expect(served.step?.categories).not.toContain('biometric');
    expect(served.step?.biometric).toBeUndefined();
  });

  it('gives the template preview a labelled sample, never an uncomposed text', () => {
    const [first] = flowOf(connectionId).steps;
    if (first === undefined) throw new Error('no step');
    const view = shareConsentPreviewView(first);
    expect(view?.sourceName).toContain('(sample)');
    expect(view?.text.body).not.toMatch(/\{\{?\w+\}\}?/);
  });
});

describe('the accept (C238.4, C236.4)', () => {
  it('records a flow consent at the position, with the act’s evidence, and moves on', async () => {
    const session = await open();
    const step = (await read(session)).step;
    const response = await exit(session, 'share-out', 'accept', {
      'text-sha256': step?.text.sha256,
      'biometric-text-sha256': step?.biometric?.sha256,
      'explicit-biometric': true,
    });
    expect(response.statusCode, response.body).toBe(200);
    const after = flowSessionResponseSchema.parse(response.json()) as {
      position?: { 'step-id': string };
      'withdrawable-share-consents'?: { 'step-id': string }[];
    };
    expect(after.position?.['step-id']).toBe('about');
    expect(after['withdrawable-share-consents']).toEqual([
      { 'step-id': 'share-out', side: 'source', 'recipient-name': 'Example Test Org' },
    ]);
    const [record] = await listInquiryFlowConsents(
      api.database.db,
      api.environmentId,
      session.inquiryId,
    );
    expect(record).toMatchObject({
      side: 'source',
      outcome: 'accepted',
      method: 'flow',
      connectionId,
      textSha256: step?.text.sha256,
      biometricTextSha256: step?.biometric?.sha256,
      explicitBiometric: true,
      evidenceUserAgent: 'synthetic-browser/3.0',
    });
    expect(record?.expiresAt.getTime()).toBe(api.clock.now().getTime() + 1_209_600_000);
    expect(api.events.named('consent-record.created').at(-1)?.environmentId).toBe(
      api.environmentId,
    );
  });

  it('refuses another text, a missing tick and a step that is not the current one', async () => {
    const session = await open();
    const step = (await read(session)).step;
    const wrong = await exit(session, 'share-out', 'accept', {
      'text-sha256': 'f'.repeat(64),
      'explicit-biometric': true,
      'biometric-text-sha256': step?.biometric?.sha256,
    });
    expect(wrong.statusCode).toBe(422);
    expect(wrong.json<{ code: string }>().code).toBe('consent_text_mismatch');
    const untick = await exit(session, 'share-out', 'accept', {
      'text-sha256': step?.text.sha256,
      'explicit-biometric': false,
    });
    expect(untick.statusCode).toBe(422);
    expect(untick.json<{ code: string }>().code).toBe('explicit_consent_required');
    const elsewhere = await exit(session, 'about', 'accept', {
      'text-sha256': step?.text.sha256,
      'explicit-biometric': true,
    });
    expect(elsewhere.statusCode).toBe(409);
    expect(elsewhere.json<{ code: string }>().code).toBe('flow_step_not_current');
    expect(
      await listInquiryFlowConsents(api.database.db, api.environmentId, session.inquiryId),
    ).toEqual([]);
  });
});

describe('the decline (C236.11, C238.1)', () => {
  it('records a declined consent without the act’s address, agent or copy, and continues', async () => {
    const session = await open();
    const response = await exit(session, 'share-out', 'decline');
    expect(response.statusCode, response.body).toBe(200);
    expect(
      (flowSessionResponseSchema.parse(response.json()) as { position?: { 'step-id': string } })
        .position?.['step-id'],
    ).toBe('about');
    const [record] = await listInquiryFlowConsents(
      api.database.db,
      api.environmentId,
      session.inquiryId,
    );
    expect(record).toMatchObject({
      outcome: 'declined',
      evidenceIp: null,
      evidenceUserAgent: null,
      biometricTextSha256: null,
    });
    expect(api.events.named('consent-record.declined').at(-1)?.environmentId).toBe(
      api.environmentId,
    );
    const inquiry = await getInquiry(api.database.db, api.environmentId, session.inquiryId);
    expect(inquiry?.status).not.toBe('declined');
  });
});

describe('the withdraw exit (C237.6, V02)', () => {
  it('withdraws a listed consent without moving the position, and refuses one not listed', async () => {
    const session = await open();
    expect((await exit(session, 'share-out', 'withdraw')).statusCode).toBe(409);
    const step = (await read(session)).step;
    await exit(session, 'share-out', 'accept', {
      'text-sha256': step?.text.sha256,
      'biometric-text-sha256': step?.biometric?.sha256,
      'explicit-biometric': true,
    });
    const response = await exit(session, 'share-out', 'withdraw');
    expect(response.statusCode, response.body).toBe(200);
    const after = flowSessionResponseSchema.parse(response.json()) as {
      position?: { 'step-id': string };
      'withdrawable-share-consents'?: unknown[];
    };
    expect(after.position?.['step-id']).toBe('about');
    expect(after['withdrawable-share-consents']).toBeUndefined();
    const [record] = await listInquiryFlowConsents(
      api.database.db,
      api.environmentId,
      session.inquiryId,
    );
    expect(
      (await getConsentRecord(api.database.db, api.environmentId, record?.id ?? ''))?.withdrawnVia,
    ).toBe('flow');
    expect((await exit(session, 'share-out', 'withdraw')).statusCode).toBe(409);
  });
});
