// @vitest-environment node
/** C135.1, C135.4: the case attachment calls on the BFF layer, with the session and BFF headers. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { mockApi, type MockApi } from '../../testing/api-mock';
import { fakeRequest } from '../../testing/fake-request';
import { REVIEWER_IDS as IDS } from '../../testing/reviewer-fixtures';
import { SESSION_COOKIE } from '../session-cookie';
import { fetchCaseAttachmentContent, streamCaseAttachmentUpload } from './case-attachments';
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

const stream = (text: string) => new Response(text).body ?? new ReadableStream();

describe('streamCaseAttachmentUpload', () => {
  it('posts the multipart stream as it came, with the session, the BFF headers and an idempotency key', async () => {
    api.reply(201, { data: {} });

    const response = await streamCaseAttachmentUpload(IDS.case, {
      body: stream('--b\r\n'),
      contentType: 'multipart/form-data; boundary=b',
    });

    expect(response?.status).toBe(201);
    const request = api.last();
    expect(request.method).toBe('POST');
    expect(request.path).toBe(`/api/v1/cases/${IDS.case}/attachments`);
    expect(request.headers.get('content-type')).toBe('multipart/form-data; boundary=b');
    expect(request.headers.get('authorization')).toBe(`Bearer ${SESSION_TOKEN}`);
    expect(request.headers.get('x-openverify-client-ip')).toBe('198.51.100.7');
    expect(request.headers.get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('aborts the upload when the route aborts it, as well as on its timeout (K8-41)', async () => {
    api.reply(201, { data: {} });
    const abort = new AbortController();

    await streamCaseAttachmentUpload(IDS.case, {
      body: stream('--b\r\n'),
      contentType: 'multipart/form-data; boundary=b',
      signal: abort.signal,
    });

    const init = vi.mocked(globalThis.fetch).mock.calls[0]?.[1];
    expect(init?.signal?.aborted).toBe(false);
    abort.abort();
    expect(init?.signal?.aborted).toBe(true);
  });

  it('is null without a session, without calling the API', async () => {
    fakeRequest.cookies.clear();

    await expect(
      streamCaseAttachmentUpload(IDS.case, {
        body: stream(''),
        contentType: 'multipart/form-data',
      }),
    ).resolves.toBeNull();
    expect(api.requests).toHaveLength(0);
  });
});

describe('fetchCaseAttachmentContent', () => {
  it("reads the rendition's page with the session", async () => {
    api.reply(200, {});

    await fetchCaseAttachmentContent(IDS.case, IDS.attachment, 2);

    const request = api.last();
    expect(request.path).toBe(`/api/v1/cases/${IDS.case}/attachments/${IDS.attachment}/content`);
    expect(request.query.get('page')).toBe('2');
    expect(request.headers.get('authorization')).toBe(`Bearer ${SESSION_TOKEN}`);
  });

  it('is null without a session', async () => {
    fakeRequest.cookies.clear();

    await expect(fetchCaseAttachmentContent(IDS.case, IDS.attachment)).resolves.toBeNull();
  });
});
