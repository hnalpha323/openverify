/**
 * C172.1-C172.4 (Workflow 9B, `api-cases-reports`; contracts B35, foundation-9b C2): a case template
 * version's `layout`, `checklists`, `preset-comments` and a status's `requires-fields`.
 *
 * - Stored when a template, a draft or a change sets them, and served on every version; a version
 *   that never set them reads `layout: null`, `checklists: []` and `preset-comments: []`.
 * - A new draft starts from the newest version's members, as from every other member (C2).
 * - Publish refuses, with `case_template_invalid` and each error by pointer and code: a layout module
 *   the version's `layout-modules` does not offer, a module whose `required-permissions` the
 *   publisher does not hold (C172.1), a checklist item naming a status the version does not hold
 *   (C172.2), and a required field the version does not declare (C172.3).
 *
 * Every value is synthetic.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestApi, type TestApi } from '../../../test-support/harness.js';

let api: TestApi;
let token: string;

beforeAll(async () => {
  api = await createTestApi();
  token = api.newUserToken(api.environmentId);
}, 120_000);

afterAll(async () => {
  await api.close();
});

let calls = 0;
const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown, as = token) => {
  calls += 1;
  return api.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { ...bearer(as), 'idempotency-key': `version-members-${String(calls)}` },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
};

interface Resource {
  id: string;
  attributes: Record<string, unknown>;
  relationships: Record<string, { data: { id: string } | null }>;
}
interface Problem {
  code?: string;
  errors?: { pointer?: string; code?: string }[];
}

const data = (response: { body: string }) => (JSON.parse(response.body) as { data: Resource }).data;
const problem = (response: { body: string }) => JSON.parse(response.body) as Problem;

const LAYOUT = {
  columns: 2,
  modules: [
    { key: 'timeline', column: 1, order: 0, collapsed: false },
    { key: 'comments', column: 2, order: 0, collapsed: true },
  ],
};
const CHECKLISTS = [
  {
    key: 'identity',
    label: 'Identity checks',
    items: [
      { key: 'id-reviewed', label: 'ID reviewed', 'required-for-statuses': ['approved'] },
      { key: 'address-reviewed', label: 'Address reviewed', 'required-for-statuses': [] },
    ],
  },
];
const PRESET_COMMENTS = [{ key: 'ask', label: 'Ask again', text: 'Please send a clearer copy.' }];
const FIELDS = [{ key: 'score', label: 'Score', type: 'integer' }];
const status = (key: string, category: string, extra: Record<string, unknown> = {}) => ({
  key,
  label: key,
  category,
  'pauses-sla': false,
  'required-comment': false,
  'status-tags': [],
  'status-tag-required': false,
  ...extra,
});
const STATUSES = [
  status('open', 'initial'),
  status('approved', 'end', { 'requires-fields': ['score'] }),
  status('declined', 'end'),
];

let keys = 0;
async function template(attributes: Record<string, unknown> = {}) {
  keys += 1;
  const created = await call('POST', '/case-templates', {
    data: { attributes: { name: 'Synthetic layout', key: `VM${String(keys)}`, ...attributes } },
  });
  expect(created.statusCode, created.body).toBe(201);
  const resource = data(created);
  return { id: resource.id, draftId: resource.relationships['draft-version']?.data?.id ?? '' };
}

const version = async (id: string) =>
  data(await call('GET', `/case-template-versions/${id}`)).attributes;

describe('the version members (C172.1-C172.4)', () => {
  it('are stored from a new template and served on its draft', async () => {
    const t = await template({
      'field-schemas': FIELDS,
      statuses: STATUSES,
      layout: LAYOUT,
      checklists: CHECKLISTS,
      'preset-comments': PRESET_COMMENTS,
    });

    const attributes = await version(t.draftId);

    expect(attributes).toMatchObject({
      layout: LAYOUT,
      checklists: CHECKLISTS,
      'preset-comments': PRESET_COMMENTS,
    });
    expect((attributes.statuses as { 'requires-fields'?: string[] }[])[1]).toMatchObject({
      key: 'approved',
      'requires-fields': ['score'],
    });
  });

  it('read none on a version that never set them', async () => {
    const t = await template();

    expect(await version(t.draftId)).toMatchObject({
      layout: null,
      checklists: [],
      'preset-comments': [],
    });
  });

  it('carry into a new draft from the newest version, and a change replaces or clears them', async () => {
    const t = await template({
      'field-schemas': FIELDS,
      statuses: STATUSES,
      layout: LAYOUT,
      checklists: CHECKLISTS,
      'preset-comments': PRESET_COMMENTS,
    });
    const published = await call('POST', `/case-template-versions/${t.draftId}/publish`, {
      meta: {},
    });
    expect(published.statusCode, published.body).toBe(200);

    const next = await call('POST', '/case-template-versions', {
      data: { attributes: { 'case-template-id': t.id } },
    });
    expect(next.statusCode, next.body).toBe(201);
    const nextId = data(next).id;
    expect(data(next).attributes).toMatchObject({
      layout: LAYOUT,
      checklists: CHECKLISTS,
      'preset-comments': PRESET_COMMENTS,
    });

    const cleared = await call('PATCH', `/case-template-versions/${nextId}`, {
      data: { attributes: { layout: null, checklists: [], 'preset-comments': [] } },
    });

    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(data(cleared).attributes).toMatchObject({
      layout: null,
      checklists: [],
      'preset-comments': [],
    });
  });

  it('publish when every module, status and field they name is the version’s and the publisher’s', async () => {
    const t = await template({
      'field-schemas': FIELDS,
      statuses: STATUSES,
      layout: LAYOUT,
      checklists: CHECKLISTS,
    });

    const published = await call('POST', `/case-template-versions/${t.draftId}/publish`, {
      meta: {},
    });

    expect(published.statusCode, published.body).toBe(200);
  });
});

describe('publishing them (C172.1-C172.3; case_template_invalid)', () => {
  const publish = (id: string, as = token) =>
    call('POST', `/case-template-versions/${id}/publish`, { meta: {} }, as);

  it('refuses a layout module the version does not offer', async () => {
    const t = await template({
      'layout-modules': [{ key: 'timeline', 'required-permissions': ['cases:read'] }],
      layout: { columns: 1, modules: [{ key: 'graph', column: 1, order: 0, collapsed: false }] },
    });

    const refused = await publish(t.draftId);

    expect(refused.statusCode, refused.body).toBe(422);
    expect(problem(refused)).toMatchObject({
      code: 'case_template_invalid',
      errors: [{ pointer: '/data/attributes/layout/modules/0/key', code: 'layout_module_unknown' }],
    });
  });

  it('refuses a layout module whose permissions the publisher does not hold', async () => {
    const t = await template({
      layout: {
        columns: 1,
        modules: [
          { key: 'timeline', column: 1, order: 0, collapsed: false },
          { key: 'graph', column: 1, order: 1, collapsed: false },
        ],
      },
    });
    const publisher = api.newUserToken(api.environmentId, {
      permissions: ['case-templates:read', 'case-templates:publish', 'cases:read'],
    });

    const refused = await publish(t.draftId, publisher);

    expect(refused.statusCode, refused.body).toBe(422);
    expect(problem(refused)).toMatchObject({
      code: 'case_template_invalid',
      errors: [
        { pointer: '/data/attributes/layout/modules/1/key', code: 'layout_module_not_permitted' },
      ],
    });
  });

  it('refuses a checklist item naming a status the version does not hold, and a required field it does not declare', async () => {
    const t = await template({
      'field-schemas': FIELDS,
      statuses: [
        status('open', 'initial'),
        status('approved', 'end', { 'requires-fields': ['score', 'missing'] }),
      ],
      checklists: [
        {
          key: 'identity',
          label: 'Identity checks',
          items: [{ key: 'id-reviewed', label: 'ID', 'required-for-statuses': ['nowhere'] }],
        },
      ],
    });

    const refused = await publish(t.draftId);

    expect(refused.statusCode, refused.body).toBe(422);
    const body = problem(refused);
    expect(body.code).toBe('case_template_invalid');
    expect(body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pointer: '/data/attributes/checklists/0/items/0/required-for-statuses/0',
          code: 'checklist_status_unknown',
        }),
        expect.objectContaining({
          pointer: '/data/attributes/statuses/1/requires-fields/1',
          code: 'required_field_unknown',
        }),
      ]),
    );
    expect(body.errors).toHaveLength(2);
  });
});
