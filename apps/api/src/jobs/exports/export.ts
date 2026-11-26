/**
 * C166.1, C166.3, C166.6 (Workflow 9B): the `export` job, one per `exports` row. Owner: `api-exports`;
 * `foundation-9b` (Stage 1b (X)) froze the queue (`jobs/export-queues.ts`) and the worker's
 * registration.
 *
 * - One job claims a pending export (`FOR UPDATE SKIP LOCKED`, a 15-minute lease, so a stopped worker's
 *   export is claimed again when the sweep enqueues it), notes the cut (`cut-at`, the export's point in
 *   time), and reads the list page by page under its sealed filter (`services/exports/rows.ts`).
 * - At most `EXPORT_LIMITS.rows` rows and `EXPORT_BYTE_LIMIT` bytes: past either the export fails with
 *   `export_too_large`, written as soon as a page passes it, never truncated.
 * - The columns the creating key's attribute blocklist names are dropped (C169.3).
 * - The CSV goes through Phase 7's neutralising writer, is sealed (the export's id as its context)
 *   and kept 24 hours; the completion drops the request (P19). A failure records its code
 *   (`export_too_large`, else `export_failed`) and deletes a file already put. Nothing here logs a
 *   value.
 */
import { EXPORT_LIMITS } from '@openverify/core';
import {
  claimExportRow,
  completeExportRow,
  encryptBytes,
  failExportRow,
  type Db,
  type Keyring,
} from '@openverify/db';
import type { TransactionalEventPublisher } from '../../events/index.js';
import type { Clock, ExportJob, FileStorage } from '../../ports.js';
import { blockExportColumns } from '../../services/api-keys/blocklist.js';
import { exportReader, headerText, keepColumns, type Cell } from '../../services/exports/rows.js';
import type { ExportRequest } from '../../services/exports/service.js';
import { newStorageKey } from '../../storage/index.js';
import { writeCsv } from '@openverify/checks';
import type { WorkerLogger } from '../logger.js';

/** What the `export` job reads. */
export interface ExportJobDeps {
  db: Db;
  storage: FileStorage;
  keyring: Keyring;
  /** The blind-index key (`OPENVERIFY_BLIND_INDEX_KEY`) a string filter's HMAC needs. */
  blindIndexKey?: Uint8Array | undefined;
  events: TransactionalEventPublisher;
  clock: Clock;
  logger: WorkerLogger;
  /** Replaces `EXPORT_BYTE_LIMIT`, for tests. */
  exportByteLimit?: number | undefined;
}

export type ProcessExport = (job: ExportJob, deps: ExportJobDeps) => Promise<void>;

/** The `reason` the stub failed with, kept for the worker's tests. */
export const EXPORT_NOT_BUILT = 'export_not_built';

/** A failure no problem code names: the job could not write the file. */
export const EXPORT_FAILED = 'export_failed';

/**
 * Ours, provisional: the bytes one file may hold, a bound on the job's memory (the file is written
 * whole, as Phase 8's case exports, whose 64 MiB it shares; C138.1, R006).
 */
export const EXPORT_BYTE_LIMIT = 67_108_864;

/** How long a file is kept (`EXPORT_LIMITS['retention-hours']`). */
export const EXPORT_KEPT_MS = EXPORT_LIMITS['retention-hours'] * 60 * 60 * 1000;

/** The export would pass its row or byte cap: recorded as `export_too_large`. */
export class ExportTooLargeError extends Error {
  override name = 'ExportTooLargeError';
}

function requestOf(request: Readonly<Record<string, unknown>> | null): ExportRequest {
  const value = request as Partial<ExportRequest> | null;
  return { filter: value?.filter ?? {}, blocklist: value?.blocklist ?? [] };
}

/** The CSV of the whole export, page by page, counted against both caps as it is written. */
async function cutCsv(
  deps: ExportJobDeps,
  environmentId: string,
  objectType: Parameters<typeof exportReader>[2],
  request: ExportRequest,
  includePersonalData: boolean,
): Promise<{ text: string; rowCount: number }> {
  const reader = await exportReader(
    { db: deps.db, blindIndexKey: deps.blindIndexKey },
    environmentId,
    objectType,
    request.filter,
    includePersonalData,
  );
  const header = blockExportColumns(reader.header, request.blocklist);
  const keep = keepColumns(reader.header, header);
  const head = headerText(header);
  const limit = deps.exportByteLimit ?? EXPORT_BYTE_LIMIT;
  const parts = [head];
  let bytes = Buffer.byteLength(head, 'utf8');
  let rowCount = 0;
  let after: string | undefined;
  for (;;) {
    const page = await reader.page(after);
    rowCount += page.rows.length;
    if (rowCount > EXPORT_LIMITS.rows) {
      throw new ExportTooLargeError('the export passes its row cap');
    }
    if (page.rows.length > 0) {
      const text = writeCsv(
        header,
        page.rows.map((row: Cell[]) => keep(row)),
      ).slice(head.length);
      bytes += Buffer.byteLength(text, 'utf8');
      if (bytes > limit) {
        throw new ExportTooLargeError('the export passes its byte limit');
      }
      parts.push(text);
    }
    if (page.next === null) {
      return { text: parts.join(''), rowCount };
    }
    after = page.next;
  }
}

/** Runs one export; one already claimed, finished or gone is left as it is. */
export async function runExport(
  deps: ExportJobDeps,
  environmentId: string,
  exportId: string,
): Promise<void> {
  const claimed = await deps.db.transaction((tx) =>
    claimExportRow(tx, environmentId, exportId, { now: deps.clock.now() }),
  );
  if (claimed === null) {
    return;
  }
  let storageKey: string | null = null;
  try {
    const cutAt = deps.clock.now();
    const { text, rowCount } = await cutCsv(
      deps,
      environmentId,
      claimed.objectType,
      requestOf(claimed.request),
      claimed.includePersonalData,
    );
    const bytes = Buffer.from(text, 'utf8');
    const sealed = encryptBytes(bytes, deps.keyring, { context: exportId });
    storageKey = newStorageKey(environmentId);
    await deps.storage.put(storageKey, sealed.ciphertext);
    const completedAt = deps.clock.now();
    const key = storageKey;
    const done = await deps.db.transaction((tx) =>
      completeExportRow(tx, environmentId, exportId, {
        rowCount,
        byteSize: bytes.byteLength,
        storageKey: key,
        wrappedDek: sealed.wrappedDek,
        cutAt,
        completedAt,
        expiresAt: new Date(completedAt.getTime() + EXPORT_KEPT_MS),
      }),
    );
    if (done === null) {
      throw new Error('the export was finished elsewhere');
    }
  } catch (error) {
    deps.logger.error(
      { exportId, error: error instanceof Error ? error.name : 'unknown' },
      'export failed',
    );
    const code = error instanceof ExportTooLargeError ? 'export_too_large' : EXPORT_FAILED;
    await deps.db.transaction((tx) =>
      failExportRow(tx, environmentId, exportId, code, deps.clock.now()),
    );
    if (storageKey !== null) {
      await deps.storage.delete(storageKey).catch(() => undefined);
    }
  }
}

export const processExport: ProcessExport = (job, deps) =>
  runExport(deps, job.environmentId, job.exportId);
