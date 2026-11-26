/**
 * C251.1 (Workflow 11B, `dsar-export`): a created export is admitted after the create's commit: its
 * `admitted_at` stamped at the clock's time and its job enqueued under its own id, once; a failed
 * enqueue clears the stamp and rethrows (the service keeps the export pending); without a producer
 * nothing is stamped or enqueued. Since integration-11b (C251.1) it is admitted under the
 * environment's account-export cap: at the cap it stays pending and unstamped for the quota sweep,
 * and a failed enqueue holds it again rather than rethrowing. PGlite; synthetic ids only.
 */
import { newId } from '@openverify/contracts';
import {
  createAccount,
  getAccountExportRecord,
  insertPendingAccountExport,
  type Db,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestTenant,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AccountExportJob, AccountExportQueue } from '../../jobs/account-export-queues.js';
import { fixedClock } from '../../test-support/fakes.js';
import { createAccountExportAdmission } from './admission.js';

let database: TestDatabase;
let db: Db;
let environmentId: string;
let exportId: string;

const T0 = new Date('2026-11-13T12:00:00.000Z');

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  environmentId = (await createTestTenant(db)).environment.id;
  const accountId = (await createAccount(db, environmentId, { id: testId('acc') })).id;
  exportId = newId('aexp');
  await insertPendingAccountExport(db, environmentId, {
    id: exportId,
    accountId,
    creator: { type: 'api-key', id: testId('key') },
    at: T0,
  });
});

function producer(fail = false) {
  const jobs: AccountExportJob[] = [];
  const queue: AccountExportQueue = {
    enqueueAccountExport: (job) => {
      if (fail) {
        return Promise.reject(new Error('synthetic queue outage'));
      }
      jobs.push(job);
      return Promise.resolve();
    },
  };
  return { queue, jobs };
}

describe('createAccountExportAdmission (C251.1)', () => {
  it('stamps the export and enqueues its job by its id, once', async () => {
    const { queue, jobs } = producer();
    const admit = createAccountExportAdmission({ db, clock: fixedClock(T0), producer: queue });

    await admit(environmentId, exportId);
    await admit(environmentId, exportId);

    expect(jobs).toEqual([{ environmentId, exportId }]);
    expect((await getAccountExportRecord(db, environmentId, exportId))?.admittedAt).toEqual(T0);
  });

  it('holds the export again (no stamp) when the enqueue fails, for the quota sweep', async () => {
    const { queue } = producer(true);
    const admit = createAccountExportAdmission({ db, clock: fixedClock(T0), producer: queue });

    await admit(environmentId, exportId);
    expect(await getAccountExportRecord(db, environmentId, exportId)).toMatchObject({
      status: 'pending',
      admittedAt: null,
    });
  });

  it('holds an export at the environment cap: pending, unstamped, not enqueued (C251.1)', async () => {
    const accountId = (await createAccount(db, environmentId, { id: testId('acc') })).id;
    const heldId = newId('aexp');
    await insertPendingAccountExport(db, environmentId, {
      id: heldId,
      accountId,
      creator: { type: 'api-key', id: testId('key') },
      at: new Date(T0.getTime() + 1_000),
    });
    const { queue, jobs } = producer();
    const admit = createAccountExportAdmission({
      db,
      clock: fixedClock(T0),
      producer: queue,
      queueInFlightCapMax: 1,
    });

    await admit(environmentId, exportId);
    await admit(environmentId, heldId);

    expect(jobs).toEqual([{ environmentId, exportId }]);
    expect(await getAccountExportRecord(db, environmentId, heldId)).toMatchObject({
      status: 'pending',
      admittedAt: null,
    });
  });

  it('stamps and enqueues nothing without a producer', async () => {
    const admit = createAccountExportAdmission({ db, clock: fixedClock(T0) });

    await admit(environmentId, exportId);

    expect((await getAccountExportRecord(db, environmentId, exportId))?.admittedAt).toBeNull();
  });
});
