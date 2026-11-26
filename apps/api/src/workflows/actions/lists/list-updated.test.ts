/**
 * Workflow 8A Stage 3 (`api-actions`; C127.12): `list.updated`, staged in the write's transaction
 * with its outbox row, coalesced per list, a repeat at one version stages nothing, and the job wakes
 * after the commit. Then the `list-rescreen` job: one `list_update` run per monitored custom-list
 * report that selects the list and per list version, none for an unmonitored, paused, redacted or
 * other report, and the watchlist path untouched. Synthetic values.
 */
import { listDueListRescreenRequests, getList, type Db } from '@openverify/db';
import {
  createTestDatabase,
  createTestTenant,
  seedList,
  seedReport,
  seedReportTemplate,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { processListRescreen, runListRescreenSweep } from '../../../jobs/reports/list-rescreen.js';
import { createCapturingLogger } from '../../../jobs/testing.js';
import {
  createRecordingEventPublisher,
  createRecordingListRescreenQueue,
} from '../../../test-support/fakes.js';
import { stageListUpdated } from './list-updated.js';

let database: TestDatabase;
let db: Db;
let environmentId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  ({
    environment: { id: environmentId },
  } = await createTestTenant(db));
}, 120_000);

afterAll(async () => {
  await database.close();
});

const runsOf = async (reportId: string) =>
  (
    await database.client.query<{
      run_type: string;
      trigger_list_id: string | null;
      trigger_list_version: number | null;
      trigger_sync_id: number | null;
    }>(
      `select run_type, trigger_list_id, trigger_list_version, trigger_sync_id
         from report_runs where report_id = $1 order by id`,
      [reportId],
    )
  ).rows;

async function customListReport(
  listIds: readonly string[] | null,
  input: { nextRunAt?: Date | null; pausedAt?: Date | null; query?: Record<string, unknown> } = {},
) {
  const template = await seedReportTemplate(db, environmentId, {
    reportType: 'custom-list',
    config: { 'list-ids': listIds },
  });
  return seedReport(db, environmentId, {
    ...template,
    reportType: 'custom-list',
    status: 'ready',
    nextRunAt: new Date('2027-01-01T00:00:00.000Z'),
    query: { 'list-ids': [], ...input.query },
    ...input,
  });
}

describe('stageListUpdated (C127.12)', () => {
  it('stages one event and one outbox row per list, and wakes the job after the commit', async () => {
    const events = createRecordingEventPublisher();
    const list = await seedList(db, environmentId);
    const stored = await getList(db, environmentId, list.id);
    const staged = await db.transaction((tx) =>
      stageListUpdated(tx, { events }, environmentId, [
        { listId: list.id, changeKind: 'items-added', items: 2 },
        { listId: list.id, changeKind: 'items-added', items: 3 },
      ]),
    );
    expect(staged).toHaveLength(1);
    expect(staged[0]?.listRescreens).toEqual([
      { environmentId, listId: list.id, listVersion: stored?.version },
    ]);
    await events.dispatch(staged);
    expect(events.named('list.updated')[0]?.payload).toMatchObject({
      data: { id: list.id },
      meta: {
        'change-kind': 'items-added',
        counts: { 'items-changed': 5 },
        'list-version': stored?.version,
      },
    });
    const due = await listDueListRescreenRequests(db, { now: new Date(), limit: 500 });
    expect(due.filter(({ listId }) => listId === list.id)).toHaveLength(1);
  });

  it('stages nothing for a repeat at the same version', async () => {
    const events = createRecordingEventPublisher();
    const list = await seedList(db, environmentId);
    const update = { listId: list.id, changeKind: 'items-added', items: 1 } as const;
    await stageListUpdated(db, { events }, environmentId, [update]);
    expect(await stageListUpdated(db, { events }, environmentId, [update])).toEqual([]);
  });

  it('skips a list this environment does not hold', async () => {
    const events = createRecordingEventPublisher();
    const list = await seedList(db, environmentId);
    const { environment } = await createTestTenant(db);
    const update = { listId: list.id, changeKind: 'archived', items: 0 } as const;
    expect(await stageListUpdated(db, { events }, environment.id, [update])).toEqual([]);
  });
});

describe('the list-rescreen job (C127.12)', () => {
  const deps = () => ({
    db,
    logger: createCapturingLogger(),
    rescreens: createRecordingListRescreenQueue(),
  });

  it('inserts one run per monitored report and list version, however often it runs', async () => {
    const list = await seedList(db, environmentId);
    const reportId = await customListReport([list.id]);
    const job = { environmentId, listId: list.id, listVersion: 4 };
    await processListRescreen(job, deps());
    await processListRescreen(job, deps());
    expect(await runsOf(reportId)).toEqual([
      {
        run_type: 'list_update',
        trigger_list_id: list.id,
        trigger_list_version: 4,
        trigger_sync_id: null,
      },
    ]);
    await processListRescreen({ ...job, listVersion: 5 }, deps());
    expect(await runsOf(reportId)).toHaveLength(2);
  });

  it('reads a list the report named on its sealed query', async () => {
    const list = await seedList(db, environmentId);
    const reportId = await customListReport(null, { query: { 'list-ids': [list.id] } });
    await processListRescreen({ environmentId, listId: list.id, listVersion: 2 }, deps());
    expect(await runsOf(reportId)).toHaveLength(1);
  });

  it('leaves an unmonitored, a paused and another list’s report alone', async () => {
    const list = await seedList(db, environmentId);
    const other = await seedList(db, environmentId);
    const reports = [
      await customListReport([list.id], { nextRunAt: null }),
      await customListReport([list.id], { pausedAt: new Date() }),
      await customListReport([other.id]),
    ];
    await processListRescreen({ environmentId, listId: list.id, listVersion: 2 }, deps());
    for (const reportId of reports) {
      expect(await runsOf(reportId)).toEqual([]);
    }
  });

  it('leaves a watchlist report to its own path (rule 16)', async () => {
    const list = await seedList(db, environmentId);
    const template = await seedReportTemplate(db, environmentId, {
      config: { 'list-ids': [list.id] },
    });
    const reportId = await seedReport(db, environmentId, {
      ...template,
      status: 'ready',
      nextRunAt: new Date('2027-01-01T00:00:00.000Z'),
    });
    await processListRescreen({ environmentId, listId: list.id, listVersion: 2 }, deps());
    expect(await runsOf(reportId)).toEqual([]);
  });

  it('closes its request, and the sweep wakes what is open', async () => {
    const list = await seedList(db, environmentId);
    const events = createRecordingEventPublisher();
    const [staged] = await stageListUpdated(db, { events }, environmentId, [
      { listId: list.id, changeKind: 'items-added', items: 1 },
    ]);
    const queue = deps();
    await runListRescreenSweep(queue);
    const job = queue.rescreens.jobs.find(({ listId }) => listId === list.id);
    expect(job).toEqual(staged?.listRescreens?.[0]);
    const again = deps();
    await runListRescreenSweep(again);
    expect(again.rescreens.jobs.filter(({ listId }) => listId === list.id)).toEqual([]);
    await processListRescreen(job ?? (staged?.listRescreens?.[0] as never), deps());
    const due = await listDueListRescreenRequests(db, {
      now: new Date(Date.now() + 3_600_000),
      limit: 500,
    });
    expect(due.filter(({ listId }) => listId === list.id)).toEqual([]);
  });
});
