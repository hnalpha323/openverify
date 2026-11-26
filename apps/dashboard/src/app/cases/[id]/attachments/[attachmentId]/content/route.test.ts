// @vitest-environment node
/**
 * C135.4: an attachment's rendition through the console's proxy, as a download under a name of the
 * console's own, never the original and never a storage URL. It mirrors the file rendition route; a
 * scan not done or not clean (409) and a rendition that could not be made (422) pass as a status.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../../../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../../../../testing/api-fixtures';
import { fakeRequest } from '../../../../../../testing/fake-request';
import { REVIEWER_IDS as IDS } from '../../../../../../testing/reviewer-fixtures';
import { GET } from './route';

const mocks = vi.hoisted(() => ({ fetchCaseAttachmentContent: vi.fn() }));

vi.mock('../../../../../../lib/api/case-attachments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../../lib/api/case-attachments')>()),
  fetchCaseAttachmentContent: mocks.fetchCaseAttachmentContent,
}));

vi.mock('next/headers', () =>
  import('../../../../../../testing/fake-request').then((m) => m.nextHeaders),
);

beforeEach(() => {
  mocks.fetchCaseAttachmentContent.mockReset();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
});

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 7, 8, 9]);

function get(caseId: string = IDS.case, attachmentId: string = IDS.attachment, search = '') {
  return GET(
    new Request(
      `http://dashboard.test/cases/${caseId}/attachments/${attachmentId}/content${search}`,
    ),
    { params: Promise.resolve({ id: caseId, attachmentId }) },
  );
}

describe('GET /cases/:id/attachments/:attachmentId/content', () => {
  it('streams the rendition as a download named by the console, never cached', async () => {
    mocks.fetchCaseAttachmentContent.mockResolvedValueOnce(
      new Response(JPEG, {
        status: 200,
        headers: {
          'content-type': 'image/jpeg',
          'content-disposition': 'attachment; filename="synthetic-original-name.jpg"',
        },
      }),
    );

    const response = await get(IDS.case, IDS.attachment, '?page=1');

    expect(mocks.fetchCaseAttachmentContent).toHaveBeenCalledExactlyOnceWith(
      IDS.case,
      IDS.attachment,
      1,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="case-attachment-${IDS.attachment}.jpg"`,
    );
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(JPEG);
  });

  it.each([
    ['a case', 'inq_01JE0000000000000000000001', IDS.attachment],
    ['an attachment', IDS.case, 'file_01JE0000000000000000000001'],
  ])('answers 404 for an id that is not %s, without calling the API', async (_name, caseId, id) => {
    expect((await get(caseId, id)).status).toBe(404);
    expect(mocks.fetchCaseAttachmentContent).not.toHaveBeenCalled();
  });

  it('answers 404 for a page the API never renders', async () => {
    expect((await get(IDS.case, IDS.attachment, '?page=21')).status).toBe(404);
    expect(mocks.fetchCaseAttachmentContent).not.toHaveBeenCalled();
  });

  it.each([
    [202, 202],
    [403, 403],
    [404, 404],
    // C135.5: a scan pending, infected or failed is never served.
    [409, 409],
    [422, 422],
    [500, 502],
  ])('passes an API %i on as %i, with no body', async (status, expected) => {
    mocks.fetchCaseAttachmentContent.mockResolvedValueOnce(
      new Response('{"detail":"synthetic"}', {
        status,
        headers: { 'content-type': 'application/problem+json', 'retry-after': '5' },
      }),
    );

    const response = await get();

    expect(response.status).toBe(expected);
    expect(await response.text()).toBe('');
  });

  it('answers 401 without a session, and 502 when the API cannot be reached', async () => {
    mocks.fetchCaseAttachmentContent.mockResolvedValueOnce(null);
    expect((await get()).status).toBe(401);

    mocks.fetchCaseAttachmentContent.mockRejectedValueOnce(new TypeError('fetch failed'));
    expect((await get()).status).toBe(502);
  });
});
