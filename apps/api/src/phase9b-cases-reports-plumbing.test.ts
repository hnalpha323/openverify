/**
 * Workflow 9B Stage 1b, checkpoint (C): the case and report plumbing `foundation-9b` freezes for
 * `api-cases-reports` (C172.1-C172.5, C173.3) and the graph node expansion (contracts B42):
 *
 * - `assertCaseTransitionAllowedInTx`, called by Phase 8's transition service (`setCaseStatusInTx`)
 *   under the case's lock, after the map allowed the move and before anything is written, with the
 *   case, its pinned version and both statuses; a refusal leaves the case, its history and its
 *   events as they were;
 * - `POST /cases/:id/checklist` (`cases:write`) and `POST /graph-queries/:id/nodes/:nodeId/expand`
 *   (`graph:write`), with the contract's bodies, 501 until built, listed in the OpenAPI document;
 * - fail closed until built (B16's rule): a case template version's `layout`, `checklists`,
 *   `preset-comments` and a status's `requires-fields`, and a case action's `placement` other than
 *   `header` and its `visible-when`, answer 501 rather than being accepted and ignored (a checklist
 *   or a role restriction that nothing enforces).
 *
 * Every value is synthetic.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as transitionGuard from './services/cases/checklists/guard.js';
import { CaseProblemError } from './services/cases/problems.js';
import { bearer, createTestApi, type TestApi } from './test-support/harness.js';

vi.mock('./services/cases/checklists/guard.js', { spy: true });

let api: TestApi;
let token: string;

beforeAll(async () => {
  api = await createTestApi();
  token = api.newUserToken(api.environmentId);
}, 120_000);

afterAll(async () => {
  await api.close();
});

afterEach(() => {
  vi.clearAllMocks();
});

type Method = 'GET' | 'POST' | 'PATCH';

let calls = 0;
const call = (method: Method, url: string, payload?: unknown, as = token) => {
  calls += 1;
  return api.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { ...bearer(as), 'idempotency-key': `cases-c-${String(calls)}` },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
};

interface Resource {
  id: string;
  attributes: Record<string, unknown>;
  relationships: Record<string, { data: unknown }>;
}

const json = (response: { body: string }) =>
  JSON.parse(response.body) as { data: Resource; code?: string };

let keys = 0;

/** A published template with the default statuses, and its version's id. */
async function template() {
  keys += 1;
  const created = await call('POST', '/case-templates', {
    data: { attributes: { name: 'Synthetic review', key: `CC${String(keys)}` } },
  });
  expect(created.statusCode, created.body).toBe(201);
  const data = json(created).data;
  const versionId = (data.relationships['draft-version']?.data as { id: string }).id;
  const published = await call('POST', `/case-template-versions/${versionId}/publish`, {
    meta: {},
  });
  expect(published.statusCode, published.body).toBe(200);
  return { id: data.id, versionId };
}

async function openCase() {
  const t = await template();
  const response = await call('POST', '/cases', {
    data: { attributes: { 'case-template-id': t.id } },
  });
  expect(response.statusCode, response.body).toBe(201);
  return { template: t, caseId: json(response).data.id };
}

const historyCount = async (caseId: string) =>
  (
    await api.database.client.query<{ count: number }>(
      'select count(*)::int as count from case_history where case_id = $1',
      [caseId],
    )
  ).rows[0]?.count;

const LAYOUT = {
  columns: 2,
  modules: [{ key: 'timeline', column: 2, order: 0, collapsed: false }],
};
const CHECKLISTS = [
  {
    key: 'identity',
    label: 'Identity checks',
    items: [{ key: 'id-reviewed', label: 'ID reviewed', 'required-for-statuses': ['approved'] }],
  },
];
const PRESET_COMMENTS = [{ key: 'ask', label: 'Ask again', text: 'Please send a clearer copy.' }];
const STATUSES_REQUIRING_FIELDS = [
  {
    key: 'open',
    label: 'Open',
    category: 'initial',
    'pauses-sla': false,
    'required-comment': false,
    'status-tags': [],
    'status-tag-required': false,
  },
  {
    key: 'approved',
    label: 'Approved',
    category: 'end',
    'pauses-sla': false,
    'required-comment': false,
    'status-tags': [],
    'status-tag-required': false,
    'requires-fields': ['score'],
  },
];

describe('the transition guard in Phase 8’s transition service (C172.2, C172.3)', () => {
  it('is asked with the locked case, its pinned version and both statuses, and the move happens when it allows', async () => {
    const { template: t, caseId } = await openCase();

    const moved = await call('POST', `/cases/${caseId}/set-status`, {
      meta: { status: 'pending' },
    });

    expect(moved.statusCode, moved.body).toBe(200);
    expect(json(moved).data.attributes).toMatchObject({ status: 'pending' });
    const asked = vi.mocked(transitionGuard.assertCaseTransitionAllowedInTx).mock.calls;
    expect(asked).toHaveLength(1);
    expect(asked[0]?.[1]).toMatchObject({
      row: { id: caseId, status: 'open' },
      version: { id: t.versionId },
      from: 'open',
      to: 'pending',
    });
  });

  it('is not asked for a move the map refuses or a status the case already holds', async () => {
    const { caseId } = await openCase();

    const same = await call('POST', `/cases/${caseId}/set-status`, { meta: { status: 'open' } });
    const unknown = await call('POST', `/cases/${caseId}/set-status`, {
      meta: { status: 'nowhere' },
    });

    expect(same.statusCode, same.body).toBe(200);
    expect(unknown.statusCode, unknown.body).toBe(422);
    expect(vi.mocked(transitionGuard.assertCaseTransitionAllowedInTx)).not.toHaveBeenCalled();
  });

  it('refuses with the guard’s problem, leaving the status, the history and the events as they were', async () => {
    const { caseId } = await openCase();
    const historyBefore = await historyCount(caseId);
    const eventsBefore = api.events.named('case.status-updated').length;
    vi.mocked(transitionGuard.assertCaseTransitionAllowedInTx).mockRejectedValueOnce(
      new CaseProblemError('case_checklist_incomplete', 'A required checklist item is unchecked.'),
    );

    const refused = await call('POST', `/cases/${caseId}/set-status`, {
      meta: { status: 'pending' },
    });

    expect(refused.statusCode, refused.body).toBe(422);
    expect(json(refused).code).toBe('case_checklist_incomplete');
    const read = await call('GET', `/cases/${caseId}`);
    expect(json(read).data.attributes).toMatchObject({ status: 'open' });
    expect(await historyCount(caseId)).toBe(historyBefore);
    expect(api.events.named('case.status-updated')).toHaveLength(eventsBefore);
  });
});

describe('the checklist route, frozen for api-cases-reports (C172.2)', () => {
  // Built by api-cases-reports (services/cases/checklists/checklist.test.ts holds the behaviour).
  it('answers a caller holding cases:write: a checklist the version does not hold is 422', async () => {
    const { caseId } = await openCase();
    const response = await call('POST', `/cases/${caseId}/checklist`, {
      meta: { 'checklist-key': 'identity', 'item-key': 'id-reviewed', checked: true },
    });
    expect(response.statusCode, response.body).toBe(422);
  });

  it('needs cases:write, and reads the contract’s body', async () => {
    const { caseId } = await openCase();
    const reader = api.newUserToken(api.environmentId, { permissions: ['cases:read'] });
    const body = {
      meta: { 'checklist-key': 'identity', 'item-key': 'id-reviewed', checked: true },
    };

    const outcomes = [
      await call('POST', `/cases/${caseId}/checklist`, body, reader),
      await call('POST', `/cases/${caseId}/checklist`, {
        meta: { 'checklist-key': 'Identity', 'item-key': 'id-reviewed', checked: true },
      }),
      await call('POST', `/cases/${caseId}/checklist`, {
        meta: { 'checklist-key': 'identity', 'item-key': 'id-reviewed' },
      }),
      await call('POST', '/cases/inq_00000000000000000000000000/checklist', body),
    ];

    expect(outcomes.map((response) => response.statusCode)).toEqual([403, 400, 400, 400]);
  });
});

describe('the graph node expansion (contracts B42)', () => {
  const NODE = `gn_${'A'.repeat(22)}`;
  const QUERY = 'grphq_00000000000000000000000000';

  // Built by api-cases-reports (services/graph/expand.test.ts holds the behaviour): an unknown
  // source query is 404.
  it('answers a caller holding graph:write, with or without a body: an unknown query is 404', async () => {
    const withBody = await call('POST', `/graph-queries/${QUERY}/nodes/${NODE}/expand`, {
      meta: { 'run-sync': true },
    });
    const without = await api.app.inject({
      method: 'POST',
      url: `/api/v1/graph-queries/${QUERY}/nodes/${NODE}/expand`,
      headers: bearer(token),
    });
    expect([withBody.statusCode, without.statusCode]).toEqual([404, 404]);
  });

  it('needs graph:write, and reads a query id, a node id and the contract’s body', async () => {
    const reader = api.newUserToken(api.environmentId, { permissions: ['graph:read'] });

    const outcomes = [
      await call('POST', `/graph-queries/${QUERY}/nodes/${NODE}/expand`, {}, reader),
      await call('POST', `/graph-queries/${QUERY}/nodes/gn_short/expand`, {}),
      await call('POST', `/graph-queries/case_00000000000000000000000000/nodes/${NODE}/expand`, {}),
      await call('POST', `/graph-queries/${QUERY}/nodes/${NODE}/expand`, { meta: { other: 1 } }),
    ];

    expect(outcomes.map((response) => response.statusCode)).toEqual([403, 400, 400, 400]);
  });
});

describe('the case completion members fail closed until built (C172.1-C172.5; B16’s rule)', () => {
  // Built by api-cases-reports (C172.1-C172.4): stored and served (services/cases/layout/).
  it('takes a template whose first version sets a layout, checklists, preset comments or required fields', async () => {
    const create = (attributes: Record<string, unknown>) => {
      keys += 1;
      return call('POST', '/case-templates', {
        data: { attributes: { name: 'Synthetic review', key: `CF${String(keys)}`, ...attributes } },
      });
    };

    const outcomes = [
      await create({ layout: LAYOUT }),
      await create({ checklists: CHECKLISTS }),
      await create({ 'preset-comments': PRESET_COMMENTS }),
      await create({ statuses: STATUSES_REQUIRING_FIELDS }),
      await create({ layout: null, checklists: [], 'preset-comments': [] }),
    ];

    expect(outcomes.map((response) => response.statusCode)).toEqual([201, 201, 201, 201, 201]);
  });

  it('takes a draft that sets them, created or changed', async () => {
    const t = await template();
    const draft = await call('POST', '/case-template-versions', {
      data: { attributes: { 'case-template-id': t.id } },
    });
    expect(draft.statusCode, draft.body).toBe(201);
    const draftId = json(draft).data.id;

    const outcomes = [
      await call('POST', '/case-template-versions', {
        data: { attributes: { 'case-template-id': t.id, checklists: CHECKLISTS } },
      }),
      await call('PATCH', `/case-template-versions/${draftId}`, {
        data: { attributes: { layout: LAYOUT } },
      }),
      await call('PATCH', `/case-template-versions/${draftId}`, {
        data: { attributes: { 'preset-comments': PRESET_COMMENTS } },
      }),
      await call('PATCH', `/case-template-versions/${draftId}`, {
        data: { attributes: { statuses: STATUSES_REQUIRING_FIELDS } },
      }),
      await call('PATCH', `/case-template-versions/${draftId}`, {
        data: { attributes: { layout: null } },
      }),
    ];

    // The first is refused because the template holds a draft already (409), as in Phase 8.
    expect(outcomes.map((response) => response.statusCode)).toEqual([409, 200, 200, 200, 200]);
  });

  // Built by api-cases-reports: past the guard, the workflow and action ids here are unknown (404);
  // services/cases/layout/action-visibility.test.ts holds the behaviour.
  it('takes an action placed outside the header or restricted by visible-when, created or changed (B34, B37)', async () => {
    const action = (attributes: Record<string, unknown>) =>
      call('POST', '/case-actions', {
        data: {
          attributes: {
            'workflow-id': 'wfl_00000000000000000000000000',
            'case-template-ids': ['ctmpl_00000000000000000000000000'],
            label: 'Escalate',
            ...attributes,
          },
        },
      });
    const change = (attributes: Record<string, unknown>) =>
      call('PATCH', '/case-actions/cact_00000000000000000000000000', { data: { attributes } });
    const visibleWhen = { statuses: ['open'], 'role-ids': [] };

    const outcomes = [
      await action({ placement: 'module:timeline' }),
      await action({ placement: 'status-switcher' }),
      await action({ 'visible-when': visibleWhen }),
      await change({ placement: 'module:timeline' }),
      await change({ 'visible-when': visibleWhen }),
      await action({ placement: 'module:Timeline' }),
    ];

    expect(outcomes.map((response) => response.statusCode)).toEqual([404, 404, 404, 404, 404, 400]);
  });
});

describe('the OpenAPI document (C172, C173; B42)', () => {
  it('lists the checklist and expansion routes, and the 501 of the guarded routes', async () => {
    const { paths } = (await api.app.inject({ url: '/openapi.json' })).json<{
      paths: Record<string, Record<string, { responses?: Record<string, unknown> }>>;
    }>();
    const codes = (path: string, method: string) =>
      Object.keys(paths[`/api/v1${path}`]?.[method]?.responses ?? {});

    expect(codes('/cases/{id}/checklist', 'post')).toEqual(
      expect.arrayContaining(['200', '400', '401', '403', '404', '409', '410', '422']),
    );
    expect(codes('/graph-queries/{id}/nodes/{nodeId}/expand', 'post')).toEqual(
      expect.arrayContaining(['201', '400', '401', '403', '404', '410', '422', '429']),
    );
    for (const [path, method] of [
      ['/case-templates', 'post'],
      ['/case-template-versions', 'post'],
      ['/case-template-versions/{id}', 'patch'],
      ['/case-actions', 'post'],
      ['/case-actions/{id}', 'patch'],
    ] as const) {
      expect(codes(path, method), `${method} ${path}`).not.toContain('501');
    }
  });
});
