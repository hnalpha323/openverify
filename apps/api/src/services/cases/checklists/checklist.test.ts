/**
 * C172.2, C172.7 (Workflow 9B, `api-cases-reports`; contracts B36, foundation-9b C3, C9):
 * `POST /api/v1/cases/:id/checklist` (`cases:write`) checks or unchecks one item of the checklists
 * of the case's pinned version, under `meta.lock-version` as every case change.
 *
 * - A checked item names the user who checked it and when; an unchecked one names neither, so nothing
 *   reads as checked on a person's behalf (C172.7). An API key checks nothing (403).
 * - Each change writes a PII-free history row (`checklist-item-checked` or `-unchecked`, the keys and
 *   the actor), moves the case's `lock-version`, fires `case.updated` and is audited by member name.
 *   Setting the state an item holds writes nothing.
 * - The answer is every item of the version's checklists with its state.
 * - An item or checklist the version does not hold is 422 at its pointer; a stale `lock-version` 409
 *   `case_version_conflict`; a redacted case 410; an unknown case 404.
 *
 * Every value is synthetic.
 */
import { newId } from '@openverify/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestApi, type TestApi } from '../../../test-support/harness.js';

let api: TestApi;
let token: string;
const userId = newId('usr');

beforeAll(async () => {
  api = await createTestApi();
  token = api.newUserToken(api.environmentId, { userId });
}, 120_000);

afterAll(async () => {
  await api.close();
});

let calls = 0;
const call = (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown, as = token) => {
  calls += 1;
  return api.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { ...bearer(as), 'idempotency-key': `checklist-${String(calls)}` },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
};

interface StateDocument {
  data: {
    type: string;
    id: string;
    attributes: {
      items: {
        'checklist-key': string;
        'item-key': string;
        checked: boolean;
        'checked-by': string | null;
        'checked-at': string | null;
      }[];
      'lock-version': number;
    };
  };
}

const CHECKLISTS = [
  {
    key: 'identity',
    label: 'Identity checks',
    items: [
      { key: 'id-reviewed', label: 'ID reviewed', 'required-for-statuses': ['approved'] },
      { key: 'address-reviewed', label: 'Address reviewed', 'required-for-statuses': [] },
    ],
  },
  {
    key: 'sanctions',
    label: 'Sanctions',
    items: [{ key: 'list-checked', label: 'Lists checked', 'required-for-statuses': [] }],
  },
];

let keys = 0;
async function openCase() {
  keys += 1;
  const created = await call('POST', '/case-templates', {
    data: {
      attributes: { name: 'Synthetic checklist', key: `CL${String(keys)}`, checklists: CHECKLISTS },
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
  const data = (
    JSON.parse(opened.body) as { data: { id: string; attributes: Record<string, unknown> } }
  ).data;
  return { caseId: data.id, lockVersion: data.attributes['lock-version'] as number };
}

const set = (caseId: string, meta: Record<string, unknown>, as = token) =>
  call('POST', `/cases/${caseId}/checklist`, { meta }, as);

const history = async (caseId: string) =>
  (
    await api.database.client.query<{
      kind: string;
      actor_type: string;
      actor_id: string | null;
      from: unknown;
      to: unknown;
    }>(
      `select kind, actor_type, actor_id, "from", "to" from case_history
        where case_id = $1 and kind like 'checklist-%' order by id`,
      [caseId],
    )
  ).rows;

describe('POST /cases/:id/checklist (C172.2)', () => {
  it('checks an item naming the user and the time, answering every item of the version', async () => {
    const { caseId, lockVersion } = await openCase();
    const updatedBefore = api.events.named('case.updated').length;

    const response = await set(caseId, {
      'checklist-key': 'identity',
      'item-key': 'id-reviewed',
      checked: true,
      'lock-version': lockVersion,
    });

    expect(response.statusCode, response.body).toBe(200);
    const document = JSON.parse(response.body) as StateDocument;
    expect(document.data).toMatchObject({ type: 'case-checklist-state', id: caseId });
    expect(document.data.attributes['lock-version']).toBe(lockVersion + 1);
    expect(document.data.attributes.items).toEqual([
      {
        'checklist-key': 'identity',
        'item-key': 'id-reviewed',
        checked: true,
        'checked-by': userId,
        'checked-at': api.clock.now().toISOString(),
      },
      {
        'checklist-key': 'identity',
        'item-key': 'address-reviewed',
        checked: false,
        'checked-by': null,
        'checked-at': null,
      },
      {
        'checklist-key': 'sanctions',
        'item-key': 'list-checked',
        checked: false,
        'checked-by': null,
        'checked-at': null,
      },
    ]);
    expect(await history(caseId)).toEqual([
      {
        kind: 'checklist-item-checked',
        actor_type: 'user',
        actor_id: userId,
        from: null,
        to: { 'checklist-key': 'identity', 'item-key': 'id-reviewed' },
      },
    ]);
    expect(api.events.named('case.updated').length).toBe(updatedBefore + 1);
    expect(
      api.audit
        .withAction('case.updated')
        .filter(({ resourceId }) => resourceId === caseId)
        .map(({ metadata }) => metadata),
    ).toEqual([{ attributes: ['checklist'] }]);
  });

  it('unchecks an item naming no one, and writes nothing for the state it holds', async () => {
    const { caseId } = await openCase();
    const item = { 'checklist-key': 'sanctions', 'item-key': 'list-checked' };
    await set(caseId, { ...item, checked: true });

    const unchecked = await set(caseId, { ...item, checked: false });
    const again = await set(caseId, { ...item, checked: false });

    expect(unchecked.statusCode, unchecked.body).toBe(200);
    const state = (JSON.parse(unchecked.body) as StateDocument).data.attributes;
    expect(state.items.find(({ 'item-key': key }) => key === 'list-checked')).toEqual({
      ...item,
      checked: false,
      'checked-by': null,
      'checked-at': null,
    });
    expect(again.statusCode, again.body).toBe(200);
    expect((JSON.parse(again.body) as StateDocument).data.attributes['lock-version']).toBe(
      state['lock-version'],
    );
    expect((await history(caseId)).map(({ kind }) => kind)).toEqual([
      'checklist-item-checked',
      'checklist-item-unchecked',
    ]);
  });

  it('refuses an item or a checklist the version does not hold, by pointer', async () => {
    const { caseId } = await openCase();

    const checklist = await set(caseId, {
      'checklist-key': 'unknown',
      'item-key': 'id-reviewed',
      checked: true,
    });
    const item = await set(caseId, {
      'checklist-key': 'identity',
      'item-key': 'list-checked',
      checked: true,
    });

    expect([checklist.statusCode, item.statusCode]).toEqual([422, 422]);
    const pointers = [checklist, item].map(
      (response) =>
        (JSON.parse(response.body) as { errors?: { pointer?: string }[] }).errors?.[0]?.pointer,
    );
    expect(pointers).toEqual(['/meta/checklist-key', '/meta/item-key']);
    expect(await history(caseId)).toEqual([]);
  });

  it('refuses a stale lock-version, an API key, a redacted case and an unknown one', async () => {
    const { caseId, lockVersion } = await openCase();
    const item = { 'checklist-key': 'identity', 'item-key': 'id-reviewed', checked: true };

    const stale = await set(caseId, { ...item, 'lock-version': lockVersion + 5 });
    const key = await set(caseId, item, api.token);
    const unknown = await set(newId('case'), item);
    const redacted = await openCase();
    await api.database.client.query(
      'update cases set fields = null, redacted_at = now() where id = $1',
      [redacted.caseId],
    );
    const gone = await set(redacted.caseId, item);

    expect([stale.statusCode, key.statusCode, unknown.statusCode, gone.statusCode]).toEqual([
      409, 403, 404, 410,
    ]);
    expect((JSON.parse(stale.body) as { code?: string }).code).toBe('case_version_conflict');
    expect(await history(caseId)).toEqual([]);
  });
});

describe('GET /cases/:id/checklist (C172.2; integration-9b)', () => {
  it('reads every item of the version with its state, with cases:read alone, writing nothing', async () => {
    const { caseId, lockVersion } = await openCase();
    expect(
      (
        await set(caseId, {
          'checklist-key': 'sanctions',
          'item-key': 'list-checked',
          checked: true,
          'lock-version': lockVersion,
        })
      ).statusCode,
    ).toBe(200);
    const reader = api.newUserToken(api.environmentId, { permissions: ['cases:read'] });
    const updatedBefore = api.events.named('case.updated').length;

    const response = await call('GET', `/cases/${caseId}/checklist`, undefined, reader);

    expect(response.statusCode, response.body).toBe(200);
    const document = JSON.parse(response.body) as StateDocument;
    expect(document.data).toMatchObject({ type: 'case-checklist-state', id: caseId });
    expect(document.data.attributes['lock-version']).toBe(lockVersion + 1);
    expect(document.data.attributes.items.map((item) => [item['item-key'], item.checked])).toEqual([
      ['id-reviewed', false],
      ['address-reviewed', false],
      ['list-checked', true],
    ]);
    expect(api.events.named('case.updated').length).toBe(updatedBefore);
  });

  it('answers 404 for an unknown case and 403 without cases:read', async () => {
    const { caseId } = await openCase();
    const none = api.newUserToken(api.environmentId, { permissions: ['inquiries:read'] });

    expect((await call('GET', `/cases/${newId('case')}/checklist`)).statusCode).toBe(404);
    expect((await call('GET', `/cases/${caseId}/checklist`, undefined, none)).statusCode).toBe(403);
  });
});
