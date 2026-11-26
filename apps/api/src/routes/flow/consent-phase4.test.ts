/**
 * C42.3 and C42.6 on the API (Workflow 4A Stage 3, api-flow):
 * - the consent records the optional texts the user ticked (`optional-text-keys`), and refuses
 *   any key, required or optional, that the inquiry's pinned consent step does not list;
 * - the flow session returns the environment's `face-template-retention-days` (`{{days}}`);
 * - the inquiry session shows the recorded consent keys, never the client address;
 * - a template version that requires `selfie_repeat_detection`, `selfie_account_comparison` or
 *   `selfie_similar_background_detection` is published only when `consent.biometric-matching` is a
 *   required consent text (422 with a JSON Pointer to the check otherwise).
 */
import {
  defaultInquiryTemplateAttributes,
  flowSessionResponseSchema,
  inquirySessionDocumentSchema,
  type DefaultInquiryTemplateAttributes,
} from '@openverify/contracts';
import { getLatestInquiryConsent, updateEnvironmentSettings } from '@openverify/db';
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
} from '../../test-support/harness.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const MATCHING = 'consent.biometric-matching';
const CONSENT_BODY = {
  accepted: true,
  'text-keys': ['consent.biometric', 'consent.processing', 'notice.session-integrity'],
  locale: 'en',
};

function postConsent(token: string, body: Record<string, unknown>) {
  return api.app.inject({
    method: 'POST',
    url: '/api/v1/flow/consent',
    headers: { ...bearer(token), 'user-agent': 'SyntheticBrowser/1.0' },
    payload: body,
    remoteAddress: '198.51.100.23',
  });
}

function templateWith(change: (attributes: DefaultInquiryTemplateAttributes) => void) {
  const attributes = defaultInquiryTemplateAttributes();
  change(attributes);
  return attributes;
}

function consentStepOf(attributes: DefaultInquiryTemplateAttributes) {
  const step = attributes.flow.steps.find((candidate) => candidate.type === 'consent');
  if (step?.type !== 'consent') {
    throw new Error('the default template has a consent step');
  }
  return step;
}

function selfieChecksOf(attributes: DefaultInquiryTemplateAttributes) {
  const selfie = attributes['verification-config'].selfie;
  if (selfie === undefined) {
    throw new Error('the default template has a selfie');
  }
  return selfie.checks;
}

describe('POST /api/v1/flow/consent with optional texts (C42.3)', () => {
  it('records the optional texts the user ticked', async () => {
    const { inquiryId, sessionToken } = await openFlowSession(api);

    expectStatus(
      await postConsent(sessionToken, { ...CONSENT_BODY, 'optional-text-keys': [MATCHING] }),
      201,
    );

    expect(await getLatestInquiryConsent(api.database.db, api.environmentId, inquiryId)).toEqual({
      acceptedAt: api.clock.now(),
      textKeys: ['consent.biometric', 'consent.processing', 'notice.session-integrity'],
      optionalTextKeys: [MATCHING],
      locale: 'en',
      ip: '198.51.100.23',
      userAgent: 'SyntheticBrowser/1.0',
    });
  });

  it('records no optional text when none was ticked', async () => {
    const { inquiryId, sessionToken } = await openFlowSession(api);

    expectStatus(await postConsent(sessionToken, CONSENT_BODY), 201);

    expect(
      (await getLatestInquiryConsent(api.database.db, api.environmentId, inquiryId))
        ?.optionalTextKeys,
    ).toEqual([]);
  });

  it.each([
    [
      'a required key the step does not list',
      { 'text-keys': [...CONSENT_BODY['text-keys'], 'consent.extra'] },
      'consent.extra',
    ],
    [
      'an optional key the step does not list',
      { 'optional-text-keys': ['consent.marketing'] },
      'consent.marketing',
    ],
    [
      'a required key sent as optional',
      { 'optional-text-keys': ['consent.processing'] },
      'consent.processing',
    ],
    [
      'an optional key sent as required',
      { 'text-keys': [...CONSENT_BODY['text-keys'], MATCHING] },
      MATCHING,
    ],
  ])('refuses %s with 422 and records nothing', async (_label, change, key) => {
    const { inquiryId, sessionToken } = await openFlowSession(api);

    const response = await postConsent(sessionToken, { ...CONSENT_BODY, ...change });

    expect(response.statusCode, response.body).toBe(422);
    expect(response.headers['content-type']).toBe(PROBLEM_JSON);
    expect(response.json<{ detail: string }>().detail).toContain(key);
    expect(await getLatestInquiryConsent(api.database.db, api.environmentId, inquiryId)).toBeNull();
  });

  it('refuses any optional key when the flow has no consent step', async () => {
    const templateId = await createTemplate(
      api,
      api.token,
      templateWith((attributes) => {
        attributes.flow.steps = attributes.flow.steps.filter((step) => step.type !== 'consent');
      }),
    );
    const { sessionToken } = await openFlowSession(api, { templateId });

    const response = await postConsent(sessionToken, {
      ...CONSENT_BODY,
      'optional-text-keys': [MATCHING],
    });

    expect(response.statusCode).toBe(422);
  });
});

describe('GET /api/v1/flow/session face-template-retention-days (C42.3, C42.6)', () => {
  it('returns the default, 365 days, for an environment that sets none', async () => {
    const tenant = await api.newTenant();
    const { sessionToken } = await openFlowSession(api, { token: tenant.token });

    const body = flowSessionResponseSchema.parse(
      expectStatus(
        await api.app.inject({ url: '/api/v1/flow/session', headers: bearer(sessionToken) }),
        200,
      ),
    );

    expect(body['face-template-retention-days']).toBe(365);
  });

  it("returns the environment's own setting", async () => {
    const tenant = await api.newTenant();
    await updateEnvironmentSettings(api.database.db, tenant.environmentId, {
      'face-template-retention-days': 30,
    });
    const { sessionToken } = await openFlowSession(api, { token: tenant.token });

    const body = flowSessionResponseSchema.parse(
      expectStatus(
        await api.app.inject({ url: '/api/v1/flow/session', headers: bearer(sessionToken) }),
        200,
      ),
    );

    expect(body['face-template-retention-days']).toBe(30);
  });
});

describe('the inquiry session shows the recorded consent (C42.3, C47)', () => {
  async function sessionIdOf(inquiryId: string): Promise<string> {
    const response = await api.app.inject({
      url: `/api/v1/inquiry-sessions?filter[inquiry-id]=${inquiryId}`,
      headers: bearer(api.token),
    });
    const id = expectStatus(response, 200) as unknown as { data: { id: string }[] };
    const first = id.data[0];
    if (first === undefined) {
      throw new Error('the inquiry has a session');
    }
    return first.id;
  }

  async function sessionDocument(id: string) {
    return inquirySessionDocumentSchema.parse(
      expectStatus(
        await api.app.inject({ url: `/api/v1/inquiry-sessions/${id}`, headers: bearer(api.token) }),
        200,
      ),
    );
  }

  it('is null before consent', async () => {
    const { inquiryId } = await openFlowSession(api);

    const document = await sessionDocument(await sessionIdOf(inquiryId));

    expect(document.data.attributes.consent).toBeNull();
  });

  it('lists the required and optional keys accepted, the time and the locale, never the address', async () => {
    const { inquiryId, sessionToken } = await openFlowSession(api);
    expectStatus(
      await postConsent(sessionToken, {
        ...CONSENT_BODY,
        locale: 'es',
        'optional-text-keys': [MATCHING],
      }),
      201,
    );

    const response = await api.app.inject({
      url: `/api/v1/inquiry-sessions/${await sessionIdOf(inquiryId)}`,
      headers: bearer(api.token),
    });

    const document = inquirySessionDocumentSchema.parse(expectStatus(response, 200));
    expect(document.data.attributes.consent).toEqual({
      'accepted-at': api.clock.now().toISOString(),
      'text-keys': ['consent.biometric', 'consent.processing', 'notice.session-integrity'],
      'optional-text-keys': [MATCHING],
      locale: 'es',
    });
    expect(JSON.stringify(document.data.attributes.consent)).not.toContain('198.51.100.23');
  });
});

describe('the matching consent rule at publish time (C42.3)', () => {
  const RULED = [
    'selfie_repeat_detection',
    'selfie_account_comparison',
    'selfie_similar_background_detection',
  ] as const;

  const postTemplate = (attributes: DefaultInquiryTemplateAttributes) =>
    api.app.inject({
      method: 'POST',
      url: '/api/v1/inquiry-templates',
      headers: bearer(api.token),
      payload: { data: { type: 'inquiry-template', attributes } },
    });

  it.each(RULED)(
    'refuses a new template that requires %s while the matching consent is optional',
    async (check) => {
      const attributes = templateWith((template) => {
        selfieChecksOf(template)[check] = { enabled: true, required: true };
      });

      const response = await postTemplate(attributes);

      expect(response.statusCode, response.body).toBe(422);
      expect(response.headers['content-type']).toBe(PROBLEM_JSON);
      expect(response.json<{ errors: { pointer: string }[] }>().errors).toEqual([
        expect.objectContaining({
          pointer: `/data/attributes/verification-config/selfie/checks/${check}/required`,
        }),
      ]);
    },
  );

  it('accepts it once the matching consent is a required text', async () => {
    const attributes = templateWith((template) => {
      const step = consentStepOf(template);
      step.textKeys = [...step.textKeys, MATCHING];
      delete step.optionalTextKeys;
      selfieChecksOf(template).selfie_repeat_detection = { enabled: true, required: true };
    });

    expect((await postTemplate(attributes)).statusCode).toBe(201);
  });

  it('accepts the default template, whose three checks are advisory', async () => {
    expect((await postTemplate(defaultInquiryTemplateAttributes())).statusCode).toBe(201);
  });

  it('refuses to publish a draft that requires one of them without the required consent', async () => {
    const templateId = await createTemplate(api);
    const draft = templateWith((template) => {
      selfieChecksOf(template).selfie_account_comparison = { enabled: true, required: true };
    });
    const created = expectStatus(
      await api.app.inject({
        method: 'POST',
        url: '/api/v1/inquiry-template-versions',
        headers: bearer(api.token),
        payload: {
          data: {
            type: 'inquiry-template-version',
            attributes: {
              'inquiry-template-id': templateId,
              flow: draft.flow,
              'verification-config': draft['verification-config'],
            },
          },
        },
      }),
      201,
    );

    const response = await api.app.inject({
      method: 'POST',
      url: `/api/v1/inquiry-template-versions/${created.data.id}/publish`,
      headers: bearer(api.token),
    });

    expect(response.statusCode, response.body).toBe(422);
    expect(response.json<{ errors: { pointer: string }[] }>().errors).toEqual([
      expect.objectContaining({
        pointer:
          '/data/attributes/verification-config/selfie/checks/selfie_account_comparison/required',
      }),
    ]);
  });
});
