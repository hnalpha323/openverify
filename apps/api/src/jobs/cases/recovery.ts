/**
 * K8-28 (Workflow 8D; plan item 111): the case file work a lost enqueue or a crashed worker left
 * unfinished, enqueued again by id from `case-export-sweep`, as `case-bulk-sweep` does for bulk
 * actions. Each queue's job id is the row's id, so a job still queued or running is not doubled.
 */
import {
  listPendingCaseAttachmentScans,
  listPendingRenditionSources,
  listUnfinishedCaseExports,
  type Db,
} from '@openverify/db';
import type { CaseAttachmentScanQueue, CaseExportQueue, CaseRenditionQueue } from '../../ports.js';

export interface CaseFileRecoveryDeps {
  db: Db;
  exports?: CaseExportQueue | undefined;
  scans?: CaseAttachmentScanQueue | undefined;
  renditions?: CaseRenditionQueue | undefined;
}

export interface CaseFileRecovery {
  exports: number;
  scans: number;
  renditions: number;
}

/** Enqueues again what was left unfinished before `before`, at most `limit` of each kind. */
export async function requeueUnfinishedCaseFileWork(
  deps: CaseFileRecoveryDeps,
  before: Date,
  limit = 500,
): Promise<CaseFileRecovery> {
  const counts: CaseFileRecovery = { exports: 0, scans: 0, renditions: 0 };
  const { exports, scans, renditions } = deps;
  if (exports !== undefined) {
    for (const row of await listUnfinishedCaseExports(deps.db, before, limit)) {
      await exports.enqueueCaseExport({ environmentId: row.environmentId, caseExportId: row.id });
      counts.exports += 1;
    }
  }
  if (scans !== undefined) {
    for (const row of await listPendingCaseAttachmentScans(deps.db, before, limit)) {
      await scans.enqueueCaseAttachmentScan({
        environmentId: row.environmentId,
        caseAttachmentId: row.id,
      });
      counts.scans += 1;
    }
  }
  if (renditions !== undefined) {
    for (const row of await listPendingRenditionSources(deps.db, before, limit)) {
      await renditions.enqueueCaseRendition(row);
      counts.renditions += 1;
    }
  }
  return counts;
}
