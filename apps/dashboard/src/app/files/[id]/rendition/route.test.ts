// @vitest-environment node
/**
 * C135.3 (decision 63, P38): the console's inquiry images are renditions without metadata, read
 * through this route, which mirrors `GET /files/:id/content` (its tests are the model): the session
 * from the cookie, only images passed on, never cached, and API errors reduced to a status. A
 * rendition still being made answers 202 with its `Retry-After`, for the "preparing" placeholder.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../../../lib/session-cookie';
import { IDS, SESSION_TOKEN } from '../../../../testing/api-fixtures';
import { fakeRequest } from '../../../../testing/fake-request';
import { GET } from './route';

const mocks = vi.hoisted(() => ({
  fetchFileRendition: vi.fn(),
}));

vi.mock('../../../../lib/api/file-renditions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/api/file-renditions')>()),
  fetchFileRendition: mocks.fetchFileRendition,
}));

vi.mock('next/headers', () =>
  import('../../../../testing/fake-request').then((m) => m.nextHeaders),
);

beforeEach(() => {
  mocks.fetchFileRendition.mockReset();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
});

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 1, 2, 3]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 4, 5, 6]);

function get(id: string, search = '') {
  return GET(new Request(`http://dashboard.test/files/${id}/rendition${search}`), {
    params: Promise.resolve({ id }),
  });
}

function upstream(
  status: number,
  body: BodyInit | null,
  contentType: string,
  headers: Record<string, string> = {},
) {
  return new Response(body, { status, headers: { 'content-type': contentType, ...headers } });
}

const pending = (retryAfter: string) =>
  upstream(
    202,
    JSON.stringify({ meta: { 'rendition-status': 'pending', 'retry-after-seconds': 5 } }),
    'application/json',
    { 'retry-after': retryAfter },
  );

describe('GET /files/:id/rendition', () => {
  it.each([
    ['image/jpeg', JPEG],
    ['image/png', PNG],
  ])("streams the API's %s rendition with the session, never cached", async (type, bytes) => {
    mocks.fetchFileRendition.mockResolvedValueOnce(upstream(200, bytes, type));

    const response = await get(IDS.front);

    expect(mocks.fetchFileRendition).toHaveBeenCalledExactlyOnceWith(IDS.front, undefined);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(type);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-disposition')).toBeNull();
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it("asks for a PDF's page, and ignores the console's retry counter", async () => {
    mocks.fetchFileRendition.mockResolvedValueOnce(upstream(200, PNG, 'image/png'));

    const response = await get(IDS.front, '?page=3&attempt=2');

    expect(mocks.fetchFileRendition).toHaveBeenCalledExactlyOnceWith(IDS.front, 3);
    expect(response.status).toBe(200);
  });

  it.each(['0', '21', '1.5', 'one', ''])(
    'answers 404 for a page the API never renders (%s), without calling it',
    async (page) => {
      const response = await get(IDS.front, `?page=${page}`);

      expect(response.status).toBe(404);
      expect(mocks.fetchFileRendition).not.toHaveBeenCalled();
    },
  );

  it('answers 202 with its Retry-After while the rendition is prepared, with no body', async () => {
    mocks.fetchFileRendition.mockResolvedValueOnce(pending('5'));

    const response = await get(IDS.front);

    expect(response.status).toBe(202);
    expect(response.headers.get('retry-after')).toBe('5');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.text()).toBe('');
  });

  it.each([
    ['0', '1'],
    ['600', '60'],
    ['soon', '5'],
  ])('keeps a Retry-After of %s within 1 to 60 seconds (%s)', async (given, expected) => {
    mocks.fetchFileRendition.mockResolvedValueOnce(pending(given));

    expect((await get(IDS.front)).headers.get('retry-after')).toBe(expected);
  });

  it('answers 401 without a session', async () => {
    fakeRequest.cookies.clear();
    mocks.fetchFileRendition.mockResolvedValueOnce(null);

    const response = await get(IDS.front);

    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('answers 404 for a malformed id, without calling the API', async () => {
    const response = await get('..%2F..%2Fme');

    expect(response.status).toBe(404);
    expect(mocks.fetchFileRendition).not.toHaveBeenCalled();
  });

  it.each([
    [401, 401],
    // P38: without pii:view or inquiries:read.
    [403, 403],
    // A deleted or redacted source, a kind with no rendition, or a page past the rendered ones.
    [404, 404],
    [410, 410],
    // `rendition_unavailable`: vision could not make it.
    [422, 422],
    [500, 502],
    [503, 502],
  ])('maps an API %i to %i without passing its body on', async (status, expected) => {
    mocks.fetchFileRendition.mockResolvedValueOnce(
      upstream(status, '{"detail":"synthetic"}', 'application/problem+json'),
    );

    const response = await get(IDS.front);

    expect(response.status).toBe(expected);
    expect(await response.text()).toBe('');
  });

  it.each([
    ['a PDF', 'application/pdf'],
    ['HTML', 'text/html'],
    ['WebP, which a rendition never is', 'image/webp'],
  ])('refuses to pass on %s', async (_name, type) => {
    mocks.fetchFileRendition.mockResolvedValueOnce(upstream(200, '%PDF-1.7 <script>', type));

    const response = await get(IDS.front);

    expect(response.status).toBe(502);
    expect(await response.text()).toBe('');
  });

  it.each([401, 404, 500])(
    'answers a %i promptly even when the body is one branch of a tee, as Next.js fetch returns it',
    async (status) => {
      const source = new Response('{"detail":"synthetic"}').body;
      if (source === null) throw new Error('no body');
      const [branch, kept] = source.tee();
      mocks.fetchFileRendition.mockResolvedValueOnce(
        new Response(branch, { status, headers: { 'content-type': 'application/problem+json' } }),
      );

      const response = await Promise.race([
        get(IDS.front),
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => {
            reject(new Error('the handler hung on the error body'));
          }, 2000),
        ),
      ]);

      expect(response.status).toBe(status === 500 ? 502 : status);
      expect(kept.locked).toBe(false);
    },
  );

  it('answers 502 when the API cannot be reached', async () => {
    mocks.fetchFileRendition.mockRejectedValueOnce(new TypeError('fetch failed'));

    expect((await get(IDS.front)).status).toBe(502);
  });
});
