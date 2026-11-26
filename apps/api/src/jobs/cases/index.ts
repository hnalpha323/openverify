/**
 * C135.3, C135.5, C138.1, C143.1, C143.2 (Workflow 8B (F)): the case file jobs, each a processor of its
 * queue (`jobs/case-file-queues.ts`), and the `case-export-sweep`. Owner `api-case-files`;
 * `foundation-8b` froze the names and registered them in `startWorkers` with the case options.
 *
 * Each job carries ids alone and reads its row again; a row gone, redacted or no longer waiting is
 * left as it is, so a repeated or late job does nothing.
 */
import type { Db, Keyring } from '@openverify/db';
import type { TransactionalEventPublisher } from '../../events/index.js';
import type {
  CaseAttachmentScanJob,
  CaseExportJob,
  CaseRenditionJob,
  Clock,
  FileStorage,
  ProviderBindings,
  VisionClient,
} from '../../ports.js';
import { renderSource } from '../../services/cases/attachments/rendering.js';
import { scanAttachment } from '../../services/cases/attachments/scanning.js';
import { runCaseExport } from '../../services/cases/exports/job.js';
import type { WorkerLogger } from '../logger.js';

/** What the case file jobs read. */
export interface CaseFileJobDeps {
  db: Db;
  storage: FileStorage;
  keyring: Keyring;
  vision: VisionClient;
  events: TransactionalEventPublisher;
  clock: Clock;
  logger: WorkerLogger;
  /** C135.5: the scanner bound per environment kind (`attachmentScanner`); none when absent. */
  providers?: ProviderBindings | undefined;
  /** R006: the most an export's file may hold; `CASE_LIMITS['export-bytes']` when absent (tests). */
  exportByteLimit?: number | undefined;
}

/** C138.1: writes one export's file (CSV or JSON) and fires `case.exported` per case. */
export type ProcessCaseExport = (job: CaseExportJob, deps: CaseFileJobDeps) => Promise<void>;
export const processCaseExport: ProcessCaseExport = (job, deps) =>
  runCaseExport(deps, job.environmentId, job.caseExportId);

/** C135.5: scans one attachment with the bound scanner, retrying an `error` up to 3 times. */
export type ProcessCaseAttachmentScan = (
  job: CaseAttachmentScanJob,
  deps: CaseFileJobDeps,
) => Promise<void>;
export const processCaseAttachmentScan: ProcessCaseAttachmentScan = (job, deps) =>
  scanAttachment(deps, job.environmentId, job.caseAttachmentId);

/** C135.3: renders one source, an inquiry's file or an attachment, on the vision rendition lane. */
export type ProcessCaseRendition = (job: CaseRenditionJob, deps: CaseFileJobDeps) => Promise<void>;
export const processCaseRendition: ProcessCaseRendition = (job, deps) =>
  renderSource(deps, job.environmentId, job.sourceId);
