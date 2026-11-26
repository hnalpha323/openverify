import { GRAPH_LIMITS, idSchema } from '@openverify/contracts';
import { OpenVerifyApiError } from '@openverify/node';
import {
  exportGraphCsv,
  type GraphExport,
  type GraphExportSelection,
} from '../../../../lib/api/graph';

const QUERY_ID = idSchema('grphq');
const ACCOUNT_ID = idSchema('acc');
/** As the file route (C4): an export holds personal data, never stored by browsers or proxies. */
const NO_STORE = { 'cache-control': 'private, no-store' } as const;

/** What each refusal says; never the API's problem, which could echo what was sent. */
const WORDS: Readonly<Record<number, string>> = Object.freeze({
  400: 'The export could not be read: choose the accounts again.',
  401: 'Your session ended: sign in again to export.',
  403: 'Your role cannot export this result: it needs accounts:read and pii:view beside graph:read.',
  404: 'This graph query was not found.',
  409: 'The export could not run now: try again.',
  410: 'This graph query was redacted, so nothing is left to export.',
  422: 'The export was refused: choose at most 500 accounts of the result.',
  429: 'Too many requests: try the export again shortly.',
  502: 'The export could not be fetched: try again.',
});

function answer(status: number): Response {
  return new Response(WORDS[status] ?? WORDS[502], {
    status,
    headers: { ...NO_STORE, 'content-type': 'text/plain; charset=utf-8' },
  });
}

/**
 * Whether the post came from this dashboard. The session cookie is SameSite=Lax, so a cross-site
 * post carries none; the origin is checked too, as Next.js does for server actions. Under the
 * console's `Referrer-Policy: no-referrer` a browser's form post says `Origin: null`, from this
 * dashboard as from anywhere else (Fetch standard, "append a request `Origin` header"), so
 * `Sec-Fetch-Site` answers then. Browsers send that only to a trustworthy URL, which leaves the
 * cookie as the guard on plain HTTP; `same-site` is refused, because a sibling site's post carries
 * a Lax cookie.
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

/** The accounts posted, or `null` for a selection the API would refuse. */
async function selectionOf(request: Request): Promise<GraphExportSelection | null> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return null;
  }
  if (form.get('all') === 'true') {
    return { all: true };
  }
  const ids = form.getAll('account-id').filter((id): id is string => typeof id === 'string');
  const valid =
    ids.length > 0 &&
    ids.length <= GRAPH_LIMITS.bulkAccounts &&
    new Set(ids).size === ids.length &&
    ids.every((id) => ACCOUNT_ID.safeParse(id).success);
  return valid ? { 'account-ids': ids } : null;
}

/**
 * `POST /graph/:id/export` (C103.2): the selected accounts of a stored graph result as CSV, passed
 * on as the API wrote it (already neutralised, C100.6; never re-parsed or rewritten), as a download
 * that is never stored. The route keeps its own origin, selection and session checks; the API
 * checks `graph:read`, `accounts:read` and `pii:view` and audits the export. Its errors are reduced
 * to a status and a sentence of ours.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!QUERY_ID.safeParse(id).success) {
    return answer(404);
  }
  if (!sameOrigin(request)) {
    return answer(403);
  }
  const selection = await selectionOf(request);
  if (selection === null) {
    return answer(400);
  }
  let exported: GraphExport | null;
  try {
    exported = await exportGraphCsv(id, selection);
  } catch (error) {
    return answer(
      error instanceof OpenVerifyApiError && WORDS[error.status] !== undefined ? error.status : 502,
    );
  }
  if (exported === null) {
    return answer(401);
  }
  if (!/^text\/csv\b/i.test(exported.contentType)) {
    return answer(502);
  }
  return new Response(exported.csv, {
    status: 200,
    headers: {
      ...NO_STORE,
      'content-type': exported.contentType,
      'content-disposition': `attachment; filename="graph-query-${id}.csv"`,
      'x-content-type-options': 'nosniff',
    },
  });
}
