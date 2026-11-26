import { reportBulkJobDocumentSchema } from '@openverify/contracts';
import { BULK_UPLOAD_LIMIT_BYTES, streamReportBulkUpload } from '../../../../lib/api/reports-bulk';
import { ANALYTICS_COPY } from '../../../../lib/copy/analytics';

/** As the file routes (C4): nothing about an upload is stored by browsers or proxies. */
const NO_STORE = { 'cache-control': 'private, no-store' } as const;
const WORDS = ANALYTICS_COPY.bulk.answers;

/** What each status says; never the API's problem, which could echo what was sent. */
const STATUS_WORDS: Readonly<Record<number, string>> = Object.freeze({
  202: WORDS.accepted,
  400: WORDS.unreadable,
  401: WORDS.signedOut,
  403: WORDS.forbidden,
  404: WORDS.notFound,
  413: WORDS.tooLarge,
  415: WORDS.notCsv,
  422: WORDS.refused,
  429: WORDS.tooMany,
  502: WORDS.failed,
});

/** The refusals the API names by code, in words. */
const CODE_WORDS: Readonly<Record<string, string>> = Object.freeze({
  report_template_not_published: WORDS.notPublished,
});

function answer(status: number, words?: string, jobId?: string): Response {
  return Response.json(
    {
      message: words ?? STATUS_WORDS[status] ?? STATUS_WORDS[502],
      ...(jobId === undefined ? {} : { 'job-id': jobId }),
    },
    { status, headers: NO_STORE },
  );
}

/** Whether the post came from this dashboard (as the case attachment upload checks it). */
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

/** The body counted as it streams: past the limit the upload is aborted and answered 413. */
function counted(body: ReadableStream<Uint8Array>, abort: AbortController) {
  let seen = 0;
  const state = { over: false };
  const stream = body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > BULK_UPLOAD_LIMIT_BYTES) {
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

async function codeOf(response: Response): Promise<string | undefined> {
  try {
    const document = (await response.json()) as { code?: unknown };
    return typeof document.code === 'string' ? document.code : undefined;
  } catch {
    return undefined;
  }
}

/**
 * `POST /exports/bulk-reports/upload` (C166.5): the console's streaming upload of a bulk report CSV.
 * A server action would buffer it and stop at 1 MB; this route checks the origin and the session
 * itself, refuses a body that is not multipart or declares more than 2 MiB and its framing, and
 * streams the rest to `POST /reports/bulk` unread but counted (the CSV holds third-party personal
 * data, so nothing here reads, logs or keeps it). Its answers are a status, a sentence of ours and,
 * once accepted, the job's id.
 */
export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) {
    return answer(403, WORDS.otherOrigin);
  }
  const contentType = request.headers.get('content-type') ?? '';
  if (!/^multipart\/form-data;\s*boundary=/i.test(contentType) || request.body === null) {
    return answer(415, WORDS.notForm);
  }
  const length = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(length) && length > BULK_UPLOAD_LIMIT_BYTES) {
    return answer(413);
  }
  const abort = new AbortController();
  const body = counted(request.body, abort);
  let upstream: Response | null;
  try {
    upstream = await streamReportBulkUpload({
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
  if (upstream.status === 202) {
    const parsed = reportBulkJobDocumentSchema.safeParse(await upstream.json().catch(() => null));
    return parsed.success ? answer(202, undefined, parsed.data.data.id) : answer(502);
  }
  const code = await codeOf(upstream);
  const status = STATUS_WORDS[upstream.status] === undefined ? 502 : upstream.status;
  return answer(status, code === undefined ? undefined : CODE_WORDS[code]);
}
