import {
  defaultInquiryTemplateAttributes,
  flowConsentResponseSchema,
  flowSessionResponseSchema,
} from '@openverify/contracts';
import { getInquiry, getLatestInquiryConsent, transitionInquiryStatus } from '@openverify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import {
  bearer,
  createTemplate,
  expectStatus,
  openFlowSession,
  PROBLEM_JSON,
  seedVerification,
} from '../../test-support/harness.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const SESSION = '/api/v1/flow/session';
const CONSENT = '/api/v1/flow/consent';
const CONSENT_BODY = {
  accepted: true,
  'text-keys': ['consent.biometric', 'consent.processing', 'notice.session-integrity'],
  locale: 'en',
};

function getSession(token: string) {
  return api.app.inject({ url: SESSION, headers: bearer(token) });
}

function postConsent(token: string, body: Record<string, unknown> = CONSENT_BODY) {
  return api.app.inject({
    method: 'POST',
    url: CONSENT,
    headers: { ...bearer(token), 'user-agent': 'SyntheticBrowser/1.0' },
    payload: body,
    remoteAddress: '198.51.100.23',
  });
}

describe('GET /api/v1/flow/session', () => {
  it('returns the inquiry, the flow and no consent yet', async () => {
    const { inquiryId, sessionToken } = await openFlowSession(api);

    const body = flowSessionResponseSchema.parse(expectStatus(await getSession(sessionToken), 200));

    expect(body.inquiry).toEqual({ id: inquiryId, status: 'pending' });
    expect(body.flow).toEqual(defaultInquiryTemplateAttributes().flow);
    expect(body.verifications).toEqual([]);
    expect(body.consent).toBeNull();
  });

  it('moves the inquiry from created to pending once and publishes inquiry.started once', async () => {
    const { inquiryId, sessionToken } = await openFlowSession(api);

    await getSession(sessionToken);
    await getSession(sessionToken);

    const started = api.events
      .named('inquiry.started')
      .filter((e) => e.payload.data.id === inquiryId);
    expect(started).toHaveLength(1);
    expect(started[0]?.environmentId).toBe(api.environmentId);
    expect(started[0]?.payload.data).toMatchObject({ attributes: { status: 'pending' } });
  });

  it('publishes inquiry.started on a retry when the first attempt could not (F014)', async () => {
    const { inquiryId, sessionToken } = await openFlowSession(api);
    api.events.failNext(new Error('events table unavailable'));

    expect((await getSession(sessionToken)).statusCode).toBe(500);
    expect((await getInquiry(api.database.db, api.environmentId, inquiryId))?.status).toBe(
      'created',
    );
    expectStatus(await getSession(sessionToken), 200);

    expect(
      api.events.named('inquiry.started').filter((e) => e.payload.data.id === inquiryId),
    ).toHaveLength(1);
  });

  it('reports a finished inquiry as it is, without moving it', async () => {
    const { inquiryId, sessionToken } = await openFlowSession(api);
    await getSession(sessionToken);
    await transitionInquiryStatus(api.database.db, api.environmentId, inquiryId, {
      from: 'pending',
      to: 'failed',
    });

    const body = flowSessionResponseSchema.parse(expectStatus(await getSession(sessionToken), 200));

    expect(body.inquiry.status).toBe('failed');
  });

  it('lists every verification attempt with user-facing retry hints only', async () => {
    const { inquiryId, sessionToken } = await openFlowSession(api);
    const failed = await seedVerification(api, api.environmentId, inquiryId, {
      status: 'failed',
      checks: [
        { name: 'id_blur_detection', status: 'failed', reasons: ['image_blurry'] },
        {
          name: 'id_portrait_detection',
          status: 'failed',
          type: 'fraud',
          reasons: ['portrait_not_present'],
        },
        {
          name: 'id_glare_detection',
          status: 'failed',
          requirement: 'not_required',
          reasons: ['glare_present'],
        },
      ],
    });
    const retry = await seedVerification(api, api.environmentId, inquiryId);

    const response = await getSession(sessionToken);

    const body = flowSessionResponseSchema.parse(expectStatus(response, 200));
    expect(body.verifications).toEqual([
      {
        type: 'verification/government-id',
        id: failed.id,
        attributes: {
          status: 'failed',
          'retry-hints': [{ name: 'id_blur_detection', reasons: ['image_blurry'] }],
          'created-at': expect.any(String) as unknown,
          'updated-at': expect.any(String) as unknown,
        },
      },
      expect.objectContaining({ id: retry.id }),
    ]);
    expect(response.body).not.toContain('portrait_not_present');
    expect(response.body).not.toContain('checks');
  });

  it('never exposes the template check configuration', async () => {
    const { sessionToken } = await openFlowSession(api);

    const response = await getSession(sessionToken);

    expect(response.body).not.toContain('verification-config');
    expect(response.body).not.toContain('selfie_id_comparison');
  });
});

describe('GET /api/v1/flow/session environment (C19)', () => {
  it.each(['sandbox', 'production'] as const)('tells the flow it runs in %s', async (kind) => {
    const tenant = kind === 'sandbox' ? api : await api.newTenant({ kind });
    const { sessionToken } = await openFlowSession(api, { token: tenant.token });

    const body = flowSessionResponseSchema.parse(expectStatus(await getSession(sessionToken), 200));

    expect(body.environment).toEqual({ kind });
  });
});

describe('POST /api/v1/flow/consent', () => {
  it('records the consent with the client address and user agent, encrypted', async () => {
    const { inquiryId, sessionToken } = await openFlowSession(api);

    const response = await postConsent(sessionToken);

    const body = flowConsentResponseSchema.parse(expectStatus(response, 201));
    expect(body.consent['accepted-at']).toBe(api.clock.now().toISOString());
    expect(await getLatestInquiryConsent(api.database.db, api.environmentId, inquiryId)).toEqual({
      acceptedAt: api.clock.now(),
      textKeys: ['consent.biometric', 'consent.processing', 'notice.session-integrity'],
      // C42.3: no optional text was ticked.
      optionalTextKeys: [],
      locale: 'en',
      ip: '198.51.100.23',
      userAgent: 'SyntheticBrowser/1.0',
    });
    const { rows } = await api.database.client.query<{ consent: unknown }>(
      'select consent from inquiry_sessions where inquiry_id = $1',
      [inquiryId],
    );
    expect(JSON.stringify(rows[0]?.consent)).not.toContain('198.51.100.23');
  });

  it('shows the consent on the session afterwards', async () => {
    const { sessionToken } = await openFlowSession(api);
    await postConsent(sessionToken);

    const body = flowSessionResponseSchema.parse(expectStatus(await getSession(sessionToken), 200));

    expect(body.consent).toEqual({ 'accepted-at': api.clock.now().toISOString() });
  });

  it('keeps the consent for the inquiry across sessions', async () => {
    const { inquiryId, sessionToken } = await openFlowSession(api);
    await postConsent(sessionToken);
    const { meta } = expectStatus(
      await api.app.inject({
        method: 'POST',
        url: `/api/v1/inquiries/${inquiryId}/resume`,
        headers: bearer(api.token),
      }),
      200,
    );

    const body = flowSessionResponseSchema.parse(
      expectStatus(await getSession(meta?.['session-token'] ?? ''), 200),
    );

    expect(body.consent).not.toBeNull();
  });

  it('requires every consent text of the flow', async () => {
    const { sessionToken } = await openFlowSession(api);

    const response = await postConsent(sessionToken, {
      ...CONSENT_BODY,
      'text-keys': ['consent.biometric'],
    });

    expect(response.statusCode).toBe(422);
    expect(response.headers['content-type']).toBe(PROBLEM_JSON);
    expect(response.json<{ detail: string }>().detail).toContain('consent.processing');
  });

  it('accepts any text keys when the flow has no consent step', async () => {
    const attributes = defaultInquiryTemplateAttributes();
    attributes.flow.steps = attributes.flow.steps.filter((step) => step.type !== 'consent');
    const templateId = await createTemplate(api, api.token, attributes);
    const { sessionToken } = await openFlowSession(api, { templateId });

    const response = await postConsent(sessionToken, { ...CONSENT_BODY, 'text-keys': ['x.y'] });

    expect(response.statusCode).toBe(201);
  });

  it.each([
    ['not accepted', { ...CONSENT_BODY, accepted: false }],
    ['without text keys', { ...CONSENT_BODY, 'text-keys': [] }],
    ['with a bad locale', { ...CONSENT_BODY, locale: 'English (US)' }],
  ])('rejects a consent %s', async (_label, body) => {
    const { sessionToken } = await openFlowSession(api);

    expect((await postConsent(sessionToken, body)).statusCode).toBe(400);
  });

  it('answers 409 once the inquiry is finished', async () => {
    const { inquiryId, sessionToken } = await openFlowSession(api);
    await getSession(sessionToken);
    await transitionInquiryStatus(api.database.db, api.environmentId, inquiryId, {
      from: 'pending',
      to: 'completed',
    });

    expect((await postConsent(sessionToken)).statusCode).toBe(409);
  });
});
