/**
 * C142.6 (rule 9): what the case page sends to the browser for a principal without `pii:view`. The
 * API masks every field value, comment's words, attachment filename and prefilled parameter for such
 * a principal; the console renders what it returned and never unmasks on its own, so the RSC payload
 * holds none of them, and no route to an image (no rendition, no attachment download), so no image
 * byte can be fetched from what it sent. With `pii:view` the same values do reach it, which shows the
 * check looks where they would be.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../testing/api-routes';
import { fakeRequest } from '../../../testing/fake-request';
import {
  ATTACHMENT_NAME,
  COMMENT_TEXT,
  FIELD_VALUE,
  NOW,
  PREFILLED_VALUE,
  REVIEWER_IDS as IDS,
  availableActions,
  comment,
  maskedCaseResource,
} from '../../../testing/reviewer-fixtures';
import { rscPayloadOf } from '../../../testing/rsc-payload';
import {
  CASE_PATH,
  CASE_REVIEWER,
  serveCase,
  serveHeldObjects,
  serveModules,
} from '../../../testing/routes/reviewer';
import { selfieInquiryDocument } from '../../../testing/selfie-fixtures';
import CasePage from './page';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let api: RouteApi;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
});

afterEach(() => {
  api.restore();
  vi.useRealTimers();
});

const PERSONAL = [FIELD_VALUE, COMMENT_TEXT, ATTACHMENT_NAME, PREFILLED_VALUE];
/** A route the browser could fetch image bytes from. */
const IMAGE_ROUTE =
  /\/files\/file_[0-9A-Z]{26}\/(?:rendition|content)|\/attachments\/catt_[0-9A-Z]{26}\/content/;

async function payload(): Promise<string> {
  return rscPayloadOf(
    await CasePage({
      params: Promise.resolve({ id: IDS.case }),
      searchParams: Promise.resolve({}),
    }),
  );
}

describe('the case page’s RSC payload (C142.6)', () => {
  it('holds no field value, comment text, filename, prefilled value or image route without pii:view', async () => {
    api.me({ permissions: CASE_REVIEWER.filter((permission) => permission !== 'pii:view') });
    serveCase(api, { resource: maskedCaseResource(), comments: [comment({ message: null })] });
    api.on('GET', `${CASE_PATH}/available-actions`, 200, availableActions(null));
    serveHeldObjects(api);
    serveModules(api);
    api.on('GET', `/dashboard/inquiries/${IDS.inquiry}`, 200, selfieInquiryDocument());

    const text = await payload();

    for (const value of PERSONAL) {
      expect(text).not.toContain(value);
    }
    expect(text).not.toMatch(IMAGE_ROUTE);
  });

  it('holds them with pii:view, so the check above looks where they would be', async () => {
    api.me({ permissions: CASE_REVIEWER });
    serveCase(api);
    serveHeldObjects(api);
    serveModules(api);
    api.on('GET', `/dashboard/inquiries/${IDS.inquiry}`, 200, selfieInquiryDocument());

    const text = await payload();

    for (const value of PERSONAL) {
      expect(text).toContain(value);
    }
    expect(text).toMatch(IMAGE_ROUTE);
  });
});
