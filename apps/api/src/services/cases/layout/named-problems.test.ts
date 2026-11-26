/**
 * K8-27 (carried from Phase 8; plan item 27, contracts B41), built by `api-cases-reports` in Workflow
 * 9B: the three refusals that answered an unnamed problem now carry their codes.
 *
 * - `case_template_invalid` (422): the case template publish (field schemas, the status map, a field
 *   keeping its type, the users told of a new case), a version naming a queue or policy this
 *   environment does not hold, and a template listing a role of another organisation, each with its
 *   `errors[]` by pointer and never a value;
 * - `case_search_invalid` (422): `compileCaseSearch`'s grammar refusals, with their `search_*` codes;
 * - `attachment_scan_failed` (409): an attachment whose scan ended in error (asserted in
 *   `attachments/attachments.test.ts`, the existing test of that path).
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
const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) => {
  calls += 1;
  return api.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { ...bearer(token), 'idempotency-key': `named-problems-${String(calls)}` },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
};

interface Problem {
  status: number;
  code?: string;
  errors?: { pointer?: string; code?: string; detail: string }[];
}

const problem = (response: { body: string }) => JSON.parse(response.body) as Problem;

let keys = 0;
async function draftOf(attributes: Record<string, unknown> = {}) {
  keys += 1;
  const created = await call('POST', '/case-templates', {
    data: {
      attributes: { name: 'Synthetic named problems', key: `NP${String(keys)}`, ...attributes },
    },
  });
  expect(created.statusCode, created.body).toBe(201);
  const data = JSON.parse(created.body) as {
    data: { id: string; relationships: { 'draft-version': { data: { id: string } } } };
  };
  return { id: data.data.id, draftId: data.data.relationships['draft-version'].data.id };
}

describe('case_template_invalid (K8-27)', () => {
  it('names a publish refusal, keeping each error’s code and pointer', async () => {
    const { draftId } = await draftOf({
      'field-schemas': [
        { key: 'note', label: 'Note', type: 'string' },
        { key: 'note', label: 'Note again', type: 'string' },
      ],
    });

    const refused = await call('POST', `/case-template-versions/${draftId}/publish`, { meta: {} });

    expect(refused.statusCode, refused.body).toBe(422);
    const body = problem(refused);
    expect(body.code).toBe('case_template_invalid');
    expect(body.errors?.map(({ pointer }) => pointer)).toEqual([
      '/data/attributes/field-schemas/1/key',
    ]);
    expect(body.errors?.[0]?.code).toBeDefined();
  });

  it('names a field whose type changed across versions with field_type_changed', async () => {
    const { id, draftId } = await draftOf({
      'field-schemas': [{ key: 'score', label: 'Score', type: 'integer' }],
    });
    await call('POST', `/case-template-versions/${draftId}/publish`, { meta: {} });
    const next = await call('POST', '/case-template-versions', {
      data: {
        attributes: {
          'case-template-id': id,
          'field-schemas': [{ key: 'score', label: 'Score', type: 'string' }],
        },
      },
    });
    const nextId = (JSON.parse(next.body) as { data: { id: string } }).data.id;

    const refused = await call('POST', `/case-template-versions/${nextId}/publish`, { meta: {} });

    expect(refused.statusCode, refused.body).toBe(422);
    const body = problem(refused);
    expect(body.code).toBe('case_template_invalid');
    expect(body.errors).toEqual([
      expect.objectContaining({
        pointer: '/data/attributes/field-schemas/0/type',
        code: 'field_type_changed',
      }),
    ]);
  });

  it('names a version naming a queue this environment does not hold, and a role of no organisation', async () => {
    const { draftId } = await draftOf();

    const queue = await call('PATCH', `/case-template-versions/${draftId}`, {
      data: { attributes: { 'default-queue-id': 'cqueue_00000000000000000000000000' } },
    });
    const role = await call('POST', '/case-templates', {
      data: {
        attributes: {
          name: 'Synthetic named problems',
          key: 'NPROLE',
          'visible-to-roles': ['role_00000000000000000000000000'],
        },
      },
    });

    expect([queue.statusCode, role.statusCode]).toEqual([422, 422]);
    expect([problem(queue).code, problem(role).code]).toEqual([
      'case_template_invalid',
      'case_template_invalid',
    ]);
    expect(problem(queue).errors?.map(({ pointer }) => pointer)).toEqual([
      '/data/attributes/default-queue-id',
    ]);
    expect(problem(role).errors?.map(({ pointer }) => pointer)).toEqual([
      '/data/attributes/visible-to-roles/0',
    ]);
  });
});

describe('case_search_invalid (K8-27)', () => {
  it('names a search the grammar refuses, keeping its search_* code and never echoing a value', async () => {
    const refused = await call('POST', '/cases/search', {
      query: { attribute: 'fields.unknown-key', operator: 'eq', value: 'synthetic-secret-q' },
    });

    expect(refused.statusCode, refused.body).toBe(422);
    const body = problem(refused);
    expect(body.code).toBe('case_search_invalid');
    expect(body.errors?.every(({ code }) => code?.startsWith('search_') === true)).toBe(true);
    expect(refused.body).not.toContain('synthetic-secret-q');
  });
});
