/**
 * C70.5, C107.6 (Workflow 7B Stage 1b (T)): `GET /accounts/:id?include=` serves exactly what it was
 * asked for. `transactions` needs `transactions:read` and goes through `includedTransactionsFor`
 * (the `api-transactions` hook, a recording fake here). `reports` needs `reports:read`, so asking
 * for anything else must not reach the reports hook: a caller with `transactions:read` alone would
 * read reports it may not. Synthetic values only (the golden fixtures). The hooks are asserted by
 * count: a failed `not.toHaveBeenCalled` prints the arguments, and the database handle among them
 * runs a worker out of memory.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bearer, createTestApi, type TestApi } from '../../test-support/harness.js';

const hooks = vi.hoisted(() => ({ reports: vi.fn(), transactions: vi.fn() }));
vi.mock('../../services/reports/includes.js', () => ({
  MAX_INCLUDED_REPORTS: 50,
  includedReportsFor: hooks.reports,
}));
vi.mock('../../services/transactions/includes.js', () => ({
  MAX_INCLUDED_TRANSACTIONS: 50,
  includedTransactionsFor: hooks.transactions,
}));

const dataOf = (file: URL) => (JSON.parse(readFileSync(file, 'utf8')) as { data: unknown }).data;

const report = dataOf(
  new URL('../../../../../contracts/fixtures/api/report-watchlist.json', import.meta.url),
);
const transaction = dataOf(
  new URL('../../../../../contracts/fixtures/api/transaction.json', import.meta.url),
);

let api: TestApi;
let accountId: string;

beforeAll(async () => {
  api = await createTestApi();
  const created = await api.app.inject({
    method: 'POST',
    url: '/api/v1/accounts',
    headers: bearer(api.token),
    payload: { data: { attributes: {} } },
  });
  accountId = created.json<{ data: { id: string } }>().data.id;
}, 60_000);

afterAll(async () => {
  await api.close();
});

beforeEach(() => {
  hooks.reports.mockReset().mockResolvedValue([report]);
  hooks.transactions.mockReset().mockResolvedValue([transaction]);
});

const get = (url: string, token = api.token) =>
  api.app.inject({ method: 'GET', url: `/api/v1${url}`, headers: bearer(token) });

describe('GET /accounts/:id?include= (C70.5, C107.6)', () => {
  it('includes the transactions, as the hook answers them, and never the reports', async () => {
    const response = await get(`/accounts/${accountId}?include=transactions`);

    expect(response.statusCode).toBe(200);
    expect(response.json<{ included: unknown[] }>().included).toEqual([transaction]);
    expect(hooks.transactions.mock.calls[0]?.slice(1, 3)).toEqual([
      api.environmentId,
      { accountId },
    ]);
    expect(hooks.reports.mock.calls.length).toBe(0);
  });

  it('reads no report for a caller with transactions:read alone', async () => {
    const token = await api.newApiKey(api.environmentId, {
      scopes: ['accounts:read', 'transactions:read'],
    });

    const response = await get(`/accounts/${accountId}?include=transactions`, token);

    expect(response.statusCode).toBe(200);
    expect(hooks.reports.mock.calls.length).toBe(0);
  });

  it('includes the reports alone when only they were asked for', async () => {
    const response = await get(`/accounts/${accountId}?include=reports`);

    expect(response.json<{ included: unknown[] }>().included).toEqual([report]);
    expect(hooks.transactions.mock.calls.length).toBe(0);
  });

  it('includes both, reports first, when both were asked for', async () => {
    const response = await get(`/accounts/${accountId}?include=reports,transactions`);

    expect(response.json<{ included: unknown[] }>().included).toEqual([report, transaction]);
  });

  it('reads no report for an include of list matches', async () => {
    const response = await get(`/accounts/${accountId}?include=list-matches`);

    expect(response.statusCode).toBe(200);
    expect(hooks.reports.mock.calls.length).toBe(0);
  });

  it('needs transactions:read for the include', async () => {
    const token = await api.newApiKey(api.environmentId, { scopes: ['accounts:read'] });

    expect((await get(`/accounts/${accountId}?include=transactions`, token)).statusCode).toBe(403);
    expect(hooks.transactions.mock.calls.length).toBe(0);
  });
});

describe('the unbuilt hook', () => {
  it('includes nothing', async () => {
    const { includedTransactionsFor } = await vi.importActual<
      typeof import('../../services/transactions/includes.js')
    >('../../services/transactions/includes.js');

    expect(
      await includedTransactionsFor(api.database.db, api.environmentId, { accountId }, {} as never),
    ).toEqual([]);
  });
});
