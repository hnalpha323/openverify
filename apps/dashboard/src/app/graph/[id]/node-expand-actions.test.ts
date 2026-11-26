// @vitest-environment node
/**
 * Owner decision 20 after Workflow 7B (B42): the property-node expansion posts to the node's own
 * route on the stored query, synchronously, and says each refusal in words.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CASES_REPORTS_COPY } from '../../../lib/copy/cases-reports';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../testing/api-routes';
import { fakeRequest } from '../../../testing/fake-request';
import { GRAPH_IDS, NODE_IDS, graphQuery } from '../../../testing/graph-fixtures';
import { expandPropertyNode } from './node-expand-actions';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));

const EXPAND = `/graph-queries/${GRAPH_IDS.query}/nodes/${NODE_IDS.email}/expand`;
let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: ['graph:read', 'graph:write', 'pii:view'] });
});

afterEach(() => {
  api.restore();
});

const form = (fields: Record<string, string> = {}) => {
  const data = new FormData();
  data.set('graph-query-id', GRAPH_IDS.query);
  data.set('node-id', NODE_IDS.email);
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

describe('expandPropertyNode', () => {
  it('runs the node’s expansion synchronously and answers the new query', async () => {
    api.on('POST', EXPAND, 201, { data: graphQuery({ id: GRAPH_IDS.expansion }) });

    const result = await expandPropertyNode(null, form());

    expect(result.ok && result.data.id).toBe(GRAPH_IDS.expansion);
    expect(api.find('POST', EXPAND)?.body).toEqual({ meta: { 'run-sync': true } });
  });

  it('refuses a malformed node id without calling the API', async () => {
    const result = await expandPropertyNode(
      null,
      form({ 'node-id': 'acc_01M5CN00000000000000009B63' }),
    );

    expect(result.ok).toBe(false);
    expect(api.requests.some((request) => request.method === 'POST')).toBe(false);
  });

  it.each([
    [403, CASES_REPORTS_COPY.graphExpand.refusals[403]],
    [404, CASES_REPORTS_COPY.graphExpand.refusals[404]],
    [422, CASES_REPORTS_COPY.graphExpand.refusals[422]],
  ] as const)('says a %i in words', async (status, words) => {
    api.onProblem('POST', EXPAND, status);

    const result = await expandPropertyNode(null, form());

    expect(!result.ok && result.problem.title).toBe(words);
  });

  it('keeps the graph words of a redacted query and a busy environment', async () => {
    api.onProblem('POST', EXPAND, 410, undefined, { code: 'graph_query_redacted' });

    const result = await expandPropertyNode(null, form());

    expect(!result.ok && result.problem.title).toBe(
      'This query was redacted, so its result and its values are gone.',
    );
  });

  it('calls nothing without graph:write', async () => {
    api.me({ permissions: ['graph:read'] });

    const result = await expandPropertyNode(null, form());

    expect(result.ok).toBe(false);
    expect(api.find('POST', EXPAND)).toBeUndefined();
  });
});
