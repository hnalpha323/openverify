// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../../testing/api-fixtures';
import { mockApi, type MockApi } from '../../../../testing/api-mock';
import { fakeRequest } from '../../../../testing/fake-request';
import { ANALYTICS_IDS, reportBulkJob } from '../../../../testing/routes/analytics';
import { POST } from './route';

vi.mock('next/headers', () =>
  import('../../../../testing/fake-request').then((m) => m.nextHeaders),
);

let api: MockApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = mockApi();
});

afterEach(() => {
  api.restore();
});

const URL = 'http://dashboard.test/exports/bulk-reports/upload';
const MULTIPART = 'multipart/form-data; boundary=synthetic-boundary';
const CSV =
  '--synthetic-boundary\r\ncontent-disposition: form-data; name="file"\r\n\r\nname-first\r\n--synthetic-boundary--\r\n';

const upload = (headers: Record<string, string> = {}, body: BodyInit | null = CSV) =>
  POST(
    new Request(URL, {
      method: 'POST',
      headers: { host: 'dashboard.test', 'content-type': MULTIPART, ...headers },
      body,
      ...(body === null ? {} : { duplex: 'half' }),
    }),
  );

const read = async (response: Response) => (await response.json()) as Record<string, unknown>;

describe('the bulk report upload route (C166.5)', () => {
  it('streams the form to the API and answers the job’s id, never the file', async () => {
    api.replyTo('POST /reports/bulk', 202, {
      data: reportBulkJob({ status: 'pending', rows: [] }),
    });

    const response = await upload({ origin: 'http://dashboard.test' });

    expect(response.status).toBe(202);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await read(response)).toEqual({
      message: 'The file was accepted: its reports are being created.',
      'job-id': ANALYTICS_IDS.bulkJob,
    });
    expect(api.last().headers.get('content-type')).toBe(MULTIPART);
  });

  it('refuses another origin, a body that is not a form, and a declared size past 2 MiB', async () => {
    expect((await upload({ origin: 'https://elsewhere.example' })).status).toBe(403);
    expect((await upload({ 'content-type': 'text/csv' })).status).toBe(415);
    const large = await upload({ 'content-length': String(3 * 1_048_576) });
    expect(large.status).toBe(413);
    expect(await read(large)).toEqual({ message: 'The file is larger than 2 MiB.' });
    expect(api.requests).toEqual([]);
  });

  it('stops a body without a length at the limit', async () => {
    // A fetch that reads the body as it is sent, as Node's does.
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      await new Response(init.body).arrayBuffer();
      return new Response(null, { status: 202 });
    });
    const big = new Uint8Array(2_097_152 + 64 * 1024 + 10);

    expect((await upload({}, new Blob([big]).stream())).status).toBe(413);
  });

  it('answers 401 without a session and says each refusal in its own words', async () => {
    fakeRequest.reset();
    expect((await upload()).status).toBe(401);

    fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
    api.replyProblemTo('POST /reports/bulk', 422, undefined, {
      code: 'report_template_not_published',
    });
    const refused = await upload();
    expect(refused.status).toBe(422);
    expect(await read(refused)).toEqual({
      message: 'This report template has no published version yet.',
    });

    api.replyProblemTo('POST /reports/bulk', 429, 'rate-limited');
    expect(await read(await upload())).toEqual({
      message: 'Too many uploads: five an hour per environment. Try again later.',
    });

    api.replyProblemTo('POST /reports/bulk', 500);
    expect((await upload()).status).toBe(502);
  });
});
