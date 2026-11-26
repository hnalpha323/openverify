// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  API_KEY_ID,
  AUDIT_IDS,
  INQUIRY_ID,
  USER_IDS,
  auditLog,
  listOf,
} from '../../components/operators/test-fixtures';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { mockApi, type MockApi } from '../../testing/api-mock';
import { fakeRequest } from '../../testing/fake-request';
import { SESSION_COOKIE } from '../session-cookie';
import { getAuditLog, listAuditLogs } from './audit-logs';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

let api: MockApi;

beforeEach(() => {
  api = mockApi();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
});

afterEach(() => {
  api.restore();
});

describe('the audit log API (C15)', () => {
  it("lists the session environment's entries, one page at a time", async () => {
    api.reply(200, listOf([auditLog()]));

    const page = await listAuditLogs({});

    expect(page.data).toEqual([auditLog()]);
    expect(api.last()).toMatchObject({ method: 'GET', path: '/api/v1/dashboard/audit-logs' });
    expect(Object.fromEntries(api.last().query)).toEqual({ 'page[size]': '25' });
  });

  it('sends every filter the API supports, and the cursor', async () => {
    api.reply(200, listOf([]));

    await listAuditLogs({
      action: 'inquiry.approved,user.invited',
      actorId: `${USER_IDS.admin},${API_KEY_ID}`,
      resourceType: 'inquiry',
      resourceId: INQUIRY_ID,
      createdAtStart: '2026-10-01T00:00:00.000Z',
      createdAtEnd: '2026-10-21T00:00:00.000Z',
      after: AUDIT_IDS.second,
    });

    expect(Object.fromEntries(api.last().query)).toEqual({
      'filter[action]': 'inquiry.approved,user.invited',
      'filter[actor-id]': `${USER_IDS.admin},${API_KEY_ID}`,
      'filter[resource-type]': 'inquiry',
      'filter[resource-id]': INQUIRY_ID,
      'filter[created-at-start]': '2026-10-01T00:00:00.000Z',
      'filter[created-at-end]': '2026-10-21T00:00:00.000Z',
      'page[after]': AUDIT_IDS.second,
      'page[size]': '25',
    });
  });

  it('reads one entry', async () => {
    api.reply(200, { data: auditLog({ id: AUDIT_IDS.second }) });

    await expect(getAuditLog(AUDIT_IDS.second)).resolves.toEqual(
      auditLog({ id: AUDIT_IDS.second }),
    );
    expect(api.last()).toMatchObject({
      method: 'GET',
      path: `/api/v1/dashboard/audit-logs/${AUDIT_IDS.second}`,
    });
  });
});
