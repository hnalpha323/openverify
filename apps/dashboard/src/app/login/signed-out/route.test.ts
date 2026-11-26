// @vitest-environment node
/**
 * C245.2 (Workflow 11B, auth-sessions): `GET /login/signed-out` clears the session cookie only once
 * the API has refused the session, so a cross-site link cannot sign a live operator out, and sends
 * the operator to sign in with the reason in words.
 */
import { OpenVerifyApiError, OpenVerifyConnectionError, type ApiProblem } from '@openverify/node';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { problemDocument } from '../../../testing/api-mock';
import { GET } from './route';

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  getSessionToken: vi.fn(),
  clearSessionCookie: vi.fn(),
}));

vi.mock('../../../lib/api/client', () => ({ apiRequest: mocks.apiRequest }));
vi.mock('../../../lib/session', () => ({
  getSessionToken: mocks.getSessionToken,
  clearSessionCookie: mocks.clearSessionCookie,
}));

const ORIGIN = 'http://dashboard.test';
// A synthetic session token; never a real one.
const TOKEN = 'ovu_synthetic_session_token_for_tests';

const expired = (reason: string) =>
  new OpenVerifyApiError(
    problemDocument(401, undefined, { code: 'session_expired', reason }) as unknown as ApiProblem,
    'req-synthetic-0001',
  );

const get = (query: string) => GET(new Request(`${ORIGIN}/login/signed-out${query}`));

beforeEach(() => {
  mocks.apiRequest.mockReset();
  mocks.getSessionToken.mockReset().mockResolvedValue(TOKEN);
  mocks.clearSessionCookie.mockReset().mockResolvedValue(undefined);
});

describe('GET /login/signed-out (C245.2)', () => {
  it.each([
    ['idle', '/login?reason=session-idle'],
    ['absolute', '/login?reason=session-absolute'],
  ])(
    'clears the cookie once the API refuses the session (%s) and says why on the sign-in page',
    async (reason, target) => {
      mocks.apiRequest.mockRejectedValueOnce(expired(reason));

      const response = await get(`?reason=${reason}`);

      expect(mocks.apiRequest).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ method: 'GET', path: '/dashboard/me' }),
      );
      expect(mocks.clearSessionCookie).toHaveBeenCalledOnce();
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe(`${ORIGIN}${target}`);
    },
  );

  it('keeps a live session and returns home, so a link from elsewhere cannot sign anyone out', async () => {
    mocks.apiRequest.mockResolvedValueOnce({ data: {} });

    const response = await get('?reason=idle');

    expect(mocks.clearSessionCookie).not.toHaveBeenCalled();
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/`);
  });

  it('keeps the cookie when the API cannot be reached, and says nothing it does not know', async () => {
    mocks.apiRequest.mockRejectedValueOnce(new OpenVerifyConnectionError('synthetic outage'));

    const response = await get('?reason=idle');

    expect(mocks.clearSessionCookie).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toBe(`${ORIGIN}/login`);
  });

  it('goes to the sign-in page with the notice without calling the API when no cookie is left', async () => {
    mocks.getSessionToken.mockResolvedValueOnce(null);

    const response = await get('?reason=absolute');

    expect(mocks.apiRequest).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toBe(`${ORIGIN}/login?reason=session-absolute`);
  });

  it('shows no notice for a reason it does not know, and still clears a refused session', async () => {
    mocks.apiRequest.mockRejectedValueOnce(expired('idle'));

    const response = await get('?reason=%3Cscript%3E');

    expect(mocks.clearSessionCookie).toHaveBeenCalledOnce();
    expect(response.headers.get('location')).toBe(`${ORIGIN}/login`);
  });

  it('never caches the answer', async () => {
    mocks.apiRequest.mockRejectedValueOnce(expired('idle'));

    const response = await get('?reason=idle');

    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
});
