/**
 * C154.9, C158.2, C158.4, C128.4 (Workflow 9B, api-templates-carry): the publish rules this file
 * adds to a version's publish.
 *
 * - The version's `embed-origins` are a subset of the environment's `allowed-embed-origins`, each in
 *   the origin grammar for the environment's kind (422 `embed_origin_invalid` at its position).
 * - Its `redirect-uri` passes the environment's redirect rules with its own `redirect-uri-schemes`
 *   (422 `redirect_uri_not_allowed`). Both stay stored and served as sent, and are checked again on
 *   every use (`services/embed-origins.ts`).
 * - The publish analyses learn whether the template is biometric: Phase 8's `biometricTemplates` of
 *   the published version, OR'd with whether the draft's own flow holds a selfie, so a production
 *   adverse path on a check status asks `biometricBasis` exactly when the template is biometric.
 *
 * Every origin is a reserved name and every value is synthetic.
 */
import { defaultInquiryTemplateAttributes } from '@openverify/contracts';
import { environments } from '@openverify/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInquiryTestApi, type InquiryTestApi } from '../inquiries.test-support.js';
import {
  bearer,
  createTemplate,
  expectStatus,
  type TestTenant,
} from '../../test-support/harness.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const SHOP = 'https://shop.example.com';
const PAY = 'https://pay.example.com';
const defaults = defaultInquiryTemplateAttributes();

const setSettings = async (environmentId: string, settings: Record<string, unknown>) => {
  await api.database.db
    .update(environments)
    .set({ settings })
    .where(eq(environments.id, environmentId));
};

/** A draft of the default flow with `members`, in `tenant`'s environment. */
async function draft(tenant: TestTenant, members: Record<string, unknown>, attributes = {}) {
  const templateId = await createTemplate(api, tenant.token);
  const created = await api.app.inject({
    method: 'POST',
    url: '/api/v1/inquiry-template-versions',
    headers: bearer(tenant.token),
    payload: {
      data: {
        attributes: {
          'inquiry-template-id': templateId,
          flow: defaults.flow,
          'verification-config': defaults['verification-config'],
          ...attributes,
          ...members,
        },
      },
    },
  });
  return expectStatus(created, 201).data.id;
}

const publish = (tenant: TestTenant, id: string) =>
  api.app.inject({
    method: 'POST',
    url: `/api/v1/inquiry-template-versions/${id}/publish`,
    headers: bearer(tenant.token),
    payload: {},
  });

describe("a version's embed origins at publish (C158.2)", () => {
  it('publishes origins the environment allows, and an empty list (the environment’s own)', async () => {
    await setSettings(api.environmentId, { 'allowed-embed-origins': [SHOP, PAY] });
    expect((await publish(api, await draft(api, { 'embed-origins': [SHOP] }))).statusCode).toBe(
      200,
    );
    expect((await publish(api, await draft(api, { 'embed-origins': [] }))).statusCode).toBe(200);
  });

  it('refuses an origin outside the environment’s list, at its position, echoing nothing', async () => {
    await setSettings(api.environmentId, { 'allowed-embed-origins': [SHOP] });
    const response = await publish(api, await draft(api, { 'embed-origins': [SHOP, PAY] }));
    expect(response.statusCode).toBe(422);
    const problem = response.json<{
      code: string;
      errors: { pointer: string; detail: string }[];
    }>();
    expect(problem.code).toBe('embed_origin_invalid');
    expect(problem.errors).toEqual([
      expect.objectContaining({ pointer: '/data/attributes/embed-origins/1' }),
    ]);
    expect(response.body).not.toContain('pay.example.com');
  });

  it('refuses an origin outside the grammar for the environment’s kind', async () => {
    await setSettings(api.environmentId, { 'allowed-embed-origins': [SHOP] });
    const response = await publish(
      api,
      await draft(api, { 'embed-origins': ['https://*.vercel.app'] }),
    );
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 'embed_origin_invalid',
      errors: [{ pointer: '/data/attributes/embed-origins/0' }],
    });
  });

  it('lists the refusal in validate’s publish mode, beside the other problems', async () => {
    await setSettings(api.environmentId, { 'allowed-embed-origins': [] });
    const id = await draft(api, { 'embed-origins': [SHOP] });
    const response = await api.app.inject({
      method: 'POST',
      url: `/api/v1/inquiry-template-versions/${id}/validate`,
      headers: bearer(api.token),
      payload: { meta: { mode: 'publish' } },
    });
    const validation = expectStatus(response, 200).data.attributes as {
      validation: { status: string; problems: { pointer: string; code: string }[] };
    };
    expect(validation.validation.status).toBe('invalid');
    expect(validation.validation.problems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pointer: '/embed-origins/0', code: 'embed_origin_invalid' }),
      ]),
    );
  });
});

describe("a version's redirect URI at publish (C158.4)", () => {
  it('publishes a URI on an allowed redirect origin, the embed origins standing in for none', async () => {
    await setSettings(api.environmentId, { 'allowed-embed-origins': [SHOP] });
    const id = await draft(api, { 'redirect-uri': `${SHOP}/done?step=1` });
    expect((await publish(api, id)).statusCode).toBe(200);
  });

  it('refuses a URI outside the allowed redirect origins, at its pointer', async () => {
    await setSettings(api.environmentId, {
      'allowed-embed-origins': [SHOP],
      'allowed-redirect-origins': [PAY],
    });
    const response = await publish(api, await draft(api, { 'redirect-uri': `${SHOP}/done` }));
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 'redirect_uri_not_allowed',
      errors: [{ pointer: '/data/attributes/redirect-uri' }],
    });
    expect(response.body).not.toContain('shop.example.com');
  });

  it('takes a custom scheme only when the version lists it', async () => {
    await setSettings(api.environmentId, { 'allowed-embed-origins': [SHOP] });
    const listed = await draft(api, {
      'redirect-uri': 'exampleapp://verified',
      'redirect-uri-schemes': ['exampleapp'],
    });
    expect((await publish(api, listed)).statusCode).toBe(200);
    const unlisted = await draft(api, { 'redirect-uri': 'exampleapp://verified' });
    const response = await publish(api, unlisted);
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code: 'redirect_uri_not_allowed' });
  });
});

describe('whether the template is biometric, for the publish analyses (C128.4)', () => {
  const NO_SELFIE_FLOW = {
    metadata: { specVersion: 1, id: 'id-only', version: 1, name: 'ID only' },
    steps: [
      {
        id: 'consent',
        type: 'consent',
        textKeys: ['consent.processing', 'notice.session-integrity'],
        required: true,
      },
      {
        id: 'government_id',
        type: 'government_id',
        sides: 'both',
        maxAttempts: 3,
        captureMethods: ['upload', 'camera'],
      },
      { id: 'completion', type: 'completion', messageKey: 'flow.completion' },
      { id: 'failure', type: 'failure', messageKey: 'flow.failure' },
    ],
    transitions: [],
  };
  const ID_ONLY = {
    name: 'ID only',
    flow: NO_SELFIE_FLOW,
    'verification-config': { 'government-id': defaults['verification-config']['government-id'] },
  };

  /** An adverse path on a check status, with a basis and a contest route but no biometric basis. */
  const adverseFlow = (withSelfie: boolean) => ({
    metadata: { specVersion: 2, id: 'adverse', version: 1, name: 'Adverse' },
    entry: 'consent',
    steps: [
      { id: 'consent', type: 'consent', textKeys: ['consent.biometric'], required: true },
      {
        id: 'id_card',
        type: 'government_id',
        sides: 'front',
        maxAttempts: 1,
        captureMethods: ['camera'],
      },
      ...(withSelfie
        ? [{ id: 'face', type: 'selfie', poses: ['center'], liveness: 'passive', maxAttempts: 1 }]
        : []),
      {
        id: 'expiry',
        type: 'branch',
        routes: [
          {
            key: 'expired',
            label: 'Expired',
            condition: {
              '===': [
                { var: 'verifications.id_card.checks.id_expired_detection.status' },
                'failed',
              ],
            },
            onNull: 'else',
          },
        ],
      },
      { id: 'done', type: 'completion' },
      {
        id: 'refused',
        type: 'failure',
        decisionBasis: 'contract',
        contestRoute: { url: 'https://support.example.com/contest' },
      },
    ],
    edges: [
      { id: 'e1', from: 'consent', port: 'next', to: 'id_card' },
      ...(withSelfie
        ? [
            { id: 'e2', from: 'id_card', port: 'next', to: 'face' },
            { id: 'e3', from: 'face', port: 'next', to: 'expiry' },
          ]
        : [{ id: 'e2', from: 'id_card', port: 'next', to: 'expiry' }]),
      { id: 'e4', from: 'expiry', port: 'route:expired', to: 'refused' },
      { id: 'e5', from: 'expiry', port: 'else', to: 'done' },
    ],
  });

  async function problemCodes(production: TestTenant, published: unknown, withSelfie: boolean) {
    const templateId = await createTemplate(
      api,
      production.token,
      published as Parameters<typeof createTemplate>[2],
    );
    const created = await api.app.inject({
      method: 'POST',
      url: '/api/v1/inquiry-template-versions',
      headers: bearer(production.token),
      payload: {
        data: {
          attributes: {
            'inquiry-template-id': templateId,
            flow: adverseFlow(withSelfie),
            'verification-config': withSelfie
              ? defaults['verification-config']
              : ID_ONLY['verification-config'],
          },
        },
      },
    });
    const id = expectStatus(created, 201).data.id;
    const validated = await api.app.inject({
      method: 'POST',
      url: `/api/v1/inquiry-template-versions/${id}/validate`,
      headers: bearer(production.token),
      payload: { meta: { mode: 'publish' } },
    });
    const attributes = expectStatus(validated, 200).data.attributes as {
      validation: { problems: { code: string }[] };
    };
    return attributes.validation.problems.map(({ code }) => code);
  }

  it('asks no biometric basis of a template known not to be biometric', async () => {
    const production = await api.newTenant({ kind: 'production' });
    // Before 9B the analyses got `null` here, which fails closed and asked it of every template.
    expect(await problemCodes(production, ID_ONLY, false)).not.toContain('biometric_basis_missing');
  });

  it('asks it when the published version holds a selfie, though the draft does not', async () => {
    const production = await api.newTenant({ kind: 'production' });
    expect(await problemCodes(production, defaults, false)).toContain('biometric_basis_missing');
  });

  it('asks it when the draft’s own flow holds a selfie', async () => {
    const production = await api.newTenant({ kind: 'production' });
    expect(await problemCodes(production, ID_ONLY, true)).toContain('biometric_basis_missing');
  });
});
