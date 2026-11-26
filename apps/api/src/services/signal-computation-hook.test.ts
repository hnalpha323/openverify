/**
 * C90.5 (Workflow 7A Stage 1b (S); F02, F03, V17): the signals outbox hook in
 * `transitionInquiryInTx`. An inquiry's first move into `completed`, `failed` or `expired` (from
 * `pending`, or straight from `created`) writes its `inquiry_signal_computations` row in the
 * transition's transaction; no later move writes another, and a redacted inquiry gets none (owner
 * decision 5 after Workflow 6C: a redacted open inquiry still expires, and the expiry writes no
 * row). The moves are driven through the sandbox actions and the server API. Synthetic values.
 */
import type { InquiryStatus } from '@openverify/core';
import { redactInquiryRecords, transitionInquiryStatus } from '@openverify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runInquiryExpiry } from '../jobs/inquiry-expiry.js';
import { createCapturingLogger } from '../jobs/testing.js';
import { bearer, createInquiry, expectStatus } from '../test-support/harness.js';
import { createInquiryTestApi, type InquiryTestApi } from './inquiries.test-support.js';
import { writesSignalComputation } from './signals/computation.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const simulate = (id: string, types: readonly string[]) =>
  api.app.inject({
    method: 'POST',
    url: `/api/v1/inquiries/${id}/perform-simulate-actions`,
    headers: bearer(api.token),
    payload: { meta: { actions: types.map((type) => ({ type })) } },
  });

async function outbox(inquiryId: string) {
  const { rows } = await api.database.client.query<{ trigger_status: string; state: string }>(
    `select trigger_status, state from inquiry_signal_computations
      where environment_id = $1 and inquiry_id = $2`,
    [api.environmentId, inquiryId],
  );
  return rows;
}

async function statusOf(inquiryId: string): Promise<string | undefined> {
  const { rows } = await api.database.client.query<{ status: string }>(
    'select status from inquiries where id = $1',
    [inquiryId],
  );
  return rows[0]?.status;
}

describe('writesSignalComputation (C90.5)', () => {
  it.each([
    ['pending', 'completed', true],
    ['pending', 'failed', true],
    ['pending', 'expired', true],
    ['created', 'expired', true],
    ['created', 'pending', false],
    ['completed', 'approved', false],
    ['completed', 'needs_review', false],
    ['failed', 'approved', false],
    ['needs_review', 'declined', false],
  ] as const)('%s -> %s: %s', (from, to, writes) => {
    expect(writesSignalComputation(from as InquiryStatus, to as InquiryStatus)).toBe(writes);
  });
});

describe('the transition writes the signals outbox row (C90.5)', () => {
  it.each([
    ['completed', ['start_inquiry', 'complete_inquiry']],
    ['failed', ['start_inquiry', 'fail_inquiry']],
    ['expired', ['start_inquiry', 'expire_inquiry']],
  ] as const)('on the first move into %s, pending', async (trigger, actions) => {
    const id = await createInquiry(api, {});

    expectStatus(await simulate(id, actions), 200);

    expect(await outbox(id)).toEqual([{ trigger_status: trigger, state: 'pending' }]);
  });

  it('on an expiry straight from created (its signals are computed as not collected)', async () => {
    const id = await createInquiry(api, {});

    expectStatus(await simulate(id, ['expire_inquiry']), 200);

    expect(await outbox(id)).toEqual([{ trigger_status: 'expired', state: 'pending' }]);
  });

  it('writes nothing on the way there, and nothing more on a later decision', async () => {
    const id = await createInquiry(api, {});
    expectStatus(await simulate(id, ['start_inquiry']), 200);
    expect(await outbox(id)).toEqual([]);
    expectStatus(await simulate(id, ['complete_inquiry']), 200);

    expectStatus(
      await api.app.inject({
        method: 'POST',
        url: `/api/v1/inquiries/${id}/approve`,
        headers: bearer(api.token),
      }),
      200,
    );

    expect(await statusOf(id)).toBe('approved');
    expect(await outbox(id)).toEqual([{ trigger_status: 'completed', state: 'pending' }]);
  });

  it('keeps the failed row when a failed inquiry is approved', async () => {
    const id = await createInquiry(api, {});
    expectStatus(await simulate(id, ['start_inquiry', 'fail_inquiry']), 200);

    expectStatus(
      await api.app.inject({
        method: 'POST',
        url: `/api/v1/inquiries/${id}/approve`,
        headers: bearer(api.token),
      }),
      200,
    );

    expect(await outbox(id)).toEqual([{ trigger_status: 'failed', state: 'pending' }]);
  });

  it.each(['created', 'pending'] as const)(
    'writes no row for a redacted %s inquiry, which still expires (owner decision 5 after 6C)',
    async (status) => {
      const id = await createInquiry(api, {});
      if (status === 'pending') {
        await transitionInquiryStatus(api.database.db, api.environmentId, id, {
          from: 'created',
          to: 'pending',
        });
      }
      await redactInquiryRecords(api.database.db, api.environmentId, id);

      expectStatus(await simulate(id, ['expire_inquiry']), 200);

      expect(await statusOf(id)).toBe('expired');
      expect(await outbox(id)).toEqual([]);
    },
  );
});

describe('the expiry job writes the row through the same transition (C90.5, C10)', () => {
  it('for an overdue inquiry, and none for a redacted overdue one, which still expires', async () => {
    const ordinary = await createInquiry(api, {});
    const redacted = await createInquiry(api, {});
    await redactInquiryRecords(api.database.db, api.environmentId, redacted);
    await api.database.client.query(`update inquiries set expires_at = $2 where id = any($1)`, [
      [ordinary, redacted],
      new Date(api.clock.now().getTime() - 60_000),
    ]);

    await runInquiryExpiry({
      db: api.database.db,
      storage: api.storage,
      events: api.deps.events,
      clock: api.clock,
      logger: createCapturingLogger(),
    });

    expect([await statusOf(ordinary), await statusOf(redacted)]).toEqual(['expired', 'expired']);
    expect(await outbox(ordinary)).toEqual([{ trigger_status: 'expired', state: 'pending' }]);
    expect(await outbox(redacted)).toEqual([]);
  });
});
