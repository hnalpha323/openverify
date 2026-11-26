// @vitest-environment node
import { OpenVerifyApiError } from '@openverify/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { mockApi, type MockApi } from '../../testing/api-mock';
import { fakeRequest } from '../../testing/fake-request';
import { ANALYTICS_IDS, exportResource } from '../../testing/routes/analytics';
import { createExport, downloadExport, getExport, listExports } from './exports';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

let api: MockApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = mockApi();
});

afterEach(() => {
  api.restore();
});

describe('the exports API (C166)', () => {
  it('lists one page of the caller’s own exports, after a cursor', async () => {
    api.replyTo('GET /exports', 200, { data: [exportResource()], links: { next: null } });

    const page = await listExports(ANALYTICS_IDS.otherExport);

    expect(page.data[0]?.id).toBe(ANALYTICS_IDS.export);
    expect(Object.fromEntries(api.last().query)).toEqual({
      'page[after]': ANALYTICS_IDS.otherExport,
      'page[size]': '25',
    });
  });

  it('reads one export', async () => {
    api.replyTo(`GET /exports/${ANALYTICS_IDS.export}`, 200, { data: exportResource() });

    await expect(getExport(ANALYTICS_IDS.export)).resolves.toMatchObject({
      data: { id: ANALYTICS_IDS.export },
    });
  });

  it('asks for an export with the filter and the personal-data choice as attributes', async () => {
    api.replyTo('POST /exports', 202, { data: exportResource({ status: 'pending' }) });

    const answer = await createExport({
      'object-type': 'inquiries',
      format: 'csv',
      filter: { 'filter[status]': 'failed' },
      'include-personal-data': false,
    });

    expect(answer.data.attributes.status).toBe('pending');
    expect(api.last().body).toEqual({
      data: {
        type: 'export',
        attributes: {
          'object-type': 'inquiries',
          format: 'csv',
          filter: { 'filter[status]': 'failed' },
          'include-personal-data': false,
        },
      },
    });
  });

  it('downloads the file with the session, and passes a refusal on', async () => {
    api.replyTo(`GET /exports/${ANALYTICS_IDS.export}/download`, 200, 'id,status\n');
    const file = await downloadExport(ANALYTICS_IDS.export);
    expect(new TextDecoder().decode(file.bytes)).toContain('id,status');

    api.replyProblemTo(`GET /exports/${ANALYTICS_IDS.export}/download`, 410);
    await expect(downloadExport(ANALYTICS_IDS.export)).rejects.toBeInstanceOf(OpenVerifyApiError);
  });
});
