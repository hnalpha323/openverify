/**
 * K8-28 (Workflow 8D; plan item 111): `requeueUnfinishedCaseFileWork` enqueues again, by id, the
 * exports left `pending` or `running`, the scans left `pending` and the renditions left `pending`
 * since before its cutoff, each through its own producer (whose job id is the row's id, so a job
 * still queued is not doubled), and leaves out a kind whose producer the worker does not hold.
 * Synthetic values only.
 */
import {
  createTestDatabase,
  createTestTenant,
  seedCase,
  seedCaseAttachment,
  seedCaseExport,
  seedCaseTemplate,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CaseAttachmentScanJob, CaseExportJob, CaseRenditionJob } from '../../ports.js';
import { requeueUnfinishedCaseFileWork } from './recovery.js';

let database: TestDatabase;
let environmentId: string;
let exportId: string;
let attachmentId: string;
const NOW = new Date('2026-11-03T12:00:00.000Z');
const CUTOFF = new Date(NOW.getTime() - 60_000);

beforeAll(async () => {
  database = await createTestDatabase();
  environmentId = (await createTestTenant(database.db)).environment.id;
  const template = await seedCaseTemplate(database.db, environmentId);
  const { id: caseId } = await seedCase(database.db, environmentId, {
    caseTemplateId: template.id,
    caseTemplateVersionId: template.versionId,
    key: template.key,
    number: 1,
  });
  ({ id: exportId } = await seedCaseExport(database.db, environmentId));
  ({ id: attachmentId } = await seedCaseAttachment(database.db, environmentId, { caseId }));
  const old = new Date(NOW.getTime() - 10 * 60_000);
  await database.client.query(
    `update case_exports set status = 'running', created_at = $2, updated_at = $2 where id = $1`,
    [exportId, old],
  );
  await database.client.query(
    `update case_attachments set scan_status = 'pending', scan_provider = 'sandbox',
       created_at = $2, updated_at = $2 where id = $1`,
    [attachmentId, old],
  );
}, 120_000);

afterAll(async () => {
  await database.close();
});

function producers() {
  const exports: CaseExportJob[] = [];
  const scans: CaseAttachmentScanJob[] = [];
  const renditions: CaseRenditionJob[] = [];
  return {
    exports,
    scans,
    renditions,
    queues: {
      exports: {
        enqueueCaseExport: (job: CaseExportJob) => Promise.resolve(void exports.push(job)),
      },
      scans: {
        enqueueCaseAttachmentScan: (job: CaseAttachmentScanJob) =>
          Promise.resolve(void scans.push(job)),
      },
      renditions: {
        enqueueCaseRendition: (job: CaseRenditionJob) => Promise.resolve(void renditions.push(job)),
      },
    },
  };
}

describe('requeueUnfinishedCaseFileWork (K8-28)', () => {
  it('enqueues the unfinished export, scan and rendition again by id', async () => {
    const recorded = producers();

    const counts = await requeueUnfinishedCaseFileWork(
      { db: database.db, ...recorded.queues },
      CUTOFF,
    );

    expect(counts).toEqual({ exports: 1, scans: 1, renditions: 1 });
    expect(recorded.exports).toEqual([{ environmentId, caseExportId: exportId }]);
    expect(recorded.scans).toEqual([{ environmentId, caseAttachmentId: attachmentId }]);
    expect(recorded.renditions).toEqual([{ environmentId, sourceId: attachmentId }]);
  });

  it('leaves out a kind whose producer it was not given', async () => {
    const recorded = producers();

    const counts = await requeueUnfinishedCaseFileWork(
      { db: database.db, exports: recorded.queues.exports },
      CUTOFF,
    );

    expect(counts).toEqual({ exports: 1, scans: 0, renditions: 0 });
    expect(recorded.scans).toEqual([]);
  });
});
