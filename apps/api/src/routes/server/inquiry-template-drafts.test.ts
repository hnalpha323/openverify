/**
 * C154.1-C154.3 (Workflow 9A, `api-templates`): a draft carries the version members and its
 * validation; `PATCH` with `meta.allow-invalid` stores a draft that breaks a graph, field or copy rule
 * with `validation.status: invalid` and its problems, and without it answers 422 with every problem;
 * every version answers a strong ETag, and `PATCH` and `publish` honour `If-Match` with 412
 * `precondition_failed` and the current ETag. Every value is synthetic.
 */
import { readFileSync } from 'node:fs';
import { defaultInquiryTemplateAttributes } from '@openverify/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import { bearer, createTemplate } from '../../test-support/harness.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

interface Version {
  id: string;
  attributes: Record<string, unknown> & {
    validation?: { status: string; problems: { pointer: string; code: string }[] };
  };
}

const linear = JSON.parse(
  readFileSync(
    new URL('../../../../../contracts/fixtures/flows/v2/projection-linear.json', import.meta.url),
    'utf8',
  ),
) as { edges: unknown[] };
/** The linear flow without its last edge: `face`'s `next` is unwired and `done` unreachable. */
const broken = { ...linear, edges: linear.edges.slice(0, 2) };

async function newDraft(flow: unknown = linear) {
  const templateId = await createTemplate(api, api.token);
  const response = await api.app.inject({
    method: 'POST',
    url: '/api/v1/inquiry-template-versions',
    headers: bearer(api.token),
    payload: {
      data: {
        attributes: {
          'inquiry-template-id': templateId,
          flow,
          'verification-config': defaultInquiryTemplateAttributes()['verification-config'],
        },
      },
    },
  });
  expect(response.statusCode).toBe(201);
  return { response, version: response.json<{ data: Version }>().data };
}

const patch = (
  id: string,
  attributes: Record<string, unknown>,
  options: { allowInvalid?: boolean; ifMatch?: string } = {},
) =>
  api.app.inject({
    method: 'PATCH',
    url: `/api/v1/inquiry-template-versions/${id}`,
    headers: {
      ...bearer(api.token),
      ...(options.ifMatch === undefined ? {} : { 'if-match': options.ifMatch }),
    },
    payload: {
      data: { attributes },
      ...(options.allowInvalid === undefined
        ? {}
        : { meta: { 'allow-invalid': options.allowInvalid } }),
    },
  });

describe('a draft and its members (C154.1)', () => {
  it('carries its members, validation, flow digest and last updater, and a strong ETag', async () => {
    const { response, version } = await newDraft();
    // Warnings never block: the default selfie checks are all beta (C147.6's warning).
    expect(
      version.attributes.validation?.problems.filter((p) => p.code !== 'verification_all_beta'),
    ).toEqual([]);
    expect(version.attributes).toMatchObject({
      validation: { status: 'valid' },
      'enabled-locales': ['en'],
      'default-locale': 'en',
      'field-schemas': [],
      copy: { messages: {} },
      'last-updater': { type: 'api-key' },
    });
    expect(version.attributes['flow-sha256']).toMatch(/^[0-9a-f]{64}$/);
    expect(response.headers.etag).toMatch(/^"[0-9a-f]{64}"$/);
    const read = await api.app.inject({
      method: 'GET',
      url: `/api/v1/inquiry-template-versions/${version.id}`,
      headers: bearer(api.token),
    });
    expect(read.headers.etag).toBe(response.headers.etag);
  });

  it('takes the members a PATCH sends and checks the copy against its locales', async () => {
    const { version } = await newDraft();
    const response = await patch(version.id, {
      'enabled-locales': ['en', 'fr'],
      copy: { messages: { en: { 'completion.title': 'Thank you' } } },
      description: 'Synthetic draft',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: Version }>().data.attributes).toMatchObject({
      'enabled-locales': ['en', 'fr'],
      description: 'Synthetic draft',
      copy: { messages: { en: { 'completion.title': 'Thank you' } } },
    });
  });
});

describe('drafts saved with problems (C154.2)', () => {
  it('answers 422 with every problem at its pointer without meta.allow-invalid', async () => {
    const { version } = await newDraft();
    const response = await patch(version.id, { flow: broken });
    expect(response.statusCode).toBe(422);
    const body = response.json<{ code: string; errors: { pointer: string; code: string }[] }>();
    expect(body.code).toBe('definition_invalid');
    expect(body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pointer: '/data/attributes/flow/steps/2', code: 'port_unwired' }),
      ]),
    );
  });

  it('stores the draft with its problems under meta.allow-invalid and serves them', async () => {
    const { version } = await newDraft();
    const response = await patch(
      version.id,
      { flow: broken, copy: { messages: { en: { 'nope.key': 'x' } } } },
      { allowInvalid: true },
    );
    expect(response.statusCode).toBe(200);
    const { validation } = response.json<{ data: Version }>().data.attributes;
    expect(validation?.status).toBe('invalid');
    expect(validation?.problems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pointer: '/flow/steps/2', code: 'port_unwired' }),
        expect.objectContaining({
          pointer: '/copy/messages/en/nope.key',
          code: 'copy_key_unknown',
        }),
      ]),
    );
  });
});

describe('ETag and If-Match (C154.3)', () => {
  it('refuses a stale If-Match with 412 and the current ETag, and takes the current one', async () => {
    const { response: created, version } = await newDraft();
    const etag = String(created.headers.etag);
    const changed = await patch(version.id, { description: 'One' }, { ifMatch: etag });
    expect(changed.statusCode).toBe(200);
    const current = String(changed.headers.etag);
    expect(current).not.toBe(etag);
    const stale = await patch(version.id, { description: 'Two' }, { ifMatch: etag });
    expect(stale.statusCode).toBe(412);
    expect(stale.json<{ code: string }>().code).toBe('precondition_failed');
    expect(stale.headers.etag).toBe(current);
    const publish = await api.app.inject({
      method: 'POST',
      url: `/api/v1/inquiry-template-versions/${version.id}/publish`,
      headers: { ...bearer(api.token), 'if-match': etag },
    });
    expect(publish.statusCode).toBe(412);
    expect(publish.headers.etag).toBe(current);
  });
});
