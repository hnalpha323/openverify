/**
 * C143.1, C132.6, C133.6, C138.1 (Workflow 8B Stage 1b (Q), (F)): the case sweeps run whenever the
 * worker runs the case jobs, `case-sla` every 30 seconds, `case-reassign` and `case-export-sweep`
 * every 60, each calling its owner's function (`jobs/repeatable/cases.ts`, `api-queues-sla`;
 * `jobs/cases/export-sweep.ts`, `api-case-files`) with the Phase 5 deps and the publisher or storage.
 */
import type { Db } from '@openverify/db';
import { describe, expect, it, vi } from 'vitest';
import type { TransactionalEventPublisher } from '../../events/index.js';
import { createCapturingLogger, createMemoryStorage } from '../testing.js';
import { caseRepeatableJobs, type RepeatableJobDeps } from './index.js';

const sweeps = vi.hoisted(() => ({
  sla: vi.fn(() => Promise.resolve()),
  reassign: vi.fn(() => Promise.resolve()),
  drain: vi.fn(() => Promise.resolve()),
}));
vi.mock('./cases.js', () => ({
  runCaseSlaSweep: sweeps.sla,
  runCaseReassignSweep: sweeps.reassign,
  runCaseAssignmentDrain: sweeps.drain,
}));
const exportSweep = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('../cases/export-sweep.js', () => ({ runCaseExportSweep: exportSweep }));
const requeue = vi.hoisted(() => vi.fn(() => Promise.resolve(0)));
const recover = vi.hoisted(() =>
  vi.fn(() => Promise.resolve({ exports: 0, scans: 0, renditions: 0 })),
);
vi.mock('../cases/recovery.js', () => ({ requeueUnfinishedCaseFileWork: recover }));
const emails = vi.hoisted(() => vi.fn(() => Promise.resolve({ sent: 0, skipped: 0, failed: 0 })));
vi.mock('../cases/notification-emails.js', () => ({ runCaseNotificationEmails: emails }));
vi.mock('../../services/cases/bulk/service.js', () => ({
  requeueUnfinishedCaseBulkActions: requeue,
}));

function deps(): RepeatableJobDeps {
  return {
    db: {} as Db,
    clock: { now: () => new Date('2026-11-03T00:00:00Z') },
    logger: createCapturingLogger(),
  };
}

const events = {} as TransactionalEventPublisher;
const storage = createMemoryStorage();

describe('caseRepeatableJobs (C143.1)', () => {
  it('schedules nothing without the case jobs', () => {
    expect(caseRepeatableJobs(deps(), undefined)).toEqual([]);
  });

  it('schedules each sweep on its period', () => {
    expect(
      caseRepeatableJobs(deps(), { events, storage }).map(({ name, repeat }) => [name, repeat]),
    ).toEqual([
      ['case-sla', { every: 30_000 }],
      ['case-reassign', { every: 60_000 }],
      ['case-assignment-drain', { every: 60_000 }],
      ['case-export-sweep', { every: 60_000 }],
    ]);
  });

  it('runs each sweep with the database, the clock, the logger and the publisher or storage', async () => {
    const base = deps();

    await Promise.all(caseRepeatableJobs(base, { events, storage }).map((job) => job.run()));

    const expected = { db: base.db, clock: base.clock, logger: base.logger, events };
    expect(sweeps.sla).toHaveBeenCalledWith(expected);
    expect(sweeps.reassign).toHaveBeenCalledWith(expected);
    expect(sweeps.drain).toHaveBeenCalledWith(expected);
    expect(exportSweep).toHaveBeenCalledWith({
      db: base.db,
      clock: base.clock,
      logger: base.logger,
      storage,
    });
  });
});

describe('case-bulk-sweep (C137.4, C143.2; Workflow 8B Stage 4)', () => {
  const bulk = { enqueueCaseBulkAction: vi.fn(() => Promise.resolve()) };

  it('schedules the sweep every 60 seconds when the worker holds the case-bulk producer', () => {
    expect(
      caseRepeatableJobs(deps(), { events, storage, bulk }).map(({ name, repeat }) => [
        name,
        repeat,
      ]),
    ).toEqual([
      ['case-sla', { every: 30_000 }],
      ['case-reassign', { every: 60_000 }],
      ['case-assignment-drain', { every: 60_000 }],
      ['case-export-sweep', { every: 60_000 }],
      ['case-bulk-sweep', { every: 60_000 }],
    ]);
  });

  it('enqueues again the bulk actions left unfinished for a minute, through the producer', async () => {
    const base = deps();
    const sweep = caseRepeatableJobs(base, { events, storage, bulk }).find(
      ({ name }) => name === 'case-bulk-sweep',
    );

    await sweep?.run();

    expect(requeue).toHaveBeenCalledWith(base.db, bulk, new Date('2026-11-02T23:59:00Z'));
  });
});

describe('case-export-sweep enqueues unfinished case file work again (K8-28, Workflow 8D)', () => {
  const exports = { enqueueCaseExport: vi.fn(() => Promise.resolve()) };
  const scans = { enqueueCaseAttachmentScan: vi.fn(() => Promise.resolve()) };
  const renditions = { enqueueCaseRendition: vi.fn(() => Promise.resolve()) };

  it('asks for the work left unfinished for a minute, through the worker’s producers', async () => {
    const base = deps();
    const sweep = caseRepeatableJobs(base, {
      events,
      storage,
      exports,
      scans,
      renditions,
    }).find(({ name }) => name === 'case-export-sweep');

    await sweep?.run();

    expect(recover).toHaveBeenCalledWith(
      { db: base.db, exports, scans, renditions },
      new Date('2026-11-02T23:59:00Z'),
    );
  });

  it('asks for none without a producer', async () => {
    recover.mockClear();
    const sweep = caseRepeatableJobs(deps(), { events, storage }).find(
      ({ name }) => name === 'case-export-sweep',
    );

    await sweep?.run();

    expect(recover).not.toHaveBeenCalled();
  });
});

describe('case-notification-emails (K8-20, Workflow 8D)', () => {
  const mailer = { configured: true, send: vi.fn(() => Promise.resolve()) };

  it('is scheduled every 30 seconds when the worker holds a mailer', () => {
    expect(
      caseRepeatableJobs(deps(), { events, storage, mailer }).map(({ name, repeat }) => [
        name,
        repeat,
      ]),
    ).toEqual([
      ['case-sla', { every: 30_000 }],
      ['case-reassign', { every: 60_000 }],
      ['case-assignment-drain', { every: 60_000 }],
      ['case-export-sweep', { every: 60_000 }],
      ['case-notification-emails', { every: 30_000 }],
    ]);
  });

  it('sends through the worker’s mailer, naming the console’s public URL', async () => {
    const base = deps();
    const sweep = caseRepeatableJobs(base, {
      events,
      storage,
      mailer,
      dashboardPublicUrl: 'https://console.example.test',
    }).find(({ name }) => name === 'case-notification-emails');

    await sweep?.run();

    expect(emails).toHaveBeenCalledWith({
      db: base.db,
      clock: base.clock,
      logger: base.logger,
      mailer,
      dashboardPublicUrl: 'https://console.example.test',
    });
  });
});
