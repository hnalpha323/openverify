// @vitest-environment node
/**
 * C135.1, C142.7: the case attachment upload. A file of up to 10 MiB must never pass a server
 * action's 1 MB limit or the proxy's buffer, so this route handler (left out of `proxy.ts`'s
 * matcher) checks the session and the origin itself and streams the multipart body on to the API,
 * which types, caps, scans and seals it. Its answers are a status and a sentence of ours.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../../testing/api-fixtures';
import { fakeRequest } from '../../../../testing/fake-request';
import { REVIEWER_IDS as IDS } from '../../../../testing/reviewer-fixtures';
import { UPLOAD_LIMIT_BYTES } from '../../../../lib/api/case-attachments';
import { POST } from './route';

const mocks = vi.hoisted(() => ({ streamCaseAttachmentUpload: vi.fn() }));

vi.mock('../../../../lib/api/case-attachments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/api/case-attachments')>()),
  streamCaseAttachmentUpload: mocks.streamCaseAttachmentUpload,
}));

vi.mock('next/headers', () =>
  import('../../../../testing/fake-request').then((m) => m.nextHeaders),
);

beforeEach(() => {
  mocks.streamCaseAttachmentUpload.mockReset();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
});

const BOUNDARY = 'synthetic-boundary';
const MULTIPART = `multipart/form-data; boundary=${BOUNDARY}`;

function upload(
  options: {
    readonly id?: string;
    readonly headers?: Record<string, string>;
    readonly body?: string;
  } = {},
) {
  const id = options.id ?? IDS.case;
  const body =
    options.body ??
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="synthetic.jpg"\r\nContent-Type: image/jpeg\r\n\r\nsynthetic\r\n--${BOUNDARY}--\r\n`;
  return POST(
    new Request(`http://dashboard.test/cases/${id}/attachments`, {
      method: 'POST',
      headers: {
        host: 'dashboard.test',
        origin: 'http://dashboard.test',
        'content-type': MULTIPART,
        'content-length': String(body.length),
        ...options.headers,
      },
      body,
    }),
    { params: Promise.resolve({ id }) },
  );
}

const problem = (status: number, code?: string) =>
  new Response(
    JSON.stringify({ status, title: 'Synthetic', ...(code === undefined ? {} : { code }) }),
    {
      status,
      headers: { 'content-type': 'application/problem+json' },
    },
  );

describe('POST /cases/:id/attachments', () => {
  it('streams the multipart body on to the API unread, and answers 201 with no body of its own', async () => {
    mocks.streamCaseAttachmentUpload.mockResolvedValueOnce(
      new Response('{"data":{}}', { status: 201, headers: { 'content-type': 'application/json' } }),
    );

    const response = await upload();

    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const [caseId, sent] = mocks.streamCaseAttachmentUpload.mock.calls[0] as [
      string,
      { body: ReadableStream; contentType: string },
    ];
    expect(caseId).toBe(IDS.case);
    expect(sent.contentType).toBe(MULTIPART);
    expect(sent.body).toBeInstanceOf(ReadableStream);
    const text = await new Response(sent.body).text();
    expect(text).toContain('synthetic.jpg');
  });

  it('answers 404 for an id that is not a case, without calling the API', async () => {
    const response = await upload({ id: 'inq_01JE0000000000000000000001' });

    expect(response.status).toBe(404);
    expect(mocks.streamCaseAttachmentUpload).not.toHaveBeenCalled();
  });

  it.each([
    ['another site', { origin: 'https://elsewhere.example' }],
    ['a null origin from another site', { origin: 'null', 'sec-fetch-site': 'cross-site' }],
  ])('refuses a post from %s (403), without calling the API', async (_name, headers) => {
    const response = await upload({ headers });

    expect(response.status).toBe(403);
    expect(mocks.streamCaseAttachmentUpload).not.toHaveBeenCalled();
  });

  it('refuses a body that is not multipart (415), without calling the API', async () => {
    const response = await upload({ headers: { 'content-type': 'application/json' } });

    expect(response.status).toBe(415);
    expect(mocks.streamCaseAttachmentUpload).not.toHaveBeenCalled();
  });

  it('refuses a body larger than 10 MiB and its framing (413) before reading it', async () => {
    const response = await upload({
      headers: { 'content-length': String(UPLOAD_LIMIT_BYTES + 1) },
    });

    expect(response.status).toBe(413);
    expect(await response.text()).toBe('The file is larger than 10 MiB.');
    expect(mocks.streamCaseAttachmentUpload).not.toHaveBeenCalled();
  });

  it('counts a chunked body with no Content-Length, and answers 413 past 10 MiB and its framing, aborting the upload (K8-41)', async () => {
    const CHUNK = 64 * 1_024;
    let produced = 0;
    const source = new ReadableStream<Uint8Array>({
      pull(controller) {
        // A sender that never stops: only the route's count ends it.
        produced += CHUNK;
        controller.enqueue(new Uint8Array(CHUNK));
        if (produced > UPLOAD_LIMIT_BYTES + 4 * 1_048_576) {
          controller.close();
        }
      },
    });
    let read = 0;
    let signal: AbortSignal | undefined;
    mocks.streamCaseAttachmentUpload.mockImplementationOnce(
      async (_id: string, sent: { body: ReadableStream<Uint8Array>; signal?: AbortSignal }) => {
        signal = sent.signal;
        const reader = sent.body.getReader();
        for (;;) {
          // As fetch does, a body that errors fails the upload.
          const { done, value } = await reader.read();
          if (done) {
            return new Response('{"data":{}}', { status: 201 });
          }
          read += value.byteLength;
        }
      },
    );

    const response = await POST(
      new Request(`http://dashboard.test/cases/${IDS.case}/attachments`, {
        method: 'POST',
        headers: {
          host: 'dashboard.test',
          origin: 'http://dashboard.test',
          'content-type': MULTIPART,
        },
        body: source,
        duplex: 'half',
      } as RequestInit),
      { params: Promise.resolve({ id: IDS.case }) },
    );

    expect(response.status).toBe(413);
    expect(await response.text()).toBe('The file is larger than 10 MiB.');
    expect(read).toBeLessThanOrEqual(UPLOAD_LIMIT_BYTES);
    expect(signal?.aborted).toBe(true);
  });

  it('answers 401 without a session', async () => {
    fakeRequest.cookies.clear();
    mocks.streamCaseAttachmentUpload.mockResolvedValueOnce(null);

    expect((await upload()).status).toBe(401);
  });

  it.each([
    [problem(413), 413, 'The file is larger than 10 MiB.'],
    [
      problem(422, 'attachment_type_refused'),
      422,
      'Only JPEG, PNG, WebP or PDF files are accepted.',
    ],
    [
      problem(422, 'case_attachment_limit'),
      422,
      'This case holds as many files as its template allows.',
    ],
    [problem(403), 403, 'Your role cannot add files to this case: it needs cases:write.'],
    [problem(410), 410, 'This case was redacted, so no file can be added.'],
    [problem(429), 429, 'Too many uploads: try again shortly.'],
    [problem(500), 502, 'The upload failed: try again.'],
  ])(
    'says what an API refusal means, never passing its problem on',
    async (upstream, status, words) => {
      mocks.streamCaseAttachmentUpload.mockResolvedValueOnce(upstream);

      const response = await upload();

      expect(response.status).toBe(status);
      expect(await response.text()).toBe(words);
    },
  );

  it('answers 502 when the API cannot be reached', async () => {
    mocks.streamCaseAttachmentUpload.mockRejectedValueOnce(new TypeError('fetch failed'));

    expect((await upload()).status).toBe(502);
  });
});
