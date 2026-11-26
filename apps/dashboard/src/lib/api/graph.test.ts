// @vitest-environment node
import { CLIENT_USER_AGENT } from '@openverify/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { API_URL, BFF_TOKEN } from '../../testing/api-mock';
import { fakeRequest } from '../../testing/fake-request';
import { GRAPH_IDS as IDS } from '../../testing/graph-fixtures';
import { SESSION_COOKIE } from '../session-cookie';
import { exportGraphCsv } from './graph';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

const CSV = 'account-id,reference-id\r\nacc_1,"\'=1+1"\r\n';
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  vi.stubEnv('OPENVERIFY_API_URL', API_URL);
  vi.stubEnv('OPENVERIFY_DASHBOARD_BFF_TOKEN', BFF_TOKEN);
  fetchMock = vi.fn(() =>
    Promise.resolve(new Response(CSV, { headers: { 'content-type': 'text/csv; charset=utf-8' } })),
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('exportGraphCsv (C103.2, K7B-9)', () => {
  it('posts the export action through the node client, with the session, an Idempotency-Key of its own and the BFF headers, and answers the text and its type', async () => {
    await expect(exportGraphCsv(IDS.query, { 'account-ids': [IDS.accountA] })).resolves.toEqual({
      csv: CSV,
      contentType: 'text/csv; charset=utf-8',
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_URL}/api/v1/graph-queries/${IDS.query}/actions`);
    expect(init.method).toBe('POST');
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${SESSION_TOKEN}`);
    expect(headers.get('accept')).toBe('text/csv');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('idempotency-key')).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(headers.get('user-agent')).toBe(CLIENT_USER_AGENT);
    expect(headers.get('x-openverify-bff-token')).toBe(BFF_TOKEN);
    expect(init.cache).toBe('no-store');
    expect(JSON.parse(init.body as string)).toEqual({
      data: { attributes: { action: 'export', 'account-ids': [IDS.accountA] } },
    });
  });

  it('sends a new key for each export', async () => {
    await exportGraphCsv(IDS.query, { all: true });
    await exportGraphCsv(IDS.query, { all: true });
    const keys = fetchMock.mock.calls.map(([, init]) =>
      new Headers((init as RequestInit).headers).get('idempotency-key'),
    );
    expect(new Set(keys).size).toBe(2);
  });

  it('answers null without a session, calling nothing', async () => {
    fakeRequest.cookies.clear();
    await expect(exportGraphCsv(IDS.query, { all: true })).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
