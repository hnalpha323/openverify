/**
 * C172.2, C172.3 (Workflow 9B, `api-cases-reports`; foundation-9b C7): what a case must hold before
 * it enters a status, asked by Phase 8's transition service (`setCaseStatusInTx`) under the case's
 * lock, so `set-status`, the bulk job and the workflow step all meet it.
 *
 * - A status that an unchecked item of the version's checklists names in `required-for-statuses` is
 *   refused with 422 `case_checklist_incomplete` (C172.2).
 * - A status whose `requires-fields` names a field without a value is refused with 422
 *   `case_fields_required` (C172.3).
 * - Each refusal names keys only, at `/meta/status`, never a value; the case stays as it was.
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
    headers: { ...bearer(token), 'idempotency-key': `guard-${String(calls)}` },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
};

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

let keys = 0;
async function openCase() {
  keys += 1;
  const created = await call('POST', '/case-templates', {
    data: {
      attributes: {
        name: 'Synthetic guard',
        key: `GD${String(keys)}`,
        'field-schemas': [
          { key: 'score', label: 'Score', type: 'integer' },
          { key: 'note', label: 'Note', type: 'string' },
        ],
        statuses: [
          status('open', 'initial'),
          status('approved', 'end', { 'requires-fields': ['score', 'note'] }),
          status('declined', 'end'),
        ],
        checklists: [
          {
            key: 'identity',
            label: 'Identity checks',
            items: [
              { key: 'id-reviewed', label: 'ID reviewed', 'required-for-statuses': ['approved'] },
              { key: 'other', label: 'Other', 'required-for-statuses': [] },
            ],
          },
        ],
      },
    },
  });
  expect(created.statusCode, created.body).toBe(201);
  const template = (
    JSON.parse(created.body) as {
      data: { id: string; relationships: { 'draft-version': { data: { id: string } } } };
    }
  ).data;
  const versionId = template.relationships['draft-version'].data.id;
  expect(
    (await call('POST', `/case-template-versions/${versionId}/publish`, { meta: {} })).statusCode,
  ).toBe(200);
  const opened = await call('POST', '/cases', {
    data: { attributes: { 'case-template-id': template.id } },
  });
  expect(opened.statusCode, opened.body).toBe(201);
  return (JSON.parse(opened.body) as { data: { id: string } }).data.id;
}

interface Problem {
  code?: string;
  errors?: { pointer?: string; detail: string }[];
}

const setStatus = (caseId: string, to: string) =>
  call('POST', `/cases/${caseId}/set-status`, { meta: { status: to } });
const statusOf = async (caseId: string) =>
  (
    JSON.parse((await call('GET', `/cases/${caseId}`)).body) as {
      data: { attributes: { status: string } };
    }
  ).data.attributes.status;

describe('entering a status (C172.2, C172.3)', () => {
  it('refuses a status an unchecked required item names, then the fields it requires, then allows it', async () => {
    const caseId = await openCase();

    const unchecked = await setStatus(caseId, 'approved');
    expect(unchecked.statusCode, unchecked.body).toBe(422);
    expect(JSON.parse(unchecked.body) as Problem).toMatchObject({
      code: 'case_checklist_incomplete',
      errors: [{ pointer: '/meta/status' }],
    });
    expect((JSON.parse(unchecked.body) as Problem).errors?.[0]?.detail).toContain('id-reviewed');
    expect(await statusOf(caseId)).toBe('open');

    const checked = await call('POST', `/cases/${caseId}/checklist`, {
      meta: { 'checklist-key': 'identity', 'item-key': 'id-reviewed', checked: true },
    });
    expect(checked.statusCode, checked.body).toBe(200);
    const filled = await call('PATCH', `/cases/${caseId}`, {
      data: { attributes: { fields: { score: 7, note: '   ' } } },
    });
    expect(filled.statusCode, filled.body).toBe(200);

    const missing = await setStatus(caseId, 'approved');
    expect(missing.statusCode, missing.body).toBe(422);
    const problem = JSON.parse(missing.body) as Problem;
    expect(problem.code).toBe('case_fields_required');
    expect(problem.errors?.map(({ pointer }) => pointer)).toEqual(['/meta/status']);
    expect(problem.errors?.[0]?.detail).toContain('note');
    expect(missing.body).not.toContain('"score"');
    expect(await statusOf(caseId)).toBe('open');

    await call('PATCH', `/cases/${caseId}`, {
      data: { attributes: { fields: { note: 'synthetic note' } } },
    });
    const allowed = await setStatus(caseId, 'approved');
    expect(allowed.statusCode, allowed.body).toBe(200);
    expect(await statusOf(caseId)).toBe('approved');
  });

  it('allows a status no unchecked item or required field names', async () => {
    const caseId = await openCase();

    const declined = await setStatus(caseId, 'declined');

    expect(declined.statusCode, declined.body).toBe(200);
  });
});
