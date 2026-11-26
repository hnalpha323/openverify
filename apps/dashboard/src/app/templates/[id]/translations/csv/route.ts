import { TRANSLATIONS_CSV_LIMITS, idSchema } from '@openverify/contracts';
import {
  csvProblemsOf,
  fetchTranslationsCsv,
  uploadTranslationsCsv,
} from '../../../../../lib/api/translations';

const TEMPLATE_ID = idSchema('itmpl');
/** Nothing about a transfer is stored by browsers or proxies. */
const NO_STORE = { 'cache-control': 'private, no-store' } as const;
/** API statuses passed on as they are. */
const PASSED_ON: ReadonlySet<number> = new Set([400, 401, 403, 404, 409, 413, 415, 429]);

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...NO_STORE, 'content-type': 'application/json' },
  });

/**
 * Whether the post came from this console (as `app/cases/[id]/attachments/route.ts`): a real
 * `Origin` must name this host; `Origin: null`, which the console's `no-referrer` policy makes
 * browsers send, passes only with `Sec-Fetch-Site: same-origin` or with that header absent.
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
 * `GET /templates/:id/translations/csv` (C162.7): the API's `translations.csv`, written by its
 * formula-neutralising writer, passed on as a download that is never stored. A failure is a bare
 * status: the API's problem is not passed on.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!TEMPLATE_ID.safeParse(id).success) {
    return new Response(null, { status: 404, headers: NO_STORE });
  }
  const upstream = await fetchTranslationsCsv(id);
  if (upstream === null) {
    return new Response(null, { status: 401, headers: NO_STORE });
  }
  if (upstream.status !== 200) {
    await upstream.body?.cancel().catch(() => undefined);
    const status = PASSED_ON.has(upstream.status) ? upstream.status : 502;
    return new Response(null, { status, headers: NO_STORE });
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      ...NO_STORE,
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="translations-${id}.csv"`,
      'x-content-type-options': 'nosniff',
    },
  });
}

/**
 * `POST /templates/:id/translations/csv` (C162.7): the file's bytes (at most 2 MiB) imported into
 * the draft through the API's CSV route; never published. Answers JSON: `{ imported }` with the
 * number of rows the draft now holds, `{ problems }` by row and column (never a value) for a
 * refused file, or `{}` with the API's status.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!TEMPLATE_ID.safeParse(id).success) {
    return json(404, {});
  }
  if (!sameOrigin(request)) {
    return json(403, {});
  }
  const length = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(length) && length > TRANSLATIONS_CSV_LIMITS.bytes) {
    return json(413, {});
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > TRANSLATIONS_CSV_LIMITS.bytes) {
    return json(413, {});
  }
  let upstream: Response | null;
  try {
    upstream = await uploadTranslationsCsv(id, bytes);
  } catch {
    return json(502, {});
  }
  if (upstream === null) {
    return json(401, {});
  }
  let answer: unknown;
  try {
    answer = await upstream.json();
  } catch {
    answer = null;
  }
  if (upstream.status === 200) {
    const rows = (answer as { data?: { attributes?: { translations?: unknown } } } | null)?.data
      ?.attributes?.translations;
    return json(200, { imported: Array.isArray(rows) ? rows.length : 0 });
  }
  if (upstream.status === 422) {
    return json(422, { problems: csvProblemsOf(answer) });
  }
  return json(PASSED_ON.has(upstream.status) ? upstream.status : 502, {});
}
