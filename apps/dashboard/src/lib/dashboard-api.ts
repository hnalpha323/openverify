/**
 * The Phase 1 file read (contract C4) the file content route streams, on the C21 BFF layer: the
 * session token comes from the httpOnly cookie, and the request carries the operator's address
 * and the BFF token. The inquiry pages read through `lib/api/inquiries.ts`.
 */
import 'server-only';
import { apiBaseUrl } from './config';
import { getBffFetch } from './api/client';
import { getSessionToken } from './session';

/**
 * `GET /dashboard/files/:id/content`: the raw response, so the route handler can stream the
 * image on; `null` without a session.
 */
export async function fetchFileContent(id: string): Promise<Response | null> {
  const token = await getSessionToken();
  // eslint-disable-next-line security/detect-possible-timing-attacks -- a presence check against null or undefined, not a comparison of two secrets
  if (token === null) {
    return null;
  }
  const bffFetch = await getBffFetch();
  return bffFetch(`${apiBaseUrl()}/api/v1/dashboard/files/${encodeURIComponent(id)}/content`, {
    headers: { authorization: `Bearer ${token}`, accept: 'image/*' },
  });
}
