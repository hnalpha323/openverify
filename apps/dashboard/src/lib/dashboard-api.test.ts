// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDS, SESSION_TOKEN } from '../testing/api-fixtures';
import { mockApi, type MockApi } from '../testing/api-mock';
import { fakeRequest } from '../testing/fake-request';
import { markPeerAddressHeaderTrusted } from './api/peer-address';
import { fetchFileContent } from './dashboard-api';
import { SESSION_COOKIE } from './session-cookie';

vi.mock('next/headers', () => import('../testing/fake-request').then((m) => m.nextHeaders));

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

describe('fetchFileContent', () => {
  it('requests the decrypted image with the session and hands back the response', async () => {
    api.reply(200, {});

    const response = await fetchFileContent(IDS.front);

    expect(response?.status).toBe(200);
    const request = api.last();
    expect(request.path).toBe(`/api/v1/dashboard/files/${IDS.front}/content`);
    expect(request.headers.get('authorization')).toBe(`Bearer ${SESSION_TOKEN}`);
    expect(request.headers.get('accept')).toBe('image/*');
    expect(request.headers.get('x-openverify-client-ip')).toBe('198.51.100.7');
  });

  it('is null without a session, without calling the API', async () => {
    fakeRequest.cookies.clear();

    await expect(fetchFileContent(IDS.front)).resolves.toBeNull();
    expect(api.requests).toHaveLength(0);
  });
});
