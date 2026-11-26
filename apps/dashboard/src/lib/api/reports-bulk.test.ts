// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { BFF_TOKEN, mockApi, type MockApi } from '../../testing/api-mock';
import { fakeRequest } from '../../testing/fake-request';
import { ANALYTICS_IDS, reportBulkJob } from '../../testing/routes/analytics';
import { getReportBulkJob, streamReportBulkUpload } from './reports-bulk';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

let api: MockApi;

beforeEach(() => {
  fakeRequest.reset();
  api = mockApi();
});

afterEach(() => {
  api.restore();
});

const BOUNDARY = 'multipart/form-data; boundary=synthetic-boundary';
const body = () => new Blob(['--synthetic-boundary--\r\n']).stream();

describe('bulk report creation (C166.5)', () => {
  it('streams the browser’s multipart body to the API with the session and BFF headers', async () => {
    fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
    api.replyTo('POST /reports/bulk', 202, {
      data: reportBulkJob({ status: 'pending', rows: [] }),
    });

    const response = await streamReportBulkUpload({ body: body(), contentType: BOUNDARY });

    expect(response?.status).toBe(202);
    const request = api.last();
    expect(request.headers.get('authorization')).toBe(`Bearer ${SESSION_TOKEN}`);
    expect(request.headers.get('content-type')).toBe(BOUNDARY);
    expect(request.headers.get('x-openverify-bff-token')).toBe(BFF_TOKEN);
    expect(request.headers.get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('sends nothing without a session', async () => {
    await expect(
      streamReportBulkUpload({ body: body(), contentType: BOUNDARY }),
    ).resolves.toBeNull();
    expect(api.requests).toEqual([]);
  });

  it('reads a job with every row’s outcome', async () => {
    fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
    api.replyTo(`GET /reports/bulk/${ANALYTICS_IDS.bulkJob}`, 200, { data: reportBulkJob() });

    const job = await getReportBulkJob(ANALYTICS_IDS.bulkJob);

    expect(job.data.attributes.rows.map((row) => row.outcome)).toEqual(['created', 'failed']);
  });
});
