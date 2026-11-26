/**
 * C70.5 (F08): `?include=reports` on inquiries and accounts calls `includedReportsFor` (the
 * `api-reports` hook, replaced by a recording fake here) with the caller's mask and puts what it
 * answers in `included`; the include needs `reports:read` as well. Synthetic values only (the
 * golden report fixture).
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bearer, createInquiry, createTestApi, type TestApi } from '../../test-support/harness.js';

const hooks = vi.hoisted(() => ({ included: vi.fn() }));
vi.mock('../../services/reports/includes.js', () => ({
  MAX_INCLUDED_REPORTS: 50,
  includedReportsFor: hooks.included,
}));

const report = (
  JSON.parse(
    readFileSync(
      new URL('../../../../../contracts/fixtures/api/report-watchlist.json', import.meta.url),
      'utf8',
    ),
  ) as { data: unknown }
).data;

let api: TestApi;

beforeAll(async () => {
  api = await createTestApi();
}, 60_000);

afterAll(async () => {
  await api.close();
});

beforeEach(() => {
  hooks.included.mockReset().mockResolvedValue([report]);
});

const get = (url: string, token = api.token) =>
  api.app.inject({ method: 'GET', url: `/api/v1${url}`, headers: bearer(token) });

describe('C70.5: ?include=reports', () => {
  it('includes the reports of an inquiry, as the hook answers them', async () => {
    const inquiryId = await createInquiry(api);

    const response = await get(`/inquiries/${inquiryId}?include=reports`);

    expect(response.statusCode).toBe(200);
    expect(response.json<{ included: unknown[] }>().included).toEqual([report]);
    expect(hooks.included.mock.calls[0]?.slice(1, 3)).toEqual([api.environmentId, { inquiryId }]);
  });

  it('includes the reports of an account, home or linked', async () => {
    const created = await api.app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      headers: bearer(api.token),
      payload: { data: { attributes: {} } },
    });
    const accountId = created.json<{ data: { id: string } }>().data.id;

    const response = await get(`/accounts/${accountId}?include=reports`);

    expect(response.statusCode).toBe(200);
    expect(response.json<{ included: unknown[] }>().included).toEqual([report]);
    expect(hooks.included.mock.calls[0]?.slice(1, 3)).toEqual([api.environmentId, { accountId }]);
    expect((await get(`/accounts/${accountId}`)).json()).not.toHaveProperty('included');
  });

  it('needs reports:read for the include', async () => {
    const inquiryId = await createInquiry(api);
    const token = await api.newApiKey(api.environmentId, {
      scopes: ['inquiries:read', 'accounts:read', 'accounts:write'],
    });

    expect((await get(`/inquiries/${inquiryId}?include=reports`, token)).statusCode).toBe(403);
    expect(hooks.included).not.toHaveBeenCalled();
  });
});
