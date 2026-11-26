/**
 * C135.3 (decision 63, P38): an inquiry file's rendition, an image re-encoded without metadata, read
 * on the C21 BFF layer for the file rendition route (`app/files/[id]/rendition/route.ts`), as
 * `fetchFileContent` reads the original. The session token comes from the httpOnly cookie, and the
 * request carries the operator's address and the BFF token, so the API's `file.viewed` entry
 * records who looked and from where.
 */
import 'server-only';
import { apiBaseUrl } from '../config';
import { getSessionToken } from '../session';
import { getBffFetch } from './client';

/** A rendition is a JPEG or a PNG (`CASE_RENDITION_MEDIA_TYPES`), never the uploaded type. */
const RENDITION_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png']);
/**
 * API statuses passed on: no session, no `pii:view` (P38), a deleted or redacted source or a page
 * past the rendered ones, a redacted inquiry, a rendition vision could not make, and (for a case
 * attachment) a scan not done or not clean.
 */
const PASSED_ON: ReadonlySet<number> = new Set([401, 403, 404, 409, 410, 422]);
/** Same as the API (C4): ID images and selfies are never stored by browsers or proxies. */
export const NO_STORE = { 'cache-control': 'private, no-store' } as const;
/** The API asks again after 5 s; a console never waits less than 1 s or more than a minute. */
const RETRY_AFTER_DEFAULT = 5;
const RETRY_AFTER_MAX = 60;
/** The 1-based page of a PDF's rendition the API serves (`rendition-pages`, 20). */
const PAGE = /^(?:[1-9]|1[0-9]|20)$/;

export const emptyAnswer = (status: number, headers: Record<string, string> = {}): Response =>
  new Response(null, { status, headers: { ...NO_STORE, ...headers } });

/**
 * The page a console URL asks for: `undefined` when it names none, `null` for one the API never
 * renders (so the route answers 404 without asking).
 */
export function pageOf(url: string): number | undefined | null {
  const page = new URL(url).searchParams.get('page');
  if (page === null) {
    return undefined;
  }
  return PAGE.test(page) ? Number(page) : null;
}

/** The API's `Retry-After`, in whole seconds within 1 to 60, or 5 when it is not a number. */
function retryAfterOf(upstream: Response): string {
  const seconds = Number.parseInt(upstream.headers.get('retry-after') ?? '', 10);
  if (!Number.isFinite(seconds)) {
    return String(RETRY_AFTER_DEFAULT);
  }
  return String(Math.min(RETRY_AFTER_MAX, Math.max(1, seconds)));
}

/**
 * Reads an unwanted upstream body to the end, so the connection can be reused. It must not be
 * cancelled instead: Next.js dedupes GET fetches by tee()ing the response and keeping the other
 * branch, and cancelling one branch only settles once both are, so `await body.cancel()` would hang.
 */
async function drain(response: Response): Promise<void> {
  try {
    await response.arrayBuffer();
  } catch {
    // A broken upstream body changes nothing about the answer.
  }
}

/**
 * What the console answers for an API rendition read (C135.3, C135.4): a JPEG or PNG rendition
 * streamed on, never cached; a 202 with its `Retry-After` and no body while it is made; the API's
 * refusals as a bare status; 401 without a session; anything else 502. Neither the API's problem
 * document nor its filename is passed on: the console names nothing (C135.2).
 */
export async function renditionAnswer(
  upstream: Response | null,
  { download = false }: { readonly download?: string | false } = {},
): Promise<Response> {
  if (upstream === null) {
    return emptyAnswer(401);
  }
  if (upstream.status === 202) {
    await drain(upstream);
    return emptyAnswer(202, { 'retry-after': retryAfterOf(upstream) });
  }
  const contentType = upstream.headers.get('content-type') ?? '';
  if (upstream.status !== 200 || !RENDITION_TYPES.has(contentType)) {
    await drain(upstream);
    return emptyAnswer(PASSED_ON.has(upstream.status) ? upstream.status : 502);
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      ...NO_STORE,
      'content-type': contentType,
      'x-content-type-options': 'nosniff',
      ...(download === false
        ? {}
        : {
            'content-disposition': `attachment; filename="${download}.${contentType === 'image/png' ? 'png' : 'jpg'}"`,
          }),
    },
  });
}

/**
 * `GET /dashboard/files/:id/rendition`: the raw response, so the route handler can stream the image
 * on (200), or pass a 202 "still being made" on; `null` without a session.
 */
export async function fetchFileRendition(id: string, page?: number): Promise<Response | null> {
  const token = await getSessionToken();
  // eslint-disable-next-line security/detect-possible-timing-attacks -- a presence check against null or undefined, not a comparison of two secrets
  if (token === null) {
    return null;
  }
  const bffFetch = await getBffFetch();
  const query = page === undefined ? '' : `?page=${String(page)}`;
  return bffFetch(
    `${apiBaseUrl()}/api/v1/dashboard/files/${encodeURIComponent(id)}/rendition${query}`,
    { headers: { authorization: `Bearer ${token}`, accept: 'image/*' } },
  );
}
