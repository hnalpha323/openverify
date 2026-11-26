/**
 * Workflow 9A (T): the template routes accept a flow of either version in their schemas (C147.1).
 * A draft takes a flow-spec 2 flow on create and `PATCH` (`api-templates`, C154.2). A template's
 * version 1, published at once, takes one too since Workflow 9B (`api-templates-carry`): its body is
 * validated as a draft's is, with the save rules, and then held to every publish rule, so a flow
 * that needs an acknowledgement (which a template's creation cannot carry) is refused.
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

const v2Flow = JSON.parse(
  readFileSync(
    new URL('../../../../../contracts/fixtures/flows/v2/projection-linear.json', import.meta.url),
    'utf8',
  ),
) as unknown;

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../../../../contracts/fixtures/flows/v2/${name}.json`, import.meta.url),
      'utf8',
    ),
  ) as { edges: unknown[] };

const createWith = (flow: unknown, attributes: Record<string, unknown> = {}) =>
  api.app.inject({
    method: 'POST',
    url: '/api/v1/inquiry-templates',
    headers: bearer(api.token),
    payload: {
      data: { attributes: { ...defaultInquiryTemplateAttributes(), flow, ...attributes } },
    },
  });

describe('a flow-spec 2 flow at template creation (Workflow 9B, api-templates-carry)', () => {
  it('creates the template with its version 1 published, validated, and served as stored', async () => {
    const response = await createWith(v2Flow);
    expect(response.statusCode, response.body).toBe(201);
    const template = response.json<{
      data: { attributes: { 'current-version': { id: string; flow: unknown } } };
    }>().data;
    expect(template.attributes['current-version'].flow).toEqual(v2Flow);
    const version = await api.app.inject({
      method: 'GET',
      url: `/api/v1/inquiry-template-versions/${template.attributes['current-version'].id}`,
      headers: bearer(api.token),
    });
    expect(
      version.json<{ data: { attributes: Record<string, unknown> } }>().data.attributes,
    ).toMatchObject({
      status: 'published',
      'version-number': 1,
      validation: { status: 'valid' },
      'flow-sha256': expect.stringMatching(/^[0-9a-f]{64}$/) as unknown,
    });
  });

  it('refuses a flow that breaks a v2 rule, with every problem at its pointer, and stores nothing', async () => {
    const linear = fixture('projection-linear');
    const before = await api.database.client.query<{ count: string }>(
      'select count(*)::text as count from inquiry_templates where environment_id = $1',
      [api.environmentId],
    );
    const response = await createWith({ ...linear, edges: linear.edges.slice(0, 2) });
    expect(response.statusCode).toBe(422);
    const body = response.json<{ code: string; errors: { pointer: string }[] }>();
    expect(body.code).toBe('definition_invalid');
    expect(body.errors.map(({ pointer }) => pointer)).toContain('/data/attributes/flow/steps/2');
    const after = await api.database.client.query<{ count: string }>(
      'select count(*)::text as count from inquiry_templates where environment_id = $1',
      [api.environmentId],
    );
    expect(after.rows).toEqual(before.rows);
  });

  it('refuses a flow that needs an acknowledgement, which a creation cannot carry', async () => {
    // The golden branch on an R/H extraction (`heuristic:age_route`), without its screen: a
    // creation takes no `field-schemas`, so a screen's field would be refused first.
    const branch = fixture('projection-branch') as unknown as {
      steps: { id: string }[];
      edges: { from: string; port: string; to: string }[];
    };
    const flow = {
      ...branch,
      steps: branch.steps.filter((step) => step.id !== 'extra_details'),
      edges: branch.edges
        .filter((edge) => edge.from !== 'extra_details')
        .map((edge) => (edge.to === 'extra_details' ? { ...edge, to: 'done' } : edge)),
    };
    const response = await createWith(flow, {
      'verification-config': {
        'government-id': defaultInquiryTemplateAttributes()['verification-config']['government-id'],
      },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code: 'publish_acknowledgement_missing' });
  });

  it('is taken by a new draft and on a draft, and served as stored', async () => {
    const templateId = await createTemplate(api, api.token);
    const { 'verification-config': config } = defaultInquiryTemplateAttributes();
    const created = await api.app.inject({
      method: 'POST',
      url: '/api/v1/inquiry-template-versions',
      headers: bearer(api.token),
      payload: {
        data: {
          attributes: {
            'inquiry-template-id': templateId,
            flow: v2Flow,
            'verification-config': config,
          },
        },
      },
    });
    expect(created.statusCode).toBe(201);
    const draft = await api.app.inject({
      method: 'POST',
      url: '/api/v1/inquiry-template-versions',
      headers: bearer(api.token),
      payload: {
        data: {
          attributes: {
            'inquiry-template-id': templateId,
            flow: defaultInquiryTemplateAttributes().flow,
            'verification-config': config,
          },
        },
      },
    });
    expect(draft.statusCode).toBe(201);
    const id = draft.json<{ data: { id: string } }>().data.id;
    const patched = await api.app.inject({
      method: 'PATCH',
      url: `/api/v1/inquiry-template-versions/${id}`,
      headers: bearer(api.token),
      payload: { data: { attributes: { flow: v2Flow } } },
    });
    expect(patched.statusCode).toBe(200);
    const read = await api.app.inject({
      method: 'GET',
      url: `/api/v1/inquiry-template-versions/${id}`,
      headers: bearer(api.token),
    });
    expect(
      read.json<{ data: { attributes: { flow: { metadata: { specVersion: number } } } } }>().data
        .attributes.flow.metadata.specVersion,
    ).toBe(2);
  });
});
