// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../../../lib/session-cookie';
import { IDS, SESSION_TOKEN } from '../../../../testing/api-fixtures';
import { fakeRequest } from '../../../../testing/fake-request';
import { GET } from './route';

const mocks = vi.hoisted(() => ({
  fetchFileContent: vi.fn(),
}));

vi.mock('../../../../lib/dashboard-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/dashboard-api')>()),
  fetchFileContent: mocks.fetchFileContent,
}));

vi.mock('next/headers', () =>
  import('../../../../testing/fake-request').then((m) => m.nextHeaders),
);

beforeEach(() => {
  mocks.fetchFileContent.mockReset();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
});

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

function get(id: string) {
  return GET(new Request(`http://dashboard.test/files/${id}/content`), {
    params: Promise.resolve({ id }),
  });
}

function upstream(status: number, body: BodyInit | null, contentType: string) {
  return new Response(body, { status, headers: { 'content-type': contentType } });
}

describe('GET /files/:id/content', () => {
  it("streams the API's decrypted image with the session token, never cached", async () => {
    mocks.fetchFileContent.mockResolvedValueOnce(upstream(200, JPEG, 'image/jpeg'));

    const response = await get(IDS.front);

    expect(mocks.fetchFileContent).toHaveBeenCalledExactlyOnceWith(IDS.front);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(JPEG);
  });

  it('answers 401 without a session (fetchFileContent then calls nothing)', async () => {
    fakeRequest.cookies.clear();
    mocks.fetchFileContent.mockResolvedValueOnce(null);

    const response = await get(IDS.front);

    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('answers 404 for a malformed id, without calling the API', async () => {
    const response = await get('..%2F..%2Fme');

    expect(response.status).toBe(404);
    expect(mocks.fetchFileContent).not.toHaveBeenCalled();
  });

  it.each([
    [401, 401],
    // C15: an operator without pii:view; C16: a redacted inquiry's files are gone.
    [403, 403],
    [404, 404],
    [410, 410],
    [500, 502],
    [503, 502],
  ])('maps an API %i to %i without passing its body on', async (status, expected) => {
    mocks.fetchFileContent.mockResolvedValueOnce(
      upstream(status, '{"detail":"synthetic"}', 'application/problem+json'),
    );

    const response = await get(IDS.front);

    expect(response.status).toBe(expected);
    expect(await response.text()).toBe('');
  });

  // C52.4 and C66: the API answers a document's PDF only as an attachment, and the console
  // offers it only as a download, so the browser never renders an uploaded PDF.
  it("passes a PDF on as a download, keeping the API's attachment disposition unchanged", async () => {
    const pdf = new TextEncoder().encode('%PDF-1.7 synthetic');
    const disposition = `attachment; filename="document-${IDS.front}.pdf"`;
    mocks.fetchFileContent.mockResolvedValueOnce(
      new Response(pdf, {
        status: 200,
        headers: { 'content-type': 'application/pdf', 'content-disposition': disposition },
      }),
    );

    const response = await get(IDS.front);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toBe(disposition);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(pdf);
  });

  it.each([
    ['without a disposition', null],
    ['shown inline', 'inline; filename="x.pdf"'],
  ])('refuses a PDF %s, so it can never render in the console', async (_name, disposition) => {
    const headers: Record<string, string> = { 'content-type': 'application/pdf' };
    if (disposition !== null) headers['content-disposition'] = disposition;
    mocks.fetchFileContent.mockResolvedValueOnce(
      new Response('%PDF-1.7', { status: 200, headers }),
    );

    const response = await get(IDS.front);

    expect(response.status).toBe(502);
    expect(response.headers.get('content-disposition')).toBeNull();
    expect(await response.text()).toBe('');
  });

  it('refuses to pass on content that is not an accepted image type', async () => {
    mocks.fetchFileContent.mockResolvedValueOnce(upstream(200, '<script>', 'text/html'));

    const response = await get(IDS.front);

    expect(response.status).toBe(502);
    expect(await response.text()).toBe('');
  });

  // Next.js dedupes GET fetches during a request by tee()ing the response and keeping the
  // second branch. Cancelling one tee branch only settles once both are cancelled, so a
  // handler that awaits `body.cancel()` on an API error hangs forever.
  it.each([401, 404, 500])(
    'answers a %i promptly even when the body is one branch of a tee, as Next.js fetch returns it',
    async (status) => {
      const held: ReadableStream[] = [];
      const source = new Response('{"detail":"synthetic"}').body;
      if (source === null) throw new Error('no body');
      const [branch, kept] = source.tee();
      held.push(kept);
      mocks.fetchFileContent.mockResolvedValueOnce(
        new Response(branch, {
          status,
          headers: { 'content-type': 'application/problem+json' },
        }),
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
      expect(held).toHaveLength(1);
    },
  );

  it('still answers when draining the error body fails', async () => {
    const failing = new ReadableStream({
      pull: (controller) => {
        controller.error(new Error('connection reset'));
      },
    });
    mocks.fetchFileContent.mockResolvedValueOnce(
      new Response(failing, {
        status: 404,
        headers: { 'content-type': 'application/problem+json' },
      }),
    );

    expect((await get(IDS.front)).status).toBe(404);
  });

  it('answers 502 when the API cannot be reached', async () => {
    mocks.fetchFileContent.mockRejectedValueOnce(new TypeError('fetch failed'));

    expect((await get(IDS.front)).status).toBe(502);
  });
});
