/**
 * C100.2, C107.1: the `list-import-sweep` recovers a lost enqueue, and leaves alone an import that
 * ended or was enqueued a moment ago. Every value is synthetic.
 */
import { createImporter, getImporter } from '@openverify/db';
import {
  createTestDatabase,
  createTestTenant,
  seedList,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ListImportJob, ListImportQueue } from '../../ports.js';
import { fixedClock } from '../../test-support/fakes.js';
import { createCapturingLogger } from '../testing.js';
import { LIST_IMPORT_REENQUEUE_AFTER_MS, runListImportSweep } from './sweep.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.close();
});

function recordingQueue() {
  const jobs: ListImportJob[] = [];
  const queue: ListImportQueue = {
    enqueueListImport: (job) => {
      jobs.push(job);
      return Promise.resolve();
    },
  };
  return { jobs, queue };
}

async function pendingImporter(environmentId: string, listId: string) {
  const id = testId('mprt');
  await createImporter(database.db, environmentId, {
    id,
    listId,
    mode: 'all-or-nothing',
    encoding: 'utf-8',
    fileSha256: 'a'.repeat(64),
    fileBytes: 1,
    storageKey: `imports/${id}`,
    wrappedDek: 'ov1.test.synthetic',
  });
  return id;
}

describe('runListImportSweep', () => {
  it('enqueues a pending import, records it, and leaves it for its job', async () => {
    const { environment } = await createTestTenant(database.db);
    const list = await seedList(database.db, environment.id);
    const id = await pendingImporter(environment.id, list.id);
    const clock = fixedClock();
    const { jobs, queue } = recordingQueue();
    const logger = createCapturingLogger();

    await runListImportSweep({ db: database.db, clock, logger, imports: queue });

    expect(jobs).toContainEqual({ environmentId: environment.id, importerId: id });
    expect(await getImporter(database.db, environment.id, id)).toMatchObject({
      enqueuedAt: clock.now(),
    });

    const again = recordingQueue();
    await runListImportSweep({ db: database.db, clock, logger, imports: again.queue });
    expect(again.jobs).not.toContainEqual({ environmentId: environment.id, importerId: id });
  });

  it('records each enqueue before the job exists, so the job never meets that write’s row lock', async () => {
    const { environment } = await createTestTenant(database.db);
    const list = await seedList(database.db, environment.id);
    const id = await pendingImporter(environment.id, list.id);
    const clock = fixedClock();
    const seen: (Date | null | undefined)[] = [];
    const queue: ListImportQueue = {
      enqueueListImport: async (job) => {
        if (job.importerId === id) {
          seen.push((await getImporter(database.db, environment.id, id))?.enqueuedAt);
        }
      },
    };

    await runListImportSweep({
      db: database.db,
      clock,
      logger: createCapturingLogger(),
      imports: queue,
    });

    expect(seen).toEqual([clock.now()]);
  });

  it('leaves the row for the next tick when its enqueue is lost', async () => {
    const { environment } = await createTestTenant(database.db);
    const list = await seedList(database.db, environment.id);
    const id = await pendingImporter(environment.id, list.id);
    const queue: ListImportQueue = {
      enqueueListImport: (job) =>
        job.importerId === id ? Promise.reject(new Error('unreachable')) : Promise.resolve(),
    };

    await expect(
      runListImportSweep({
        db: database.db,
        clock: fixedClock(),
        logger: createCapturingLogger(),
        imports: queue,
      }),
    ).rejects.toThrow('unreachable');

    expect((await getImporter(database.db, environment.id, id))?.enqueuedAt).toBeNull();
  });

  it('enqueues again once the last enqueue is old enough', async () => {
    const { environment } = await createTestTenant(database.db);
    const list = await seedList(database.db, environment.id);
    const id = await pendingImporter(environment.id, list.id);
    const clock = fixedClock();
    const logger = createCapturingLogger();
    await runListImportSweep({
      db: database.db,
      clock,
      logger,
      imports: recordingQueue().queue,
    });

    const later = fixedClock(new Date(clock.now().getTime() + LIST_IMPORT_REENQUEUE_AFTER_MS + 1));
    const { jobs, queue } = recordingQueue();
    await runListImportSweep({ db: database.db, clock: later, logger, imports: queue });

    expect(jobs).toContainEqual({ environmentId: environment.id, importerId: id });
  });

  it('leaves an ended import', async () => {
    const { environment } = await createTestTenant(database.db);
    const list = await seedList(database.db, environment.id);
    const id = await pendingImporter(environment.id, list.id);
    await database.db.execute(
      sql`update importers set status = 'ready', completed_at = now() where id = ${id}`,
    );
    const { jobs, queue } = recordingQueue();

    await runListImportSweep({
      db: database.db,
      clock: fixedClock(),
      logger: createCapturingLogger(),
      imports: queue,
    });

    expect(jobs).not.toContainEqual({ environmentId: environment.id, importerId: id });
  });

  it('logs a count only', async () => {
    const { environment } = await createTestTenant(database.db);
    const list = await seedList(database.db, environment.id);
    await pendingImporter(environment.id, list.id);
    const logger = createCapturingLogger();

    await runListImportSweep({
      db: database.db,
      clock: fixedClock(),
      logger,
      imports: recordingQueue().queue,
    });

    expect(logger.entries.at(-1)).toMatchObject({
      level: 'info',
      object: { enqueued: expect.any(Number) as number },
      message: 'list import sweep',
    });
  });

  it('logs nothing with nothing to do', async () => {
    const logger = createCapturingLogger();
    await database.db.execute(
      sql`update importers set status = 'ready', completed_at = now() where status = 'pending'`,
    );

    await runListImportSweep({
      db: database.db,
      clock: fixedClock(),
      logger,
      imports: recordingQueue().queue,
    });

    expect(logger.entries).toEqual([]);
  });
});
