// @vitest-environment node
/** C135.3: the rendition read the file rendition route streams, as `fetchFileContent` reads. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDS, SESSION_TOKEN } from '../../testing/api-fixtures';
import { mockApi, type MockApi } from '../../testing/api-mock';
import { fakeRequest } from '../../testing/fake-request';
import { SESSION_COOKIE } from '../session-cookie';
import { fetchFileRendition } from './file-renditions';
import { markPeerAddressHeaderTrusted } from './peer-address';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

const MARK = Symbol.for('openverify.dashboard.peer-address-header');
let api: MockApi;

beforeEach(() => {
  api = mockApi();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  fakeRequest.headers.set('x-openverify-peer-ip', '198.51.100.7');
  markPeerAddressHeaderTrusted();
});

afterEach(() => {
  api.restore();
  Reflect.deleteProperty(globalThis, MARK);
});

describe('fetchFileRendition', () => {
  it('requests the rendition with the session and the BFF headers, and hands back the response', async () => {
    api.reply(202, { meta: { 'rendition-status': 'pending', 'retry-after-seconds': 5 } });

    const response = await fetchFileRendition(IDS.front);

    expect(response?.status).toBe(202);
    const request = api.last();
    expect(request.method).toBe('GET');
    expect(request.path).toBe(`/api/v1/dashboard/files/${IDS.front}/rendition`);
    expect(request.query.get('page')).toBeNull();
    expect(request.headers.get('authorization')).toBe(`Bearer ${SESSION_TOKEN}`);
    expect(request.headers.get('accept')).toBe('image/*');
    expect(request.headers.get('x-openverify-client-ip')).toBe('198.51.100.7');
  });

  it("asks for a PDF's page", async () => {
    api.reply(200, {});

    await fetchFileRendition(IDS.front, 2);

    expect(api.last().query.get('page')).toBe('2');
  });

  it('is null without a session, without calling the API', async () => {
    fakeRequest.cookies.clear();

    await expect(fetchFileRendition(IDS.front)).resolves.toBeNull();
    expect(api.requests).toHaveLength(0);
  });
});
