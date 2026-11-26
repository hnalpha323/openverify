import { afterEach, describe, expect, it, vi } from 'vitest';
import { INQUIRY_ID, SESSION_TOKEN } from '../testing/flow-fixtures';
import { FlowApiError } from './flow-api-client';
import { redeemOneTimeLink } from './one-time-link-client';

const BASE_URL = 'https://api.example.com';
const ONE_TIME_TOKEN = `ovo_${'C'.repeat(21)}_-${'d'.repeat(20)}`;
const LINK = { inquiryId: INQUIRY_ID, oneTimeToken: ONE_TIME_TOKEN };
const EXPIRES_AT = '2026-10-21T12:00:00.000Z';

function json(body: unknown, status = 200, contentType = 'application/json'): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': contentType } });
}

function refused(): Response {
  return json(
    {
      type: 'about:blank',
      title: 'Unauthorized',
      status: 401,
      detail: 'The one-time link is not valid or has expired.',
      instance: '/api/v1/flow/one-time-links/redeem',
      requestId: 'req-1',
    },
    401,
    'application/problem+json',
  );
}

function stub(...responses: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchStub = vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({
      url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      init,
    });
    const next = responses.shift();
    if (next === undefined) {
      return Promise.reject(new Error('unexpected request'));
    }
    return next instanceof Response ? Promise.resolve(next) : Promise.reject(next);
  });
  return { fetch: fetchStub, calls };
}

async function caught(promise: Promise<unknown>): Promise<FlowApiError> {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof FlowApiError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected the promise to reject');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('redeemOneTimeLink (C10)', () => {
  it('POSTs the inquiry ID and one-time token, without credentials, and returns the session', async () => {
    const { fetch, calls } = stub(
      json({ 'session-token': SESSION_TOKEN, 'expires-at': EXPIRES_AT }),
    );

    const session = await redeemOneTimeLink({ baseUrl: BASE_URL, fetch }, LINK);

    expect(session).toEqual({ sessionToken: SESSION_TOKEN, expiresAt: EXPIRES_AT });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe(`${BASE_URL}/api/v1/flow/one-time-links/redeem`);
    expect(call?.init.method).toBe('POST');
    expect(JSON.parse(call?.init.body as string)).toEqual({
      'inquiry-id': INQUIRY_ID,
      'one-time-token': ONE_TIME_TOKEN,
    });
    const headers = new Headers(call?.init.headers);
    expect(headers.get('authorization')).toBeNull();
    expect(headers.get('content-type')).toBe('application/json');
    expect(call?.init).toMatchObject({
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
  });

  it('never puts the one-time token in the URL', async () => {
    const { fetch, calls } = stub(
      json({ 'session-token': SESSION_TOKEN, 'expires-at': EXPIRES_AT }),
    );

    await redeemOneTimeLink({ baseUrl: '', fetch }, LINK);

    expect(calls[0]?.url).toBe('/api/v1/flow/one-time-links/redeem');
  });

  it('reports a refused link as a 401 that never echoes the token', async () => {
    const { fetch } = stub(refused());

    const error = await caught(redeemOneTimeLink({ baseUrl: BASE_URL, fetch }, LINK));

    expect(error).toMatchObject({ kind: 'http', status: 401 });
    expect(error.message).not.toContain(ONE_TIME_TOKEN);
    expect(JSON.stringify(error)).not.toContain(ONE_TIME_TOKEN);
  });

  it('refuses an answer that is not a session token', async () => {
    const { fetch } = stub(json({ 'session-token': 'ovs_short', 'expires-at': EXPIRES_AT }));

    await expect(
      caught(redeemOneTimeLink({ baseUrl: BASE_URL, fetch }, LINK)),
    ).resolves.toMatchObject({ kind: 'invalid-response' });
  });

  it('refuses to send a malformed token', async () => {
    const { fetch } = stub();

    await expect(
      redeemOneTimeLink({ baseUrl: BASE_URL, fetch }, { ...LINK, oneTimeToken: 'ovo_short' }),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('times out like every flow request (1B F018)', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(
      (_input: RequestInfo | URL, init: RequestInit = {}) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    const result = caught(
      redeemOneTimeLink({ baseUrl: BASE_URL, fetch, timeouts: { requestMs: 10 } }, LINK),
    );

    await vi.advanceTimersByTimeAsync(10);

    await expect(result).resolves.toMatchObject({ kind: 'timeout' });
  });
});
