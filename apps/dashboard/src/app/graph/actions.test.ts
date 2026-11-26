// @vitest-environment node
import type { Permission } from '@openverify/core';
import { revalidatePath } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GRAPH_PROBLEM_WORDS } from '../../components/graph/graph-words';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import {
  ACCOUNT_CONFIG,
  GRAPH_IDS as IDS,
  NODE_IDS,
  SHARED_EMAIL,
  actionResultDocument,
  graphQuery,
  graphTemplate,
  graphTemplateDraft,
  graphTemplateVersion,
  nodeValueDocument,
  single,
} from '../../testing/graph-fixtures';
import { redirectTarget } from '../../testing/next-errors';
import { GRAPH_DEVELOPER, GRAPH_REVIEWER } from '../../testing/routes/graph';
import {
  archiveGraphTemplate,
  cancelGraphQuery,
  createGraphDraft,
  createGraphTemplate,
  expandAroundAccount,
  graphBulkAction,
  publishGraphDraft,
  renameGraphTemplate,
  rerunGraphQuery,
  runGraphQuery,
  unmaskGraphNode,
  updateGraphDraft,
} from './actions';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let api: RouteApi;

const as = (...permissions: Permission[]) => api.me({ permissions });

const form = (fields: Record<string, string | readonly string[]>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    for (const each of typeof value === 'string' ? [value] : value) {
      data.append(name, each);
    }
  }
  return data;
};

const ACTIONS = `/graph-queries/${IDS.query}/actions`;
const VALUE = `/graph-queries/${IDS.query}/nodes/${NODE_IDS.email}/value`;

beforeEach(() => {
  vi.mocked(revalidatePath).mockReset();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  as(...GRAPH_REVIEWER);
});

afterEach(() => {
  api.restore();
});

describe('unmaskGraphNode (C102.6, P17)', () => {
  const fields = { 'graph-query-id': IDS.query, 'node-id': NODE_IDS.email };

  it('asks the audited unmask route for one value', async () => {
    api.on('GET', VALUE, 200, nodeValueDocument());
    await expect(unmaskGraphNode(null, form(fields))).resolves.toEqual({
      ok: true,
      data: { value: SHARED_EMAIL },
    });
    expect(api.all('GET', VALUE)).toHaveLength(1);
  });

  it('never calls it without pii:view', async () => {
    as(...GRAPH_DEVELOPER);
    const result = await unmaskGraphNode(null, form(fields));
    expect(result.ok).toBe(false);
    expect(api.all('GET', VALUE)).toHaveLength(0);
  });

  it('answers a redacted query with its code', async () => {
    api.onProblem('GET', VALUE, 410, undefined, { code: 'graph_query_redacted' });
    const result = await unmaskGraphNode(null, form(fields));
    expect(result).toMatchObject({
      ok: false,
      problem: { status: 410, code: 'graph_query_redacted' },
    });
  });

  it('refuses a node id that is not a result-local id, before calling anything', async () => {
    const result = await unmaskGraphNode(null, form({ ...fields, 'node-id': 'gn_short' }));
    expect(result.ok).toBe(false);
    expect(api.all('GET', VALUE)).toHaveLength(0);
  });
});

describe('graphBulkAction (C103)', () => {
  it('previews a tag on the selected accounts and answers the count in the stored result', async () => {
    api.on(
      'POST',
      ACTIONS,
      200,
      actionResultDocument('add-tag', { preview: true, selectedCount: 2 }),
    );
    const result = await graphBulkAction(
      null,
      form({
        'graph-query-id': IDS.query,
        action: 'add-tag',
        tag: 'ring-review',
        'account-id': [IDS.accountA, IDS.accountB],
        preview: 'true',
      }),
    );
    expect(result).toEqual({
      ok: true,
      data: { action: 'add-tag', preview: true, selectedCount: 2, outcomes: [] },
    });
    expect(api.find('POST', ACTIONS)?.body).toEqual({
      data: {
        attributes: {
          action: 'add-tag',
          tag: 'ring-review',
          'account-ids': [IDS.accountA, IDS.accountB],
          preview: true,
        },
      },
    });
  });

  it('applies it through the node client, which sends an Idempotency-Key, and answers each outcome', async () => {
    api.on(
      'POST',
      ACTIONS,
      200,
      actionResultDocument('set-account-status', {
        outcomes: [
          { accountId: IDS.accountA, outcome: 'done' },
          { accountId: IDS.accountB, outcome: 'skipped_redacted' },
        ],
      }),
    );
    const result = await graphBulkAction(
      null,
      form({
        'graph-query-id': IDS.query,
        action: 'set-account-status',
        status: 'archived',
        all: 'true',
      }),
    );
    expect(result).toEqual({
      ok: true,
      data: {
        action: 'set-account-status',
        preview: false,
        selectedCount: 2,
        outcomes: [
          { accountId: IDS.accountA, outcome: 'done' },
          { accountId: IDS.accountB, outcome: 'skipped_redacted' },
        ],
      },
    });
    const request = api.find('POST', ACTIONS);
    expect(request?.headers.get('idempotency-key')).toMatch(/^.{1,255}$/);
    expect(request?.body).toEqual({
      data: { attributes: { action: 'set-account-status', status: 'archived', all: true } },
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/graph/${IDS.query}`);
  });

  it('adds a kind’s values to a list', async () => {
    api.on(
      'POST',
      ACTIONS,
      200,
      actionResultDocument('add-to-list', { preview: true, selectedCount: 1 }),
    );
    await graphBulkAction(
      null,
      form({
        'graph-query-id': IDS.query,
        action: 'add-to-list',
        'list-id': IDS.list,
        kind: 'email_address',
        'account-id': [IDS.accountA],
        preview: 'true',
      }),
    );
    expect(api.find('POST', ACTIONS)?.body).toMatchObject({
      data: { attributes: { action: 'add-to-list', 'list-id': IDS.list, kind: 'email_address' } },
    });
  });

  it('acts only within the caller’s rights: an action whose scope the role lacks is refused without calling the API', async () => {
    as('graph:read', 'accounts:read');
    const result = await graphBulkAction(
      null,
      form({ 'graph-query-id': IDS.query, action: 'add-tag', tag: 'x', all: 'true' }),
    );
    expect(result.ok).toBe(false);
    as('graph:read', 'lists:write');
    const listing = await graphBulkAction(
      null,
      form({
        'graph-query-id': IDS.query,
        action: 'add-to-list',
        'list-id': IDS.list,
        kind: 'email_address',
        all: 'true',
      }),
    );
    expect(listing.ok).toBe(false);
    expect(api.all('POST', ACTIONS)).toHaveLength(0);
  });

  it('answers the API’s refusal of the whole call (403) with its detail, and a selection over 500 with its code', async () => {
    api.onProblem('POST', ACTIONS, 403, 'forbidden', { detail: 'Missing accounts:write.' });
    const refused = await graphBulkAction(
      null,
      form({ 'graph-query-id': IDS.query, action: 'remove-tag', tag: 'x', all: 'true' }),
    );
    expect(refused).toMatchObject({ ok: false, problem: { detail: 'Missing accounts:write.' } });
    api.onProblem('POST', ACTIONS, 422, undefined, { code: 'selection_too_large' });
    const large = await graphBulkAction(
      null,
      form({ 'graph-query-id': IDS.query, action: 'remove-tag', tag: 'x', all: 'true' }),
    );
    expect(large).toMatchObject({ ok: false, problem: { code: 'selection_too_large' } });
  });

  it('never sends the export as JSON: the export streams through its own route', async () => {
    const result = await graphBulkAction(
      null,
      form({ 'graph-query-id': IDS.query, action: 'export', all: 'true' }),
    );
    expect(result.ok).toBe(false);
    expect(api.all('POST', ACTIONS)).toHaveLength(0);
  });

  it('previews the export’s count, which needs accounts:read and pii:view', async () => {
    api.on(
      'POST',
      ACTIONS,
      200,
      actionResultDocument('export', { preview: true, selectedCount: 3 }),
    );
    await expect(
      graphBulkAction(
        null,
        form({ 'graph-query-id': IDS.query, action: 'export', all: 'true', preview: 'true' }),
      ),
    ).resolves.toMatchObject({ ok: true, data: { selectedCount: 3 } });
  });
});

describe('running, rerunning, cancelling and expanding (C102.4)', () => {
  it('runs a template with its parameters and opens the result', async () => {
    api.on('POST', '/graph-queries', 201, single(graphQuery({ status: 'submitted' })));
    await expect(
      redirectTarget(
        runGraphQuery(
          null,
          form({
            'graph-query-template-id': IDS.template,
            'parameter:account_id': ` ${IDS.accountA} `,
            'parameter:unused': '',
          }),
        ),
      ),
    ).resolves.toBe(`/graph/${IDS.query}`);
    expect(api.find('POST', '/graph-queries')?.body).toEqual({
      data: {
        type: 'graph-query',
        attributes: {
          'graph-query-template-id': IDS.template,
          'parameter-map': { account_id: IDS.accountA },
        },
      },
    });
  });

  it('runs it synchronously when asked, and says a refused run in words', async () => {
    api.onProblem('POST', '/graph-queries', 429, undefined, { code: 'graph_sync_limited' });
    const result = await runGraphQuery(
      null,
      form({
        'graph-query-template-id': IDS.template,
        'parameter:account_id': IDS.accountA,
        'run-sync': 'on',
      }),
    );
    expect(result).toMatchObject({
      ok: false,
      problem: { title: GRAPH_PROBLEM_WORDS.graph_sync_limited, code: 'graph_sync_limited' },
    });
    expect(api.find('POST', '/graph-queries')?.body).toMatchObject({ meta: { 'run-sync': true } });
  });

  it('reruns and cancels a stored query, refreshing its page', async () => {
    api.on('POST', `/graph-queries/${IDS.query}/rerun`, 200, single(graphQuery()));
    api.on(
      'POST',
      `/graph-queries/${IDS.query}/cancel`,
      200,
      single(graphQuery({ status: 'cancelled' })),
    );
    await expect(rerunGraphQuery(null, form({ 'graph-query-id': IDS.query }))).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    await expect(cancelGraphQuery(null, form({ 'graph-query-id': IDS.query }))).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/graph/${IDS.query}`);
  });

  it('expands around an account by running the template synchronously with account_id bound', async () => {
    const expansion = graphQuery({ id: IDS.expansion });
    api.on('POST', '/graph-queries', 201, single(expansion));
    await expect(
      expandAroundAccount(
        null,
        form({ 'graph-query-template-id': IDS.template, 'account-id': IDS.accountC }),
      ),
    ).resolves.toEqual({ ok: true, data: expansion });
    expect(api.find('POST', '/graph-queries')?.body).toEqual({
      data: {
        type: 'graph-query',
        attributes: {
          'graph-query-template-id': IDS.template,
          'parameter-map': { account_id: IDS.accountC },
        },
      },
      meta: { 'run-sync': true },
    });
  });

  it('never expands around anything but an account', async () => {
    const result = await expandAroundAccount(
      null,
      form({ 'graph-query-template-id': IDS.template, 'account-id': NODE_IDS.email }),
    );
    expect(result.ok).toBe(false);
    expect(api.all('POST', '/graph-queries')).toHaveLength(0);
  });
});

describe('templates and drafts (C102.1)', () => {
  const VERSIONS = '/graph-query-template-versions';
  const DRAFT_PAGE = `/graph/templates/${IDS.template}/versions/${IDS.draft}`;

  it('creates a template and opens its first draft, which holds the configuration (K7B-3)', async () => {
    api.on(
      'POST',
      '/graph-query-templates',
      201,
      single(graphTemplate({ publishedVersion: null, latestVersionId: IDS.draft })),
    );
    await expect(
      redirectTarget(
        createGraphTemplate(
          null,
          form({ name: 'Shared contact details', config: JSON.stringify(ACCOUNT_CONFIG) }),
        ),
      ),
    ).resolves.toBe(DRAFT_PAGE);
    expect(api.find('POST', '/graph-query-templates')?.body).toEqual({
      data: {
        type: 'graph-query-template',
        attributes: { name: 'Shared contact details', config: ACCOUNT_CONFIG },
      },
    });
    expect(api.all('POST', VERSIONS)).toHaveLength(0);
  });

  it('opens the template when a server names no latest version', async () => {
    api.on(
      'POST',
      '/graph-query-templates',
      201,
      single(graphTemplate({ publishedVersion: null })),
    );
    await expect(
      redirectTarget(
        createGraphTemplate(
          null,
          form({ name: 'Shared contact details', config: JSON.stringify(ACCOUNT_CONFIG) }),
        ),
      ),
    ).resolves.toBe(`/graph/templates/${IDS.template}`);
  });

  it('answers a configuration that is not JSON, or breaks the schema, at its pointer', async () => {
    const broken = await createGraphTemplate(null, form({ name: 'x', config: '{' }));
    expect(broken).toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/data/attributes/config' }] },
    });
    const invalid = await createGraphTemplate(
      null,
      form({ name: 'x', config: JSON.stringify({ ...ACCOUNT_CONFIG, 'max-hops': 3 }) }),
    );
    expect(invalid).toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/data/attributes/config/max-hops' }] },
    });
    expect(api.all('POST', '/graph-query-templates')).toHaveLength(0);
  });

  it('renames and archives a template', async () => {
    api.on('PATCH', `/graph-query-templates/${IDS.template}`, 200, single(graphTemplate()));
    api.on(
      'DELETE',
      `/graph-query-templates/${IDS.template}`,
      200,
      single(graphTemplate({ status: 'archived' })),
    );
    await renameGraphTemplate(
      null,
      form({ 'graph-query-template-id': IDS.template, name: 'Renamed' }),
    );
    expect(api.find('PATCH', `/graph-query-templates/${IDS.template}`)?.body).toEqual({
      data: { type: 'graph-query-template', attributes: { name: 'Renamed' } },
    });
    await archiveGraphTemplate(null, form({ 'graph-query-template-id': IDS.template }));
    expect(api.all('DELETE', `/graph-query-templates/${IDS.template}`)).toHaveLength(1);
    expect(revalidatePath).toHaveBeenCalledWith(`/graph/templates/${IDS.template}`);
  });

  it('drafts a new version and opens it', async () => {
    api.on('POST', VERSIONS, 201, single(graphTemplateDraft()));
    await expect(
      redirectTarget(
        createGraphDraft(
          null,
          form({ 'graph-query-template-id': IDS.template, config: JSON.stringify(ACCOUNT_CONFIG) }),
        ),
      ),
    ).resolves.toBe(DRAFT_PAGE);
  });

  it('saves a draft and says, in words and at their pointers, what publishing would refuse', async () => {
    const weak = { ...ACCOUNT_CONFIG, 'connect-kinds': ['email_address', 'ip_address'] };
    api.on('PATCH', `${VERSIONS}/${IDS.draft}`, 200, single(graphTemplateDraft()));
    const result = await updateGraphDraft(
      null,
      form({
        'graph-query-template-id': IDS.template,
        'version-id': IDS.draft,
        config: JSON.stringify(weak),
      }),
    );
    expect(result).toEqual({
      ok: true,
      data: {
        publishProblems: [
          { pointer: '/connect-kinds/1', words: GRAPH_PROBLEM_WORDS.weak_kind_not_allowed },
        ],
      },
    });
    expect(api.find('PATCH', `${VERSIONS}/${IDS.draft}`)?.body).toEqual({
      data: { type: 'graph-query-template-version', attributes: { config: weak } },
    });
  });

  it('publishes a draft, and says a refusal in words at each pointer', async () => {
    api.on(
      'POST',
      `${VERSIONS}/${IDS.draft}/publish`,
      200,
      single(graphTemplateVersion({ id: IDS.draft })),
    );
    await expect(
      publishGraphDraft(
        null,
        form({ 'graph-query-template-id': IDS.template, 'version-id': IDS.draft }),
      ),
    ).resolves.toEqual({ ok: true, data: undefined });
    api.onProblem('POST', `${VERSIONS}/${IDS.draft}/publish`, 422, undefined, {
      code: 'graph_parameter_unbound',
      errors: [
        {
          location: 'body',
          pointer: '/data/attributes/config/start/0/value',
          detail: 'graph_parameter_unbound',
        },
      ],
    });
    const refused = await publishGraphDraft(
      null,
      form({ 'graph-query-template-id': IDS.template, 'version-id': IDS.draft }),
    );
    expect(refused).toMatchObject({
      ok: false,
      problem: {
        title: GRAPH_PROBLEM_WORDS.graph_parameter_unbound,
        errors: [
          {
            pointer: '/data/attributes/config/start/0/value',
            detail: GRAPH_PROBLEM_WORDS.graph_parameter_unbound,
          },
        ],
      },
    });
  });

  it('needs graph:write for every template change', async () => {
    as('graph:read');
    const result = await renameGraphTemplate(
      null,
      form({ 'graph-query-template-id': IDS.template, name: 'x' }),
    );
    expect(result.ok).toBe(false);
    expect(api.requests.filter((request) => request.method !== 'GET')).toHaveLength(0);
  });
});

describe('the graph’s create-case (C140.6, Workflow 8C)', () => {
  const CASE_TEMPLATE = 'ctmpl_01JE0000000000000000000001';
  const CASE_QUEUE = 'cqueue_01JE0000000000000000000001';
  const CREATED = 'case_01JE0000000000000000000001';
  const createCase = (fields: Record<string, string | readonly string[]>) =>
    graphBulkAction(
      null,
      form({
        'graph-query-id': IDS.query,
        action: 'create-case',
        'case-template-id': CASE_TEMPLATE,
        'account-id': [IDS.accountA, IDS.accountB],
        ...fields,
      }),
    );

  it('creates one case holding the selected accounts through the node client, with an Idempotency-Key, and answers its id', async () => {
    as(...GRAPH_REVIEWER, 'cases:write');
    api.on('POST', ACTIONS, 200, {
      data: {
        type: 'graph-query-action',
        attributes: {
          action: 'create-case',
          preview: false,
          'selected-count': 2,
          outcomes: [
            { 'account-id': IDS.accountA, outcome: 'done' },
            { 'account-id': IDS.accountB, outcome: 'skipped_redacted' },
          ],
          'case-id': CREATED,
        },
      },
    });

    const result = await createCase({ 'case-queue-id': CASE_QUEUE });

    expect(result).toMatchObject({
      ok: true,
      data: { action: 'create-case', preview: false, selectedCount: 2, caseId: CREATED },
    });
    const request = api.find('POST', ACTIONS);
    expect(request?.headers.get('idempotency-key')).toMatch(/^.{1,255}$/);
    expect(request?.body).toEqual({
      data: {
        attributes: {
          action: 'create-case',
          'case-template-id': CASE_TEMPLATE,
          'case-queue-id': CASE_QUEUE,
          'account-ids': [IDS.accountA, IDS.accountB],
        },
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/graph/${IDS.query}`);
  });

  it('sends no queue when none is chosen, answers that no case was made, and asks nothing without cases:write', async () => {
    as(...GRAPH_REVIEWER, 'cases:write');
    api.on('POST', ACTIONS, 200, {
      data: {
        type: 'graph-query-action',
        attributes: {
          action: 'create-case',
          preview: false,
          'selected-count': 1,
          outcomes: [{ 'account-id': IDS.accountA, outcome: 'skipped_redacted' }],
          'case-id': null,
        },
      },
    });

    const result = await createCase({ 'case-queue-id': '' });
    expect(result).toMatchObject({ ok: true, data: { caseId: null } });
    expect(api.find('POST', ACTIONS)?.body).toEqual({
      data: {
        attributes: {
          action: 'create-case',
          'case-template-id': CASE_TEMPLATE,
          'account-ids': [IDS.accountA, IDS.accountB],
        },
      },
    });

    as(...GRAPH_REVIEWER);
    expect(await createCase({})).toMatchObject({
      ok: false,
      problem: { title: 'You do not have access' },
    });
    expect(api.all('POST', ACTIONS)).toHaveLength(1);
  });
});
