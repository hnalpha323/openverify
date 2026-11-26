import { idSchema } from '@openverify/contracts';
import {
  UPLOAD_LIMIT_BYTES,
  streamCaseAttachmentUpload,
} from '../../../../lib/api/case-attachments';

const CASE_ID = idSchema('case');
/** As the file routes (C4): nothing about an upload is stored by browsers or proxies. */
const NO_STORE = { 'cache-control': 'private, no-store' } as const;

/** What each answer says; never the API's problem, which could echo what was sent. */
const WORDS: Readonly<Record<number, string>> = Object.freeze({
  201: 'The file was uploaded.',
  400: 'The upload could not be read: choose the file again.',
  401: 'Your session ended: sign in again to upload.',
  403: 'Your role cannot add files to this case: it needs cases:write.',
  404: 'This case was not found.',
  409: 'The case changed meanwhile: reload the page and try again.',
  410: 'This case was redacted, so no file can be added.',
  413: 'The file is larger than 10 MiB.',
  415: 'Only JPEG, PNG, WebP or PDF files are accepted.',
  422: 'The file was refused.',
  429: 'Too many uploads: try again shortly.',
  502: 'The upload failed: try again.',
});

/** The refusals the API names by code (C129.7), in words. */
const CODE_WORDS: Readonly<Record<string, string>> = Object.freeze({
  attachment_type_refused: WORDS[415] ?? '',
  case_attachment_limit: 'This case holds as many files as its template allows.',
  attachment_infected: 'The file was refused: the scanner found it infected.',
});

function answer(status: number, words?: string): Response {
  return new Response(words ?? WORDS[status] ?? WORDS[502], {
    status,
    headers: { ...NO_STORE, 'content-type': 'text/plain; charset=utf-8' },
  });
}

/**
 * Whether the post came from this dashboard (dashboard-graph amendment 3, as
 * `app/graph/[id]/export/route.ts`): a real `Origin` must name this host; `Origin: null`, which the
 * console's `no-referrer` policy makes browsers send, passes only with `Sec-Fetch-Site:
 * same-origin` or with that header absent. The session cookie is SameSite=Lax as well.
 */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (origin === null) {
    return true;
  }
  if (origin === 'null') {
    const site = request.headers.get('sec-fetch-site');
    return site === null || site === 'same-origin';
  }
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  try {
    return new URL(origin).host === (host ?? new URL(request.url).host);
  } catch {
    return false;
  }
}

/**
 * The body, counted as it streams (K8-41): a request sent without a `Content-Length` (chunked)
 * declares no size, so past `UPLOAD_LIMIT_BYTES` the stream errors and the upload is aborted, and the
 * route answers 413 rather than passing an unbounded body on to the API.
 */
function counted(body: ReadableStream<Uint8Array>, abort: AbortController) {
  let seen = 0;
  const state = { over: false };
  const stream = body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > UPLOAD_LIMIT_BYTES) {
          state.over = true;
          abort.abort();
          controller.error(new RangeError('The upload passed its limit.'));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
  return { stream, state };
}

/** The code of an API problem document, read from a small body; `undefined` for anything else. */
async function codeOf(response: Response): Promise<string | undefined> {
  try {
    const document = (await response.json()) as { code?: unknown };
    return typeof document.code === 'string' ? document.code : undefined;
  } catch {
    return undefined;
  }
}

/**
 * `POST /cases/:id/attachments` (C135.1, C142.7): the console's streaming upload. Left out of
 * `proxy.ts`'s matcher, it checks the origin and the session itself, refuses a body that is not
 * multipart or declares more than 10 MiB and its framing before reading any of it, and streams the
 * rest to the API unread but counted (a body with no length stops at the limit with 413), and the API
 * types, caps, scans and seals the file. A server action would have
 * buffered it and stopped at 1 MB. Its answers are a status and a sentence of ours.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!CASE_ID.safeParse(id).success) {
    return answer(404);
  }
  if (!sameOrigin(request)) {
    return answer(403, 'The upload must come from this dashboard.');
  }
  const contentType = request.headers.get('content-type') ?? '';
  if (!/^multipart\/form-data;\s*boundary=/i.test(contentType) || request.body === null) {
    return answer(415, 'The upload must be a form with one file.');
  }
  const length = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(length) && length > UPLOAD_LIMIT_BYTES) {
    return answer(413);
  }
  const abort = new AbortController();
  const body = counted(request.body, abort);
  let upstream: Response | null;
  try {
    upstream = await streamCaseAttachmentUpload(id, {
      body: body.stream,
      contentType,
      signal: abort.signal,
    });
  } catch {
    return answer(body.state.over ? 413 : 502);
  }
  if (body.state.over) {
    await upstream?.body?.cancel().catch(() => undefined);
    return answer(413);
  }
  if (upstream === null) {
    return answer(401);
  }
  if (upstream.status === 201) {
    await upstream.arrayBuffer().catch(() => undefined);
    return answer(201);
  }
  const code = await codeOf(upstream);
  const status = WORDS[upstream.status] === undefined ? 502 : upstream.status;
  return answer(status, code === undefined ? undefined : CODE_WORDS[code]);
}
