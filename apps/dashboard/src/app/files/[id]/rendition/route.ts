import {
  emptyAnswer,
  fetchFileRendition,
  pageOf,
  renditionAnswer,
} from '../../../../lib/api/file-renditions';

/** A C1 file ID: `file_` and a ULID. */
const FILE_ID = /^file_[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

/**
 * `GET /files/:id/rendition` (C135.3, decision 63, P38): an inquiry image as the API's rendition,
 * re-encoded without metadata, streamed on with the session cookie so `<img>` tags work without the
 * token ever reaching client JavaScript. It mirrors `GET /files/:id/content`: only a JPEG or PNG
 * rendition passes, never cached; the API's errors become a bare status; `?page` names a PDF's
 * page (1 to 20) and anything else the URL holds, such as the image's retry counter, is ignored.
 * While the rendition is made the API answers 202 with `Retry-After`, which passes on with no body,
 * so the image shows "preparing" and asks again (`RenditionImage`). The API checks
 * `inquiries:read` and `pii:view` and audits each view as `file.viewed`.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const page = pageOf(request.url);
  if (!FILE_ID.test(id) || page === null) {
    return emptyAnswer(404);
  }
  try {
    return await renditionAnswer(await fetchFileRendition(id, page));
  } catch {
    return emptyAnswer(502);
  }
}
