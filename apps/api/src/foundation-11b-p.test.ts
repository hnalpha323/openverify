/**
 * Workflow 11B Stage 1b (P) (foundation-11b): the admission hook (C251.1) and the audit log's
 * retention through the migration role's function (C249.3).
 *
 * - The `process-verification` and `report-run` producers ask `admitOnProduce` (`quotas`') first and
 *   enqueue only an admitted row's job; the container and the worker build them so, so every enqueue
 *   site of inventory 2.6 goes through the hook.
 * - The stub admitted every row at once and stamped it; quotas built it (`services/quotas/admit.test.ts`
 *   holds the admission over real rows), so that case left this file.
 * - `runAuditLogRetention` deletes through `openverify_delete_expired_audit_logs`, never directly.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { withReportRunAdmission, withVerificationAdmission } from './jobs/admitted-producers.js';
import type { ProcessVerificationJob, ReportRunJob } from './ports.js';
import * as admit from './services/quotas/admit.js';
import { fixedClock } from './test-support/fakes.js';

vi.mock('./services/quotas/admit.js', { spy: true });

const ENV = 'env_01M5CN0000000000000011B400';
const VER = 'ver_01M5CN0000000000000011B600';
const RPR = 'rpr_01M5CN0000000000000011B700';
const REP = 'rep_01M5CN0000000000000011B800';

const source = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');

function recording<Job>() {
  const jobs: Job[] = [];
  let closed = false;
  return {
    jobs,
    closed: () => closed,
    enqueue: (job: Job) => {
      jobs.push(job);
      return Promise.resolve();
    },
    close: () => {
      closed = true;
      return Promise.resolve();
    },
  };
}

describe('the admitted producers (C251.1)', () => {
  const deps = { db: {} as never, clock: fixedClock() };

  it('enqueues an admitted verification’s job, and holds one the cap does not admit', async () => {
    const inner = recording<ProcessVerificationJob>();
    const queue = withVerificationAdmission(
      { enqueueProcessVerification: inner.enqueue, close: inner.close },
      deps,
    );
    const job = { environmentId: ENV, verificationId: VER };
    vi.mocked(admit.admitOnProduce).mockResolvedValueOnce(true);
    await queue.enqueueProcessVerification(job);
    vi.mocked(admit.admitOnProduce).mockResolvedValueOnce(false);
    await queue.enqueueProcessVerification(job);
    expect(inner.jobs).toEqual([job]);
    expect(vi.mocked(admit.admitOnProduce).mock.calls.at(-1)?.[1]).toEqual({
      queue: 'process-verification',
      environmentId: ENV,
      id: VER,
    });
    await queue.close();
    expect(inner.closed()).toBe(true);
  });

  it('enqueues an admitted report run’s job, and holds one the cap does not admit', async () => {
    const inner = recording<ReportRunJob>();
    const queue = withReportRunAdmission(
      { enqueueReportRun: inner.enqueue, close: inner.close },
      deps,
    );
    const job = { environmentId: ENV, reportId: REP, runId: RPR };
    vi.mocked(admit.admitOnProduce).mockResolvedValueOnce(false);
    await queue.enqueueReportRun(job);
    vi.mocked(admit.admitOnProduce).mockResolvedValueOnce(true);
    await queue.enqueueReportRun(job);
    expect(inner.jobs).toEqual([job]);
    expect(vi.mocked(admit.admitOnProduce).mock.calls.at(-1)?.[1]).toEqual({
      queue: 'report-run',
      environmentId: ENV,
      id: RPR,
    });
  });

  it.each([
    ['container.ts', 'withVerificationAdmission(', 'withReportRunAdmission('],
    ['worker.ts', 'withVerificationAdmission(', 'withReportRunAdmission('],
  ])('%s builds both producers behind the hook', (file, verifications, runs) => {
    const text = source(`./${file}`);
    expect(text).toContain(verifications);
    expect(text).toContain(runs);
  });
});

describe('the audit log’s retention through the migration role’s function (C249.3)', () => {
  it('runAuditLogRetention deletes through openverify_delete_expired_audit_logs, never directly', () => {
    const retention = source('./services/access/audit-retention.ts');
    expect(retention).toContain('deleteExpiredAuditLogs(');
    expect(retention).not.toContain('deleteAuditLogsBefore(');
    const repository = source('../../../packages/db/src/repositories/audit-logs.ts');
    expect(repository).toContain('openverify_delete_expired_audit_logs(');
  });
});
