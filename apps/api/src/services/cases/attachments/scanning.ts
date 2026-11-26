/**
 * C135.5 (Workflow 8B, `api-case-files`; decision 66, P23, H20): the `case-attachment-scan` job's work,
 * and the serving rule every read of an attachment applies.
 *
 * - The scanner is the one the worker binds for the attachment's environment kind. When none is bound
 *   there, or a different provider from the one the upload named (the API and the worker read
 *   different settings), the attachment stays `pending`, never served, and the job says so in the log.
 * - A scan that answers `error`, or fails, is tried again, at most three attempts in all
 *   (`scan-attempts`), and then stays `error`. Its verdict is written only while the attachment is
 *   still `pending` and not redacted, with a history row naming the attachment's id and the verdict.
 * - Serving: `not_scanned` (no scanner) and `clean` are served; `pending` answers 409
 *   `attachment_scan_pending`; `infected` 409 `attachment_infected`; `error` 409 with no code of its
 *   own (C129.7 names none for it), never served, only redacted.
 */
import { CASE_LIMITS } from '@openverify/core';
import {
  appendCaseHistory,
  getCaseAttachmentRow,
  getEnvironment,
  recordCaseAttachmentScan,
  type CaseAttachment,
  type Db,
  type Keyring,
} from '@openverify/db';
import type { WorkerLogger } from '../../../jobs/logger.js';
import type { Clock, FileStorage, ProviderBindings } from '../../../ports.js';
import { CaseProblemError } from '../problems.js';
import { ObjectUnreadableError, openSealedObject } from './objects.js';

export interface ScanJobDeps {
  db: Db;
  storage: FileStorage;
  keyring: Keyring;
  clock: Clock;
  logger: Pick<WorkerLogger, 'warn' | 'error'>;
  providers?: ProviderBindings | undefined;
}

/** C135.5: at most three attempts, then `error` stays. */
export const SCAN_ATTEMPTS = CASE_LIMITS['scan-attempts'].value;

/**
 * C135.5: whether a reader may be served the attachment, by its scan.
 * @throws {CaseProblemError} `attachment_scan_pending`, `attachment_infected` or, for a scan that
 *   ended in `error`, `attachment_scan_failed` (409; K8-27).
 */
export function assertServable(attachment: Pick<CaseAttachment, 'scanStatus'>): void {
  switch (attachment.scanStatus) {
    case 'not_scanned':
    case 'clean':
      return;
    case 'pending':
      throw new CaseProblemError(
        'attachment_scan_pending',
        'The attachment is still being scanned; ask again shortly.',
        { headers: { 'retry-after': '5' } },
      );
    case 'infected':
      throw new CaseProblemError(
        'attachment_infected',
        'The scanner found malware in this attachment; it is never served.',
      );
    case 'error':
      // K8-27 (Workflow 9B, contracts B41): named.
      throw new CaseProblemError(
        'attachment_scan_failed',
        'The attachment could not be scanned after three attempts; it is never served.',
      );
  }
}

/** Scans one attachment; one gone, redacted or no longer pending is left as it is. */
export async function scanAttachment(
  deps: ScanJobDeps,
  environmentId: string,
  attachmentId: string,
): Promise<void> {
  const row = await getCaseAttachmentRow(deps.db, environmentId, attachmentId);
  if (row === null) {
    return;
  }
  if (
    row.scanStatus !== 'pending' ||
    row.redactedAt !== null ||
    row.storageKey === null ||
    row.wrappedDek === null
  ) {
    return;
  }
  const environment = await getEnvironment(deps.db, environmentId);
  const scanner =
    environment === null ? undefined : deps.providers?.[environment.kind].attachmentScanner;
  if (scanner?.provider !== row.scanProvider) {
    deps.logger.warn(
      { attachmentId, provider: row.scanProvider },
      'no attachment scanner of this provider is bound here; the scan stays pending',
    );
    return;
  }
  let bytes: Buffer;
  try {
    bytes = await openSealedObject(deps, {
      storageKey: row.storageKey,
      wrappedDek: row.wrappedDek,
      context: row.id,
      byteSize: row.byteSize,
      sha256: row.sha256,
    });
  } catch (error) {
    if (!(error instanceof ObjectUnreadableError)) {
      throw error;
    }
    deps.logger.error({ attachmentId }, 'attachment object is unreadable; it is not scanned');
    return;
  }
  let attempts = row.scanAttempts;
  let verdict: 'clean' | 'infected' | 'error' = 'error';
  try {
    while (attempts < SCAN_ATTEMPTS) {
      attempts += 1;
      try {
        verdict = (await scanner.scan({ attachmentId, bytes })).verdict;
      } catch {
        verdict = 'error';
      }
      if (verdict !== 'error') {
        break;
      }
    }
  } finally {
    bytes.fill(0);
  }
  const at = deps.clock.now();
  await deps.db.transaction(async (tx) => {
    const recorded = await recordCaseAttachmentScan(tx, environmentId, attachmentId, {
      status: verdict,
      scannedAt: at,
      attempts,
    });
    if (recorded !== null) {
      await appendCaseHistory(tx, environmentId, [
        {
          caseId: recorded.caseId,
          kind: 'attachment-scanned',
          actorType: 'system',
          actorId: null,
          to: { 'attachment-id': attachmentId, 'scan-status': verdict },
        },
      ]);
    }
  });
}
