/**
 * Workflow 10B Stage 3 (`integration-10b`; api-integrity's missing hook 2, C211.9, review V05): publish
 * and validate tell `flowPublishReport` whether the environment kind binds a `deviceIntegrity`
 * provider, so `play_integrity_notice_missing` applies: while a provider is bound, a consent that shows
 * `notice.session-integrity` must also show `notice.play-integrity` (decision 66's key); unbound, the
 * rule asks nothing.
 */
import { defaultInquiryTemplateAttributes } from '@openverify/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDeviceIntegrityProvider } from '../device-integrity/index.js';
import { createInquiryTestApi, type InquiryTestApi } from '../inquiries.test-support.js';
import { bearer, createTemplate, expectStatus } from '../../test-support/harness.js';

let bound: InquiryTestApi;
let unbound: InquiryTestApi;

beforeAll(async () => {
  unbound = await createInquiryTestApi();
  bound = await createInquiryTestApi({
    providers: {
      sandbox: {
        ...unbound.deps.providers.sandbox,
        deviceIntegrity: createDeviceIntegrityProvider('sandbox'),
      },
      production: unbound.deps.providers.production,
    },
  });
});

afterAll(async () => {
  await bound.close();
  await unbound.close();
});

/** A v2 flow: a consent with `textKeys`, an ID, the completion. */
const flowWith = (textKeys: string[]) => ({
  metadata: { specVersion: 2, id: 'integrity', version: 1, name: 'Integrity' },
  entry: 'consent',
  steps: [
    { id: 'consent', type: 'consent', textKeys, required: true },
    {
      id: 'id_card',
      type: 'government_id',
      sides: 'front',
      maxAttempts: 2,
      captureMethods: ['camera'],
    },
    { id: 'done', type: 'completion' },
  ],
  edges: [
    { id: 'e0', from: 'consent', port: 'next', to: 'id_card' },
    { id: 'e1', from: 'id_card', port: 'next', to: 'done' },
  ],
});

const COLLECTING = ['consent.biometric', 'consent.processing', 'notice.session-integrity'];

async function draft(api: InquiryTestApi, textKeys: string[]) {
  const templateId = await createTemplate(api, api.token);
  const created = await api.app.inject({
    method: 'POST',
    url: '/api/v1/inquiry-template-versions',
    headers: bearer(api.token),
    payload: {
      data: {
        attributes: {
          'inquiry-template-id': templateId,
          flow: flowWith(textKeys),
          'verification-config': {
            'government-id':
              defaultInquiryTemplateAttributes()['verification-config']['government-id'],
          },
        },
      },
    },
  });
  return expectStatus(created, 201).data.id;
}

async function validateCodes(api: InquiryTestApi, textKeys: string[]) {
  const id = await draft(api, textKeys);
  const response = await api.app.inject({
    method: 'POST',
    url: `/api/v1/inquiry-template-versions/${id}/validate`,
    headers: bearer(api.token),
    payload: { meta: { mode: 'publish' } },
  });
  const body = expectStatus(response, 200) as unknown as {
    data: { attributes: { validation: unknown } };
  };
  return JSON.stringify(body.data.attributes.validation);
}

async function publishCode(api: InquiryTestApi, textKeys: string[]) {
  const id = await draft(api, textKeys);
  const response = await api.app.inject({
    method: 'POST',
    url: `/api/v1/inquiry-template-versions/${id}/publish`,
    headers: bearer(api.token),
    payload: {},
  });
  return response.statusCode === 200
    ? 'published'
    : response.json<{ code: string; errors?: { code?: string }[] }>();
}

describe('play_integrity_notice_missing at publish and validate (C211.9)', () => {
  it('refuses the collection without the notice where a deviceIntegrity provider is bound', async () => {
    expect(await validateCodes(bound, COLLECTING)).toContain('play_integrity_notice_missing');
    expect(JSON.stringify(await publishCode(bound, COLLECTING))).toContain(
      'play_integrity_notice_missing',
    );
  });

  it('passes the notice shown beside it, and asks nothing where nothing is bound', async () => {
    const shown = [...COLLECTING, 'notice.play-integrity'];
    expect(await validateCodes(bound, shown)).not.toContain('play_integrity_notice_missing');
    expect(await validateCodes(unbound, COLLECTING)).not.toContain('play_integrity_notice_missing');
  });
});
