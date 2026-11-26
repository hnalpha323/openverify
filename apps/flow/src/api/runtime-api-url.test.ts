import { describe, expect, it, vi } from 'vitest';
import { FLOW_RUNTIME_CONFIG_PATH } from '../security/runtime-config';
import { resolveApiBaseUrl, RUNTIME_API_URL_KEY } from './runtime-api-url';

// C257.1 (Phase 11, Workflow 11C, images-11c; verification V07, decision 73): a bundle built with
// VITE_OPENVERIFY_API_URL uses it as today, without a request; one built without it (the image)
// reads the API base URL the flow server serves as /config.json before it renders.
const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('the API base URL of the bundle (C257.1)', () => {
  it('uses the build-time value as today, without a request', async () => {
    const fetch = vi.fn(() => json({}));
    await expect(resolveApiBaseUrl('https://api.example.com/v1/', fetch)).resolves.toBe(
      'https://api.example.com/v1',
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reads /config.json when the value was unset at build', async () => {
    const fetch = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(() =>
      json({ [RUNTIME_API_URL_KEY]: 'https://api-b.example.com/openverify' }),
    );
    await expect(resolveApiBaseUrl(undefined, fetch)).resolves.toBe(
      'https://api-b.example.com/openverify',
    );
    await expect(resolveApiBaseUrl('  ', fetch)).resolves.toBe(
      'https://api-b.example.com/openverify',
    );
    expect(fetch).toHaveBeenCalledWith(FLOW_RUNTIME_CONFIG_PATH, {
      cache: 'no-store',
      credentials: 'same-origin',
    });
  });

  it("answers the flow's own origin when the server names none", async () => {
    await expect(resolveApiBaseUrl('', () => json({ [RUNTIME_API_URL_KEY]: '' }))).resolves.toBe(
      '',
    );
  });

  it.each([
    ['a failed request', () => Promise.reject(new TypeError('offline'))],
    ['an error status (vite dev serves no /config.json)', () => json({}, 404)],
    ['a body that is not JSON', () => Promise.resolve(new Response('<html>'))],
    ['a member that is not a string', () => json({ [RUNTIME_API_URL_KEY]: 7 })],
    ['a value that is not an http(s) URL', () => json({ [RUNTIME_API_URL_KEY]: 'ftp://x.test' })],
  ])("falls back to the flow's own origin on %s", async (_case, fetch) => {
    await expect(resolveApiBaseUrl(undefined, fetch)).resolves.toBe('');
  });
});
