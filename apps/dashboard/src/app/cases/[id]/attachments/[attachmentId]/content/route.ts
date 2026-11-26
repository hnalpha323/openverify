import { idSchema } from '@openverify/contracts';
import { fetchCaseAttachmentContent } from '../../../../../../lib/api/case-attachments';
import { emptyAnswer, pageOf, renditionAnswer } from '../../../../../../lib/api/file-renditions';

const CASE_ID = idSchema('case');
const ATTACHMENT_ID = idSchema('catt');

/**
 * `GET /cases/:id/attachments/:attachmentId/content?page` (C135.4): an attachment's rendition page,
 * an image re-encoded without metadata, streamed from the API as a download named by the console
 * (`case-attachment-<id>.<ext>`), never cached; never the original, and never a storage URL (stored
 * objects are ciphertext). The API checks `cases:read` and `pii:view`, serves only what its scan
 * allows (409 otherwise, C135.5) and audits each view. Its errors become a bare status.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
): Promise<Response> {
  const { id, attachmentId } = await params;
  const page = pageOf(request.url);
  if (
    !CASE_ID.safeParse(id).success ||
    !ATTACHMENT_ID.safeParse(attachmentId).success ||
    page === null
  ) {
    return emptyAnswer(404);
  }
  try {
    return await renditionAnswer(await fetchCaseAttachmentContent(id, attachmentId, page), {
      download: `case-attachment-${attachmentId}`,
    });
  } catch {
    return emptyAnswer(502);
  }
}
