/**
 * C99.4 (Workflow 7B Stage 1b (L); H23, V17): the list screening outbox hook in
 * `transitionInquiryInTx`. An inquiry's first move into `completed`, `failed` or `expired` writes
 * its `list_screenings` row in the transition's transaction when its pinned version's `list-config`
 * selects a list; a redacted inquiry gets none (owner decision 5 after Workflow 6C: it still
 * expires, and the expiry writes no row). The moves are driven through the sandbox actions and the
 * expiry job. Synthetic values.
 */
import { redactInquiryRecords, transitionInquiryStatus } from '@openverify/db';
import { seedList } from '@openverify/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runInquiryExpiry } from '../jobs/inquiry-expiry.js';
import { createCapturingLogger } from '../jobs/testing.js';
import { bearer, createInquiry, expectStatus } from '../test-support/harness.js';
import { createInquiryTestApi, type InquiryTestApi } from './inquiries.test-support.js';
import { writesListScreening } from './lists/screening.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await api.database.client.query(
    `update lists set status = 'archived', archived_at = now()
      where environment_id = $1 and status = 'active'`,
    [api.environmentId],
  );
  await api.database.client.query(
    `update inquiry_template_versions set list_config = '{}' where environment_id = $1`,
    [api.environmentId],
  );
});

const simulate = (id: string, types: readonly string[]) =>
  api.app.inject({
    method: 'POST',
    url: `/api/v1/inquiries/${id}/perform-simulate-actions`,
    headers: bearer(api.token),
    payload: { meta: { actions: types.map((type) => ({ type })) } },
  });

async function outbox(inquiryId: string) {
  const { rows } = await api.database.client.query<{ trigger_status: string; status: string }>(
    `select trigger_status, status from list_screenings
      where environment_id = $1 and inquiry_id = $2`,
    [api.environmentId, inquiryId],
  );
  return rows;
}

const setListConfig = (config: unknown) =>
  api.database.client.query(
    `update inquiry_template_versions set list_config = $2::jsonb where environment_id = $1`,
    [api.environmentId, JSON.stringify(config)],
  );

const screenedList = () => seedList(api.database.db, api.environmentId, { kind: 'email-address' });

describe('writesListScreening (C99.4, V17)', () => {
  it.each([
    ['pending', 'completed', true],
    ['pending', 'failed', true],
    ['pending', 'expired', true],
    ['created', 'expired', true],
    ['created', 'pending', false],
    ['completed', 'approved', false],
    ['completed', 'needs_review', false],
    ['failed', 'approved', false],
  ] as const)('%s -> %s: %s', (from, to, writes) => {
    expect(writesListScreening(from, to)).toBe(writes);
  });
});

describe('the transition writes the screening row (C99.4)', () => {
  it.each([
    ['completed', ['start_inquiry', 'complete_inquiry']],
    ['failed', ['start_inquiry', 'fail_inquiry']],
    ['expired', ['start_inquiry', 'expire_inquiry']],
    ['expired', ['expire_inquiry']],
  ] as const)('on the first move into %s (%j)', async (trigger, actions) => {
    await screenedList();
    const id = await createInquiry(api, {});

    expectStatus(await simulate(id, actions), 200);

    expect(await outbox(id)).toEqual([{ trigger_status: trigger, status: 'pending' }]);
  });

  it('keeps the first row on a later decision', async () => {
    await screenedList();
    const id = await createInquiry(api, {});
    expectStatus(await simulate(id, ['start_inquiry', 'complete_inquiry']), 200);

    expectStatus(
      await api.app.inject({
        method: 'POST',
        url: `/api/v1/inquiries/${id}/approve`,
        headers: bearer(api.token),
      }),
      200,
    );

    expect(await outbox(id)).toEqual([{ trigger_status: 'completed', status: 'pending' }]);
  });

  it('writes no row with no list selected: the count reads no_lists_selected (C99.4)', async () => {
    const id = await createInquiry(api, {});

    expectStatus(await simulate(id, ['start_inquiry', 'complete_inquiry']), 200);

    expect(await outbox(id)).toEqual([]);
  });

  it('writes no row under screen: none, whatever lists exist', async () => {
    await screenedList();
    const id = await createInquiry(api, {});
    await setListConfig({ screen: 'none' });

    expectStatus(await simulate(id, ['start_inquiry', 'complete_inquiry']), 200);

    expect(await outbox(id)).toEqual([]);
  });

  it('writes no row for an empty named list', async () => {
    await screenedList();
    const id = await createInquiry(api, {});
    await setListConfig({ screen: [] });

    expectStatus(await simulate(id, ['start_inquiry', 'complete_inquiry']), 200);

    expect(await outbox(id)).toEqual([]);
  });

  it('writes the row for a named list, even one archived since: it reads list_archived', async () => {
    const named = await seedList(api.database.db, api.environmentId, {
      kind: 'face',
      status: 'archived',
    });
    const id = await createInquiry(api, {});
    await setListConfig({ screen: [named.id] });

    expectStatus(await simulate(id, ['start_inquiry', 'complete_inquiry']), 200);

    expect(await outbox(id)).toEqual([{ trigger_status: 'completed', status: 'pending' }]);
  });
});

describe('a redacted inquiry gets no screening (owner decision 5 after 6C)', () => {
  it.each(['created', 'pending'] as const)(
    'through a sandbox expiry from %s, which still expires',
    async (status) => {
      await screenedList();
      const id = await createInquiry(api, {});
      if (status === 'pending') {
        await transitionInquiryStatus(api.database.db, api.environmentId, id, {
          from: 'created',
          to: 'pending',
        });
      }
      await redactInquiryRecords(api.database.db, api.environmentId, id);

      expectStatus(await simulate(id, ['expire_inquiry']), 200);

      expect(await outbox(id)).toEqual([]);
    },
  );

  it('through the expiry job, beside an ordinary overdue inquiry that gets its row', async () => {
    await screenedList();
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

    expect(await outbox(ordinary)).toEqual([{ trigger_status: 'expired', status: 'pending' }]);
    expect(await outbox(redacted)).toEqual([]);
  });
});
