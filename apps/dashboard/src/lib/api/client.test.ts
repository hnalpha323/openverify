// @vitest-environment node
import { dashboardMeDocumentSchema, inquiryListDocumentSchema } from '@openverify/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_TOKEN, listDocument } from '../../testing/api-fixtures';
import { BFF_TOKEN, meDocument, mockApi, type MockApi } from '../../testing/api-mock';
import { fakeRequest } from '../../testing/fake-request';
import { redirectTarget } from '../../testing/next-errors';
import { SESSION_COOKIE } from '../session-cookie';
import { apiRequest, getApiClient, getBffFetch, publicApiRequest } from './client';
import { markPeerAddressHeaderTrusted } from './peer-address';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

const MARK = Symbol.for('openverify.dashboard.peer-address-header');
let api: MockApi;

beforeEach(() => {
  api = mockApi();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  fakeRequest.headers.set('x-openverify-peer-ip', '198.51.100.7');
  markPeerAddressHeaderTrusted();
});

afterEach(() => {
  api.restore();
  Reflect.deleteProperty(globalThis, MARK);
});

describe('getApiClient', () => {
  it("is the C18 client with this request's session token and BFF headers", async () => {
    api.reply(200, listDocument([]));

    const client = await getApiClient();
    await client.inquiries.list({ filter: { status: 'failed' } });

    const request = api.last();
    expect(request.path).toBe('/api/v1/inquiries');
    expect(request.query.get('filter[status]')).toBe('failed');
    expect(request.headers.get('authorization')).toBe(`Bearer ${SESSION_TOKEN}`);
    expect(request.headers.get('x-openverify-client-ip')).toBe('198.51.100.7');
    expect(request.headers.get('x-openverify-bff-token')).toBe(BFF_TOKEN);
  });

  it('never retries: an operator sees a failure at once, and a write is never sent twice', async () => {
    // Only one answer: a retry would find nothing queued, which fails the test at restore().
    api.replyProblem(503);

    const client = await getApiClient();

    await expect(client.inquiries.list()).rejects.toMatchObject({ status: 503 });
    expect(api.requests).toHaveLength(1);
  });

  it('sends the operator to sign in without a session cookie, without calling the API', async () => {
    fakeRequest.cookies.clear();

    await expect(redirectTarget(getApiClient())).resolves.toBe('/login');
    expect(api.requests).toHaveLength(0);
  });
});

describe('apiRequest', () => {
  it('reaches any server or dashboard endpoint with the session, parsed with its schema', async () => {
    api.reply(200, meDocument());

    const me = await apiRequest({
      method: 'GET',
      path: '/dashboard/me',
      schema: dashboardMeDocumentSchema,
    });

    expect(me.meta?.permissions).toEqual(['inquiries:read']);
    expect(api.last().headers.get('authorization')).toBe(`Bearer ${SESSION_TOKEN}`);
    expect(api.last().headers.get('x-openverify-client-ip')).toBe('198.51.100.7');
  });

  it('sends the operator to sign in without a session cookie', async () => {
    fakeRequest.cookies.clear();

    await expect(
      redirectTarget(
        apiRequest({ method: 'GET', path: '/inquiries', schema: inquiryListDocumentSchema }),
      ),
    ).resolves.toBe('/login');
    expect(api.requests).toHaveLength(0);
  });
});

describe('publicApiRequest', () => {
  it('calls a route that takes no session without one, with the BFF headers', async () => {
    api.reply(200, listDocument([]));

    await publicApiRequest({
      method: 'GET',
      path: '/inquiries',
      schema: inquiryListDocumentSchema,
    });

    expect(api.last().headers.has('authorization')).toBe(false);
    expect(api.last().headers.get('x-openverify-client-ip')).toBe('198.51.100.7');
  });
});

describe('getBffFetch', () => {
  it('is a fetch with the BFF headers, for answers streamed through (file content)', async () => {
    api.reply(200, {});

    const bffFetch = await getBffFetch();
    await bffFetch('http://api.test:3000/api/v1/dashboard/files/x/content');

    expect(api.last().headers.get('x-openverify-client-ip')).toBe('198.51.100.7');
    expect(api.last().headers.get('x-openverify-bff-token')).toBe(BFF_TOKEN);
  });
});
