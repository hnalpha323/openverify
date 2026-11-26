/**
 * C154.7-C154.9 (Workflow 9A, `api-templates`): publishing a flow-spec 2 draft runs every v2 rule in
 * publish mode with the publish analyses, asks every acknowledgement the version needs
 * (`publish_acknowledgement_missing` names each), stores them with the publishing user and time, and
 * writes one deployment per publish with `inquiry-template-version.published` and
 * `deployment.completed`; a new draft fires `inquiry-template-version.created`. An API key gives no
 * acknowledgement (only a user does). Every value is synthetic.
 */
import { readFileSync } from 'node:fs';
import { defaultInquiryTemplateAttributes } from '@openverify/contracts';
import { listDeployments } from '@openverify/db';
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

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../../../../contracts/fixtures/flows/v2/${name}.json`, import.meta.url),
      'utf8',
    ),
  ) as { edges: unknown[] };

const { 'verification-config': defaults } = defaultInquiryTemplateAttributes();

async function draftOf(
  flow: unknown,
  config: Record<string, unknown>,
  allowInvalid = false,
  members: Record<string, unknown> = {},
) {
  const templateId = await createTemplate(api, api.token);
  const created = await api.app.inject({
    method: 'POST',
    url: '/api/v1/inquiry-template-versions',
    headers: bearer(api.token),
    payload: {
      data: {
        attributes: {
          'inquiry-template-id': templateId,
          flow: fixture('projection-linear'),
          'verification-config': defaults,
        },
      },
    },
  });
  const { id } = created.json<{ data: { id: string } }>().data;
  const patched = await api.app.inject({
    method: 'PATCH',
    url: `/api/v1/inquiry-template-versions/${id}`,
    headers: bearer(api.token),
    payload: {
      data: { attributes: { flow, 'verification-config': config, ...members } },
      ...(allowInvalid ? { meta: { 'allow-invalid': true } } : {}),
    },
  });
  expect(patched.statusCode, patched.body).toBe(200);
  return { templateId, id };
}

const publish = (id: string, token: string, meta?: Record<string, unknown>) =>
  api.app.inject({
    method: 'POST',
    url: `/api/v1/inquiry-template-versions/${id}/publish`,
    headers: bearer(token),
    payload: meta === undefined ? {} : { meta },
  });

const branchConfig = { 'government-id': defaults['government-id'] };

describe('publishing a flow-spec 2 draft (C154.9)', () => {
  it('publishes a valid draft, writes one deployment and fires its events', async () => {
    const { templateId, id } = await draftOf(fixture('projection-linear'), defaults);
    expect(api.events.named('inquiry-template-version.created').length).toBeGreaterThan(0);
    const response = await publish(id, api.token, { 'publish-note': 'First v2' });
    expect(response.statusCode).toBe(200);
    expect(
      response.json<{ data: { attributes: Record<string, unknown> } }>().data.attributes,
    ).toMatchObject({
      status: 'published',
      'publish-note': 'First v2',
      acknowledgements: [],
    });
    const deployments = await listDeployments(api.database.db, api.environmentId, {
      inquiryTemplateId: [templateId],
    });
    expect(deployments.items).toHaveLength(1);
    expect(deployments.items[0]).toMatchObject({
      inquiryTemplateVersionId: id,
      creatorType: 'api-key',
    });
    const published = api.events.named('inquiry-template-version.published');
    expect(published.at(-1)?.payload).toMatchObject({
      data: { id, attributes: { 'spec-version': 2, 'publish-note': 'First v2' } },
    });
    expect(api.events.named('deployment.completed').at(-1)?.payload).toMatchObject({
      data: { id: deployments.items[0]?.id },
    });
  });

  it('refuses a draft that breaks a v2 rule, with every problem at its pointer', async () => {
    const linear = fixture('projection-linear');
    const { id } = await draftOf({ ...linear, edges: linear.edges.slice(0, 2) }, defaults, true);
    const response = await publish(id, api.token);
    expect(response.statusCode).toBe(422);
    const body = response.json<{ code: string; errors: { pointer: string }[] }>();
    expect(body.code).toBe('definition_invalid');
    expect(body.errors.map(({ pointer }) => pointer)).toContain('/data/attributes/flow/steps/2');
  });

  it('names every acknowledgement a publish lacks, and stores them with the user who gave them', async () => {
    const { id } = await draftOf(fixture('projection-branch'), branchConfig, false, {
      'field-schemas': [{ key: 'nickname', type: 'string', label: 'Nickname', pii: true }],
    });
    const missing = await publish(id, api.token);
    expect(missing.statusCode).toBe(422);
    const body = missing.json<{ code: string; errors: { detail: string; pointer: string }[] }>();
    expect(body.code).toBe('publish_acknowledgement_missing');
    expect(body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pointer: '/meta/acknowledgements',
          detail: 'heuristic:age_route',
        }),
      ]),
    );
    const keys = body.errors.map(({ detail }) => detail);
    const byKey = await publish(id, api.token, { acknowledgements: keys });
    expect(byKey.statusCode).toBe(422);
    expect(byKey.json<{ code: string }>().code).toBe('publish_acknowledgement_missing');
    const userId = 'usr_01M5CJXHG03PHEQZPRWAH2RXM5';
    const user = api.newUserToken(api.environmentId, { userId });
    const response = await publish(id, user, { acknowledgements: keys });
    expect(response.statusCode).toBe(200);
    const stored = response.json<{
      data: { attributes: { acknowledgements: { key: string; 'acknowledged-by': string }[] } };
    }>().data.attributes.acknowledgements;
    expect(stored.map(({ key }) => key)).toEqual(expect.arrayContaining(keys));
    expect(stored.every((entry) => entry['acknowledged-by'] === userId)).toBe(true);
  });
});
