// @vitest-environment node
import {
  OpenVerifyApiError,
  OpenVerifyConnectionError,
  OpenVerifyResponseValidationError,
  OpenVerifyTimeoutError,
} from '@openverify/node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { API_URL, BFF_TOKEN, mockApi, problemDocument, type MockApi } from '../../testing/api-mock';
import {
  bffHeaders,
  createBffFetch,
  sendApiRequest,
  sendApiRequestWithHeaders,
  type BffContext,
} from './http';

let api: MockApi;

beforeEach(() => {
  api = mockApi();
});

afterEach(() => {
  api.restore();
});

const CONTEXT: BffContext = {
  baseUrl: API_URL,
  token: SESSION_TOKEN,
  clientAddress: '198.51.100.7',
  bffToken: BFF_TOKEN,
};

const thing = z.strictObject({ data: z.strictObject({ id: z.string() }) });

describe('bffHeaders', () => {
  it("sends the operator's address and the BFF token (C21)", () => {
    expect(bffHeaders(CONTEXT)).toEqual({
      'x-openverify-client-ip': '198.51.100.7',
      'x-openverify-bff-token': BFF_TOKEN,
    });
  });

  it('sends no address when it is unknown, and no token when none is configured', () => {
    expect(bffHeaders({ ...CONTEXT, clientAddress: null, bffToken: null })).toEqual({});
  });
});

describe('createBffFetch', () => {
  it('adds the BFF headers to every request, uncached and without following redirects', async () => {
    api.reply(200, {});
    const bffFetch = createBffFetch(CONTEXT);

    await bffFetch(`${API_URL}/api/v1/inquiries`, { headers: { accept: 'application/json' } });

    const { headers } = api.last();
    expect(headers.get('x-openverify-client-ip')).toBe('198.51.100.7');
    expect(headers.get('x-openverify-bff-token')).toBe(BFF_TOKEN);
    expect(headers.get('accept')).toBe('application/json');
  });

  it('never forwards a client address or token the caller put in the request', async () => {
    api.reply(200, {});
    const bffFetch = createBffFetch({ ...CONTEXT, clientAddress: null, bffToken: null });

    await bffFetch(`${API_URL}/api/v1/inquiries`, {
      headers: { 'x-openverify-client-ip': '203.0.113.66', 'x-openverify-bff-token': 'forged' },
    });

    expect(api.last().headers.has('x-openverify-client-ip')).toBe(false);
    expect(api.last().headers.has('x-openverify-bff-token')).toBe(false);
  });
});

describe('sendApiRequest', () => {
  it('sends a JSON request with the session token and the BFF headers', async () => {
    api.reply(200, { data: { id: 'x' } });

    await expect(
      sendApiRequest(CONTEXT, {
        method: 'POST',
        path: '/dashboard/users/invitations',
        body: { email: 'invitee@example.test' },
        schema: thing,
      }),
    ).resolves.toEqual({ data: { id: 'x' } });

    const request = api.last();
    expect(request.method).toBe('POST');
    expect(request.path).toBe('/api/v1/dashboard/users/invitations');
    expect(request.body).toEqual({ email: 'invitee@example.test' });
    expect(request.headers.get('authorization')).toBe(`Bearer ${SESSION_TOKEN}`);
    expect(request.headers.get('content-type')).toBe('application/json');
    expect(request.headers.get('accept')).toBe('application/json');
    expect(request.headers.get('x-openverify-client-ip')).toBe('198.51.100.7');
    expect(request.headers.get('x-openverify-bff-token')).toBe(BFF_TOKEN);
  });

  it('sends no authorization for the routes that take no session', async () => {
    api.reply(200, { data: { id: 'x' } });

    await sendApiRequest(
      { ...CONTEXT, token: null },
      { method: 'GET', path: '/dashboard/me', schema: thing },
    );

    expect(api.last().headers.has('authorization')).toBe(false);
    expect(api.last().headers.has('content-type')).toBe(false);
  });

  it('builds the query string, leaving out undefined values', async () => {
    api.reply(200, { data: { id: 'x' } });

    await sendApiRequest(CONTEXT, {
      method: 'GET',
      path: '/dashboard/users',
      query: { 'filter[status]': 'active', 'page[after]': undefined, 'page[size]': '25' },
      schema: thing,
    });

    expect(Object.fromEntries(api.last().query)).toEqual({
      'filter[status]': 'active',
      'page[size]': '25',
    });
  });

  it.each(['dashboard/me', '/dashboard/../inquiries', '/dashboard/me?x=1', '/dashboard/me#x'])(
    'refuses the path %j before sending anything',
    async (path) => {
      await expect(
        sendApiRequest(CONTEXT, { method: 'GET', path, schema: thing }),
      ).rejects.toBeInstanceOf(TypeError);
      expect(api.requests).toHaveLength(0);
    },
  );

  it('drops members a newer API adds (2B F028)', async () => {
    api.reply(200, { data: { id: 'x', added: true } });

    await expect(
      sendApiRequest(CONTEXT, { method: 'GET', path: '/dashboard/me', schema: thing }),
    ).resolves.toEqual({ data: { id: 'x' } });
  });

  it('parses an empty 204 answer', async () => {
    api.reply(204);

    await expect(
      sendApiRequest(CONTEXT, {
        method: 'DELETE',
        path: '/dashboard/me/mfa-factors/mfa_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z',
        schema: z.undefined(),
      }),
    ).resolves.toBeUndefined();
  });

  it('throws OpenVerifyApiError with the problem for an error answer', async () => {
    api.reply(409, problemDocument(409, 'invalid-transition'), {
      'x-request-id': 'req-synthetic-0001',
    });

    const failure = sendApiRequest(CONTEXT, {
      method: 'GET',
      path: '/dashboard/me',
      schema: thing,
    });

    await expect(failure).rejects.toBeInstanceOf(OpenVerifyApiError);
    await expect(failure).rejects.toMatchObject({
      status: 409,
      type: 'https://openverify.dev/problems/invalid-transition',
      requestId: 'req-synthetic-0001',
    });
  });

  it('throws OpenVerifyResponseValidationError for a success that breaks the contract', async () => {
    api.reply(200, { data: { id: 7 } });

    await expect(
      sendApiRequest(CONTEXT, { method: 'GET', path: '/dashboard/me', schema: thing }),
    ).rejects.toBeInstanceOf(OpenVerifyResponseValidationError);
  });

  it('throws OpenVerifyConnectionError when the API cannot be reached', async () => {
    api.fail();

    await expect(
      sendApiRequest(CONTEXT, { method: 'GET', path: '/dashboard/me', schema: thing }),
    ).rejects.toBeInstanceOf(OpenVerifyConnectionError);
  });

  it('throws OpenVerifyTimeoutError when the API does not answer in time', async () => {
    api.fail(new DOMException('The operation timed out.', 'TimeoutError'));

    await expect(
      sendApiRequest(CONTEXT, { method: 'GET', path: '/dashboard/me', schema: thing }),
    ).rejects.toBeInstanceOf(OpenVerifyTimeoutError);
  });
});

describe('sendApiRequestWithHeaders (C154.3, Workflow 9C)', () => {
  it('sends the call’s own headers and answers the parsed body with the answer’s headers', async () => {
    api.reply(200, { data: { id: 'x' } }, { etag: '"synthetic-etag"' });

    const answer = await sendApiRequestWithHeaders(CONTEXT, {
      method: 'PATCH',
      path: '/inquiry-template-versions/itmplv_1',
      headers: { 'if-match': '"synthetic-before"' },
      body: {},
      schema: thing,
    });

    expect(answer.data).toEqual({ data: { id: 'x' } });
    expect(answer.headers.get('etag')).toBe('"synthetic-etag"');
    expect(api.last().headers.get('if-match')).toBe('"synthetic-before"');
    expect(api.last().headers.get('authorization')).toBe(`Bearer ${SESSION_TOKEN}`);
  });

  it('never lets a call choose the session, the BFF token or the client address', async () => {
    api.reply(200, { data: { id: 'x' } });

    await sendApiRequestWithHeaders(CONTEXT, {
      method: 'GET',
      path: '/dashboard/me',
      headers: {
        authorization: 'Bearer synthetic-other',
        'x-openverify-bff-token': 'synthetic-other',
        'x-openverify-client-ip': '203.0.113.9',
      },
      schema: thing,
    });

    expect(api.last().headers.get('authorization')).toBe(`Bearer ${SESSION_TOKEN}`);
    expect(api.last().headers.get('x-openverify-bff-token')).toBe(BFF_TOKEN);
    expect(api.last().headers.get('x-openverify-client-ip')).toBe('198.51.100.7');
  });
});
