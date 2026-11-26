// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUDIT_IDS, auditLog } from '../../components/operators/test-fixtures';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { meDocument, mockApi, type MockApi } from '../../testing/api-mock';
import { fakeRequest } from '../../testing/fake-request';
import { searchAuditLogsByIp } from './actions';

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

const READER = meDocument({ permissions: ['audit-logs:read', 'pii:view'] });
const form = (ip: string) => {
  const data = new FormData();
  data.set('ip', ip);
  return data;
};

describe('searchAuditLogsByIp (C168.6)', () => {
  it('posts nothing to the URL: it asks the API for entries of one exact address and answers them', async () => {
    api.reply(200, READER).reply(200, { data: [auditLog()], links: { next: null } });

    const result = await searchAuditLogsByIp(null, form(' 2001:db8::7 '));

    expect(result).toMatchObject({
      ok: true,
      data: { entries: [{ id: AUDIT_IDS.first }], more: false },
    });
    expect(api.last()).toMatchObject({ method: 'GET', path: '/api/v1/dashboard/audit-logs' });
    expect(Object.fromEntries(api.last().query)).toEqual({
      'filter[ip]': '2001:db8::7',
      'page[size]': '25',
    });
  });

  it('says when there are more entries than one page', async () => {
    api.reply(200, READER).reply(200, {
      data: [auditLog()],
      links: { next: `/api/v1/dashboard/audit-logs?page%5Bafter%5D=${AUDIT_IDS.first}` },
    });

    await expect(searchAuditLogsByIp(null, form('203.0.113.9'))).resolves.toMatchObject({
      ok: true,
      data: { more: true },
    });
  });

  it('needs pii:view, and calls nothing without it', async () => {
    api.reply(200, meDocument({ permissions: ['audit-logs:read'] }));

    await expect(searchAuditLogsByIp(null, form('203.0.113.9'))).resolves.toMatchObject({
      ok: false,
    });
    expect(api.requests).toHaveLength(1);
  });

  it.each(['203.0.113', '203.0.113.9/24', 'example.com', ''])(
    'refuses %j at the field without calling the API',
    async (ip) => {
      api.reply(200, READER);

      await expect(searchAuditLogsByIp(null, form(ip))).resolves.toMatchObject({
        ok: false,
        problem: {
          errors: [
            { pointer: '/ip', detail: 'Enter one IPv4 or IPv6 address, such as 203.0.113.9.' },
          ],
        },
      });
      expect(api.requests).toHaveLength(1);
    },
  );

  it('says in words that the installation cannot search by address (503)', async () => {
    api.reply(200, READER).replyProblem(503);

    await expect(searchAuditLogsByIp(null, form('203.0.113.9'))).resolves.toMatchObject({
      ok: false,
      problem: {
        title:
          'This installation has no blind-index key, so audit entries cannot be found by address.',
      },
    });
  });
});
