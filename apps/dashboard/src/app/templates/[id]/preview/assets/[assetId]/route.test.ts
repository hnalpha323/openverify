// @vitest-environment node
/**
 * C156.2, C160.6 (review P17): the preview's theme assets, read by the console's server side with
 * the session (the preview frame has `connect-src 'none'`), so the page can post the bytes to it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { previewAssetUrl } from '../../../../../../components/flow-preview/asset-url';
import { SESSION_COOKIE } from '../../../../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../../../../testing/api-fixtures';
import { mockApi, type MockApi } from '../../../../../../testing/api-mock';
import { fakeRequest } from '../../../../../../testing/fake-request';
import { PREVIEW_IDS, assetContentPath } from '../../../../../../testing/routes/preview';
import { GET } from './route';

vi.mock('next/headers', () =>
  import('../../../../../../testing/fake-request').then((m) => m.nextHeaders),
);

let api: MockApi;

beforeEach(() => {
  api = mockApi();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
});

afterEach(() => {
  api.restore();
});

function get(id: string, assetId: string) {
  return GET(new Request(`http://dashboard.test${previewAssetUrl(id)(assetId)}`), {
    params: Promise.resolve({ id, assetId }),
  });
}

describe('the preview’s theme asset route', () => {
  it('lives under the template’s preview', () => {
    expect(previewAssetUrl(PREVIEW_IDS.template)(PREVIEW_IDS.logo)).toBe(
      `/templates/${PREVIEW_IDS.template}/preview/assets/${PREVIEW_IDS.logo}`,
    );
  });

  it('passes a logo on from the API, never cached', async () => {
    api.replyTo(`GET ${assetContentPath(PREVIEW_IDS.logo)}`, 200, undefined, {
      'content-type': 'image/png',
    });

    const answer = await get(PREVIEW_IDS.template, PREVIEW_IDS.logo);

    expect(answer.status).toBe(200);
    expect(answer.headers.get('content-type')).toBe('image/png');
    expect(answer.headers.get('cache-control')).toBe('private, no-store');
    expect(api.last().headers.get('authorization')).toBe(`Bearer ${SESSION_TOKEN}`);
  });

  it('answers 404 for a malformed template or asset id, calling nothing', async () => {
    expect((await get('itmpl_../x', PREVIEW_IDS.logo)).status).toBe(404);
    expect((await get(PREVIEW_IDS.template, 'file_01JB0000000000000000000001')).status).toBe(404);
    expect(api.requests).toEqual([]);
  });

  it('answers 401 without a session, and the API’s 403 as a bare status', async () => {
    api.replyProblemTo(`GET ${assetContentPath(PREVIEW_IDS.font)}`, 403, 'forbidden');
    expect((await get(PREVIEW_IDS.template, PREVIEW_IDS.font)).status).toBe(403);

    fakeRequest.cookies.clear();
    expect((await get(PREVIEW_IDS.template, PREVIEW_IDS.font)).status).toBe(401);
  });

  it('answers 502 when the API cannot be reached', async () => {
    api.fail();

    expect((await get(PREVIEW_IDS.template, PREVIEW_IDS.logo)).status).toBe(502);
  });
});
