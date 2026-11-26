/**
 * C130 through the routes (Workflow 8B Stage 3, `api-cases`): templates and their versions.
 *
 * - A template comes with a first draft holding the defaults (C130.2); its key is unique per
 *   environment (409 `case_template_key_taken`) and never changes; archiving refuses new cases.
 * - A version is a draft until published; publishing checks the field schemas (F37) and the status
 *   map (C131.1) by pointer, supersedes the published version under the template's lock, refuses a
 *   field whose type changed and fires `case-template.deleted-field` for a dropped field (C130.3).
 * - A published version never changes (409 `case_template_version_not_draft`).
 *
 * Every value is synthetic.
 */
import { eventAttributesSchema } from '@openverify/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestApi, type TestApi } from '../../test-support/harness.js';

let api: TestApi;
let token: string;

beforeAll(async () => {
  api = await createTestApi();
  token = api.newUserToken(api.environmentId);
}, 120_000);

afterAll(async () => {
  await api.close();
});

let keys = 0;
const nextKey = () => {
  keys += 1;
  return `TP${String(keys)}`;
};

const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown, as = token) =>
  api.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: {
      ...bearer(as),
      'idempotency-key': `templates-${method}-${url}-${String(Math.random())}`,
    },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });

const json = (response: { body: string }) =>
  JSON.parse(response.body) as {
    data: {
      id: string;
      attributes: Record<string, unknown>;
      relationships: Record<string, { data: { id: string } | null }>;
    };
    errors?: { pointer?: string; source?: { pointer: string }; detail: string }[];
    code?: string;
  };

async function createTemplate(attributes: Record<string, unknown> = {}) {
  const response = await call('POST', '/case-templates', {
    data: {
      type: 'case-template',
      attributes: { name: 'Synthetic review', key: nextKey(), ...attributes },
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return json(response).data;
}

const draftOf = (template: Awaited<ReturnType<typeof createTemplate>>) =>
  template.relationships['draft-version']?.data?.id ?? '';

describe('templates (C130.1)', () => {
  it('come with a first draft holding the defaults, and no published version', async () => {
    const template = await createTemplate();

    expect(template.attributes).toMatchObject({
      status: 'active',
      'published-version': null,
      'draft-version': 1,
      'visible-to-roles': [],
    });
    const draft = json(await call('GET', `/case-template-versions/${draftOf(template)}`)).data;
    expect(draft.attributes).toMatchObject({
      'version-number': 1,
      status: 'draft',
      resolutions: ['Approved', 'Declined'],
      'sla-starts-on': 'created',
    });
    expect((draft.attributes.statuses as { key: string }[]).map(({ key }) => key)).toEqual([
      'open',
      'pending',
      'approved',
      'declined',
    ]);
  });

  it('keep their key unique per environment', async () => {
    const template = await createTemplate();

    const repeated = await call('POST', '/case-templates', {
      data: { attributes: { name: 'Again', key: template.attributes.key } },
    });

    expect(repeated.statusCode).toBe(409);
    expect(json(repeated).code).toBe('case_template_key_taken');
  });

  it('are read, listed newest first, renamed and archived', async () => {
    const first = await createTemplate();
    const second = await createTemplate();

    const listed = json(await call('GET', '/case-templates?page[size]=100')) as unknown as {
      data: { id: string }[];
    };
    const ids = listed.data.map(({ id }) => id);
    expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id));
    const renamed = await call('PATCH', `/case-templates/${first.id}`, {
      data: { attributes: { name: 'Synthetic renamed' } },
    });
    expect(json(renamed).data.attributes.name).toBe('Synthetic renamed');
    const archived = await call('POST', `/case-templates/${first.id}/archive`, { meta: {} });
    expect(archived.statusCode, archived.body).toBe(200);
    expect(json(archived).data.attributes).toMatchObject({ status: 'archived' });
    expect(json(await call('GET', `/case-templates/${first.id}`)).data.attributes.status).toBe(
      'archived',
    );
    expect((await call('GET', '/case-templates/ctmpl_01M5CK3190XEVBM5ZXA76E1JSN')).statusCode).toBe(
      404,
    );
  });
});

describe('versions (C130.2, C130.3)', () => {
  it('publish a draft, after which it never changes, and a new draft numbers on', async () => {
    const template = await createTemplate();
    const draftId = draftOf(template);

    const published = await call('POST', `/case-template-versions/${draftId}/publish`, {
      meta: {},
    });
    expect(published.statusCode, published.body).toBe(200);
    expect(json(published).data.attributes.status).toBe('published');
    const edit = await call('PATCH', `/case-template-versions/${draftId}`, {
      data: { attributes: { resolutions: ['Approved'] } },
    });
    expect(edit.statusCode).toBe(409);
    expect(json(edit).code).toBe('case_template_version_not_draft');
    const read = json(await call('GET', `/case-templates/${template.id}`)).data;
    expect(read.attributes).toMatchObject({ 'published-version': 1, 'draft-version': null });

    const next = await call('POST', '/case-template-versions', {
      data: { attributes: { 'case-template-id': template.id, resolutions: ['Approved'] } },
    });
    expect(next.statusCode, next.body).toBe(201);
    expect(json(next).data.attributes).toMatchObject({
      'version-number': 2,
      resolutions: ['Approved'],
    });
    const again = await call('POST', '/case-template-versions', {
      data: { attributes: { 'case-template-id': template.id } },
    });
    expect(again.statusCode).toBe(409);
  });

  it('refuse to publish a map with an end status unreachable from initial, by pointer', async () => {
    const template = await createTemplate({
      transitions: { open: ['pending'], pending: ['open'], approved: [], declined: [] },
    });

    const refused = await call('POST', `/case-template-versions/${draftOf(template)}/publish`, {
      meta: {},
    });

    expect(refused.statusCode).toBe(422);
    const body = json(refused);
    expect(JSON.stringify(body.errors)).toContain('/data/attributes/statuses');
  });

  it('refuse to publish a field schema a case cannot have, at its own pointer (K8-38)', async () => {
    const template = await createTemplate({
      'field-schemas': [
        { key: 'note', label: 'Note', type: 'string' },
        { key: 'note', label: 'Note again', type: 'string' },
      ],
    });

    const refused = await call('POST', `/case-template-versions/${draftOf(template)}/publish`, {
      meta: {},
    });

    expect(refused.statusCode, refused.body).toBe(422);
    const pointers = (json(refused).errors ?? []).map(
      (error) => error.pointer ?? error.source?.pointer,
    );
    expect(pointers).toEqual(['/data/attributes/field-schemas/1/key']);
  });

  it('refuse a field whose type changed, and fire case-template.deleted-field for a dropped one', async () => {
    const template = await createTemplate({
      'field-schemas': [
        { key: 'note', label: 'Note', type: 'string' },
        { key: 'score', label: 'Score', type: 'integer' },
      ],
    });
    await call('POST', `/case-template-versions/${draftOf(template)}/publish`, { meta: {} });
    const changed = json(
      await call('POST', '/case-template-versions', {
        data: {
          attributes: {
            'case-template-id': template.id,
            'field-schemas': [{ key: 'note', label: 'Note', type: 'integer' }],
          },
        },
      }),
    ).data;

    const refused = await call('POST', `/case-template-versions/${changed.id}/publish`, {
      meta: {},
    });
    expect(refused.statusCode).toBe(422);

    const dropped = await call('PATCH', `/case-template-versions/${changed.id}`, {
      data: { attributes: { 'field-schemas': [{ key: 'note', label: 'Note', type: 'string' }] } },
    });
    expect(dropped.statusCode, dropped.body).toBe(200);
    const before = api.events.named('case-template.deleted-field').length;
    const published = await call('POST', `/case-template-versions/${changed.id}/publish`, {
      meta: {},
    });
    expect(published.statusCode, published.body).toBe(200);
    const fired = api.events.named('case-template.deleted-field').slice(before);
    expect(fired).toHaveLength(1);
    expect(fired[0]?.payload.meta).toEqual({ 'field-key': 'score', 'version-number': 2 });
    expect(
      eventAttributesSchema.safeParse({
        name: 'case-template.deleted-field',
        payload: fired[0]?.payload,
        'created-at': new Date().toISOString(),
      }).success,
    ).toBe(true);
  });

  it('list a template’s versions newest first', async () => {
    const template = await createTemplate();
    await call('POST', `/case-template-versions/${draftOf(template)}/publish`, { meta: {} });
    const second = json(
      await call('POST', '/case-template-versions', {
        data: { attributes: { 'case-template-id': template.id } },
      }),
    ).data;

    const listed = JSON.parse(
      (await call('GET', `/case-template-versions?filter[case-template-id]=${template.id}`)).body,
    ) as { data: { id: string }[] };

    expect(listed.data.map(({ id }) => id)).toEqual([second.id, draftOf(template)]);
  });

  it('refuse a key without the publish scope', async () => {
    const template = await createTemplate();
    const key = await api.newApiKey(api.environmentId, { scopes: ['case-templates:write'] });

    const refused = await call(
      'POST',
      `/case-template-versions/${draftOf(template)}/publish`,
      { meta: {} },
      key,
    );

    expect(refused.statusCode).toBe(403);
  });
});
