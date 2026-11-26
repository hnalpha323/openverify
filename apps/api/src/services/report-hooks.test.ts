/**
 * C84.2 (V08), C84.4: the shared services call the report hooks of `api-reports`.
 * `transitionInquiryInTx` runs `createInquiryReportsInTx` in the transition's transaction on the
 * two moves that run an inquiry's report list (`pending -> completed`, `failed -> approved |
 * needs_review`), and on no other; account consolidation runs `moveReportLinksInTx` in its
 * transaction. The hooks are replaced by recording fakes here. Synthetic values only.
 */
import type { InquiryStatus } from '@openverify/core';
import { getInquiry } from '@openverify/db';
import { createTestInquiry, createTestTenant } from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bearer, createTestApi, type TestApi } from '../test-support/harness.js';
import { transitionInquiryInTx } from './inquiries.js';

const hooks = vi.hoisted(() => ({ completion: vi.fn(), move: vi.fn() }));

vi.mock('./reports/completion.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./reports/completion.js')>()),
  createInquiryReportsInTx: hooks.completion,
}));
vi.mock('./reports/accounts.js', () => ({ moveReportLinksInTx: hooks.move }));

let api: TestApi;

beforeAll(async () => {
  api = await createTestApi();
}, 60_000);

afterAll(async () => {
  await api.close();
});

beforeEach(() => {
  hooks.completion.mockReset().mockResolvedValue({ reportIds: [] });
  hooks.move.mockReset().mockResolvedValue(undefined);
});

/** An inquiry in status `from`, moved to `to` through the choke point. */
async function move(from: InquiryStatus, to: InquiryStatus) {
  const { db } = api.database;
  const { environment } = await createTestTenant(db);
  const { inquiry } = await createTestInquiry(db, environment.id);
  await db.execute(sql`update inquiries set status = ${from} where id = ${inquiry.id}`);
  const current = await getInquiry(db, environment.id, inquiry.id);
  if (current === null) throw new Error('missing inquiry');
  await db.transaction((tx) =>
    transitionInquiryInTx(tx, { events: api.events, clock: api.clock }, current, to),
  );
  return current;
}

describe('C84.2: the completion hook runs in the transition, on its two moves only', () => {
  it.each([
    ['pending', 'completed'],
    ['failed', 'approved'],
    ['failed', 'needs_review'],
  ] as const)('%s -> %s creates the inquiry reports', async (from, to) => {
    const inquiry = await move(from, to);

    expect(hooks.completion).toHaveBeenCalledTimes(1);
    const call = (hooks.completion.mock.calls[0] ?? []) as unknown[];
    const [, deps, completion] = call;
    expect(deps).toEqual({ events: api.events, clock: api.clock });
    expect(completion).toMatchObject({ from, to, inquiry: { id: inquiry.id, status: to } });
  });

  it.each([
    ['failed', 'declined'],
    ['completed', 'approved'],
    ['completed', 'needs_review'],
    ['pending', 'failed'],
    ['created', 'pending'],
  ] as const)('%s -> %s creates none', async (from, to) => {
    await move(from, to);

    expect(hooks.completion).not.toHaveBeenCalled();
  });
});

describe('C84.4: consolidation moves the report links in its transaction', () => {
  it('passes the absorbing and the absorbed accounts', async () => {
    const token = await api.newApiKey(api.environmentId);
    const created = async () => {
      const response = await api.app.inject({
        method: 'POST',
        url: '/api/v1/accounts',
        headers: bearer(token),
        payload: { data: { attributes: {} } },
      });
      return response.json<{ data: { id: string } }>().data.id;
    };
    const target = await created();
    const source = await created();

    const response = await api.app.inject({
      method: 'POST',
      url: `/api/v1/accounts/${target}/consolidate`,
      headers: bearer(token),
      payload: { meta: { 'source-account-ids': [source] } },
    });

    expect(response.statusCode).toBe(200);
    expect(hooks.move).toHaveBeenCalledTimes(1);
    expect(hooks.move.mock.calls[0]?.[1]).toEqual({
      environmentId: api.environmentId,
      targetId: target,
      sourceIds: [source],
    });
  });
});
