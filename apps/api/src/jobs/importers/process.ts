/**
 * C100.2 (Workflow 7B): the `list-import` job: reads and decrypts the object, decodes it, parses
 * with `csv-parse`, normalises each row, stages the rows sealed, applies them through
 * `ListItemWriter.insertItems`, and ends the import. Owner: `api-importers`.
 *
 * Staging, the apply and the end are one transaction under the importer's row lock, so a crash
 * leaves no staged row, a second run of one job leaves the row to the first, and a writer that
 * refuses a row of an `all-or-nothing` import undoes every write through a savepoint.
 *
 * Nothing here repeats a value: an error is a code, a row and a column; logs and the audit entry
 * carry counts and codes; and an error from below is replaced before it can reach a job's failure
 * record, because a driver's message can quote what it was given (C100.4).
 */
import {
  beginImportAttempt,
  completeImporter,
  decryptBytes,
  getImportList,
  identifierKey,
  listStagedImportRows,
  lockPendingImporter,
  recordImportErrors,
  recordImportFailure,
  stageImportRows,
  type Db,
  type ImporterOutcome,
  type ImporterRow,
  type ImportList,
  type Keyring,
  type StagedImportRow,
} from '@openverify/db';
import type { ImporterMode } from '@openverify/contracts';
import type { StagedEvent, TransactionalEventPublisher } from '../../events/index.js';
import { stageListUpdated } from '../../workflows/actions/lists/list-updated.js';
import type { Clock, FileStorage, ListImportJob, ListItemWriter } from '../../ports.js';
import { appendSystemAuditEntry } from '../../services/audit-log.js';
import { readImportRow } from '../../services/importers/read-row.js';
import {
  readImportFile,
  type ImportFileError,
  type ImportFileReading,
} from '../../services/importers/read-file.js';
import type { WorkerLogger } from '../logger.js';

export interface ListImportDeps {
  /** C127.12: an import that wrote stages `list.updated` once, when it ends. */
  events: TransactionalEventPublisher;
  db: Db;
  clock: Clock;
  logger: WorkerLogger;
  storage: FileStorage;
  keyring: Keyring;
  blindIndexKey?: Uint8Array | undefined;
  writer: ListItemWriter;
}

/** A run past this many ends the import `errored`, so a broken one cannot retry for ever. */
export const IMPORT_MAX_ATTEMPTS = 10;

/** Rows per staging insert and per call to the writer; the event loop turns between batches. */
const IMPORT_BATCH_ROWS = 1000;

export interface ListImportResult {
  status: 'ready' | 'errored' | 'skipped';
}

export type ProcessListImport = (
  job: ListImportJob,
  deps: ListImportDeps,
) => Promise<ListImportResult>;

const SKIPPED: ListImportResult = { status: 'skipped' };

/** Fails a run for a retry, with a code in place of whatever failed below. */
class ImportRunError extends Error {
  override name = 'ImportRunError';

  constructor(readonly reason: string) {
    super(`The import run failed (${reason})`);
  }
}

/** Rolls the writer's savepoint back: a refused row of an `all-or-nothing` import. */
class ImportRefused extends Error {
  override name = 'ImportRefused';

  constructor(readonly errors: readonly ImportFileError[]) {
    super('The writer refused rows of an all-or-nothing import');
  }
}

function* batches<T>(items: readonly T[]): Generator<readonly T[]> {
  for (let start = 0; start < items.length; start += IMPORT_BATCH_ROWS) {
    yield items.slice(start, start + IMPORT_BATCH_ROWS);
  }
}

/** Whole-file errors first, then rows in file order, as the error route serves them. */
const inRowOrder = (errors: readonly ImportFileError[]): ImportFileError[] =>
  [...errors].sort((a, b) => (a.row ?? 0) - (b.row ?? 0));

interface EndOfImport {
  outcome: ImporterOutcome;
  errors: readonly ImportFileError[];
}

/** Ends the import in `tx`: its errors, its row with the staged rows gone, and a system entry. */
async function endImport(
  tx: Db,
  deps: ListImportDeps,
  { environmentId, importerId }: ListImportJob,
  { outcome, errors }: EndOfImport,
): Promise<void> {
  await recordImportErrors(tx, environmentId, importerId, inRowOrder(errors));
  await completeImporter(tx, environmentId, importerId, outcome);
  const errorCodes = [...new Set(errors.map(({ code }) => code))];
  await appendSystemAuditEntry(tx, environmentId, {
    action: 'importer.completed',
    resourceType: 'importer',
    resourceId: importerId,
    metadata: {
      status: outcome.status,
      'row-count': outcome.rowCount,
      'successful-count': outcome.successfulCount,
      'duplicate-count': outcome.duplicateCount,
      'already-present-count': outcome.alreadyPresentCount,
      'error-count': outcome.errorCount,
      'error-codes': errorCodes,
      ...(outcome.lastErrorCode === undefined ? {} : { reason: outcome.lastErrorCode }),
    },
  });
  deps.logger.info(
    {
      importerId,
      status: outcome.status,
      rowCount: outcome.rowCount,
      successfulCount: outcome.successfulCount,
      duplicateCount: outcome.duplicateCount,
      alreadyPresentCount: outcome.alreadyPresentCount,
      errorCount: outcome.errorCount,
      errorCodes,
      ...(outcome.lastErrorCode === undefined ? {} : { reason: outcome.lastErrorCode }),
    },
    'list import finished',
  );
}

/** Ends an import that says nothing about the file: its object is lost, or its list closed. */
async function endWithoutVerdict(
  job: ListImportJob,
  deps: ListImportDeps,
  reason: string,
): Promise<ListImportResult> {
  const { environmentId, importerId } = job;
  return deps.db.transaction(async (tx) => {
    if ((await lockPendingImporter(tx, environmentId, importerId)) === null) {
      return SKIPPED;
    }
    await endImport(tx, deps, job, {
      errors: [],
      outcome: {
        status: 'errored',
        rowCount: 0,
        successfulCount: 0,
        duplicateCount: 0,
        alreadyPresentCount: 0,
        errorCount: 0,
        at: deps.clock.now(),
        lastErrorCode: reason,
      },
    });
    return { status: 'errored' };
  });
}

/** The file's plaintext, or the reason it can never be read. */
async function openStoredFile(
  importer: ImporterRow,
  deps: ListImportDeps,
): Promise<Uint8Array | { unreadable: string }> {
  if (importer.storageKey === null || importer.wrappedDek === null) {
    return { unreadable: 'object_missing' };
  }
  let ciphertext: Uint8Array | null;
  try {
    ciphertext = await deps.storage.get(importer.storageKey);
  } catch {
    throw new ImportRunError('object_unavailable');
  }
  if (ciphertext === null) {
    return { unreadable: 'object_missing' };
  }
  try {
    return decryptBytes({ wrappedDek: importer.wrappedDek, ciphertext }, deps.keyring, {
      context: importer.id,
    });
  } catch {
    return { unreadable: 'object_unreadable' };
  }
}

interface StagedFile {
  errors: ImportFileError[];
  duplicates: number;
}

/** Normalises each row and stages the good ones, each once. A repeat is counted, not staged. */
async function stageFile(
  tx: Db,
  { environmentId, importerId }: ListImportJob,
  list: ImportList,
  reading: ImportFileReading,
  blindIndexKey: Uint8Array,
): Promise<StagedFile> {
  const errors = [...reading.errors];
  const seen = new Set<string>();
  let duplicates = 0;
  for (const batch of batches(reading.rows)) {
    const rows: StagedImportRow[] = [];
    for (const row of batch) {
      const read = readImportRow(list, row, (kind, input) =>
        identifierKey(blindIndexKey, { environmentId, kind, input }),
      );
      if ('error' in read) {
        errors.push(read.error);
      } else if (seen.has(read.matchKey)) {
        duplicates += 1;
      } else {
        seen.add(read.matchKey);
        rows.push({ row: row.row, value: read.attributes, matchKey: read.matchKey });
      }
    }
    await stageImportRows(tx, environmentId, importerId, rows);
  }
  return { errors, duplicates };
}

interface AppliedRows {
  successful: number;
  alreadyPresent: number;
  errors: ImportFileError[];
}

/** Applies the staged rows batch by batch, in file order. */
async function applyStagedRows(
  tx: Db,
  { environmentId, importerId }: ListImportJob,
  { writer }: ListImportDeps,
  listId: string,
): Promise<AppliedRows> {
  const applied: AppliedRows = { successful: 0, alreadyPresent: 0, errors: [] };
  let afterRow = 0;
  for (;;) {
    const rows = await listStagedImportRows(tx, environmentId, importerId, {
      afterRow,
      limit: IMPORT_BATCH_ROWS,
    });
    const last = rows.at(-1);
    if (last === undefined) {
      return applied;
    }
    const written = await writer.insertItems(tx, {
      environmentId,
      listId,
      items: rows.map(({ value }) => ({
        attributes: value,
        creator: { type: 'importer', id: importerId },
      })),
    });
    applied.successful += written.inserted.length;
    applied.alreadyPresent += written.alreadyPresent;
    for (const { index, code } of written.refused) {
      applied.errors.push({ row: rows[index]?.row ?? null, column: null, code });
    }
    afterRow = last.row;
  }
}

interface ImportContext {
  list: ImportList;
  reading: ImportFileReading;
  blindIndexKey: Uint8Array;
  mode: ImporterMode;
}

/** The whole import, under its row lock. */
async function importInTx(
  tx: Db,
  job: ListImportJob,
  deps: ListImportDeps,
  { list, reading, blindIndexKey, mode }: ImportContext,
  staged: StagedEvent[],
): Promise<ListImportResult> {
  const { environmentId, importerId } = job;
  if ((await lockPendingImporter(tx, environmentId, importerId)) === null) {
    return SKIPPED;
  }
  const stagedFile = await stageFile(tx, job, list, reading, blindIndexKey);
  const { duplicates } = stagedFile;
  let { errors } = stagedFile;
  const refused = reading.refused || (mode === 'all-or-nothing' && errors.length > 0);

  let written: AppliedRows = { successful: 0, alreadyPresent: 0, errors: [] };
  let rolledBack = false;
  if (!refused) {
    try {
      written = await tx.transaction(async (savepoint) => {
        const applied = await applyStagedRows(savepoint, job, deps, list.id);
        if (mode === 'all-or-nothing' && applied.errors.length > 0) {
          throw new ImportRefused(applied.errors);
        }
        return applied;
      });
    } catch (error) {
      if (!(error instanceof ImportRefused)) {
        throw error;
      }
      rolledBack = true;
      errors = [...errors, ...error.errors];
    }
  }
  errors = [...errors, ...written.errors];

  const anyGood = written.successful + written.alreadyPresent > 0;
  const status = refused || rolledBack || (errors.length > 0 && !anyGood) ? 'errored' : 'ready';
  await endImport(tx, deps, job, {
    errors,
    outcome: {
      status,
      rowCount: reading.rowCount,
      successfulCount: written.successful,
      duplicateCount: duplicates,
      alreadyPresentCount: written.alreadyPresent,
      errorCount: errors.length,
      at: deps.clock.now(),
    },
  });
  // C127.12 (F20): once, for the whole import, however many batches it took.
  if (written.successful > 0) {
    staged.push(
      ...(await stageListUpdated(tx, deps, environmentId, [
        { listId: list.id, changeKind: 'items-added', items: written.successful },
      ])),
    );
  }
  return { status };
}

/**
 * C100.2: one run of one import.
 * @throws {ImportRunError} for what a retry can fix: the attempt is recorded and the import stays
 *   pending. Everything that cannot be fixed ends the import instead.
 */
export const processListImport: ProcessListImport = async (job, deps) => {
  const { db, blindIndexKey } = deps;
  const { environmentId, importerId } = job;
  const importer = await beginImportAttempt(db, environmentId, importerId);
  if (importer === null) {
    return SKIPPED;
  }
  if (importer.attempts > IMPORT_MAX_ATTEMPTS) {
    return endWithoutVerdict(job, deps, 'attempts_exhausted');
  }
  if (blindIndexKey === undefined) {
    return endWithoutVerdict(job, deps, 'blind_index_key_missing');
  }
  try {
    const list = await getImportList(db, environmentId, importer.listId);
    if (list === null || list.status === 'archived') {
      return await endWithoutVerdict(job, deps, 'list_archived');
    }
    const file = await openStoredFile(importer, deps);
    if ('unreadable' in file) {
      return await endWithoutVerdict(job, deps, file.unreadable);
    }
    const reading = readImportFile(file, importer.encoding, list.kind);
    const staged: StagedEvent[] = [];
    const result = await db.transaction((tx) =>
      importInTx(tx, job, deps, { list, reading, blindIndexKey, mode: importer.mode }, staged),
    );
    await deps.events.dispatch(staged);
    return result;
  } catch (error) {
    const reason = error instanceof ImportRunError ? error.reason : 'import_failed';
    await recordImportFailure(db, environmentId, importerId, reason);
    deps.logger.warn(
      { importerId, reason, errorName: (error as Error).name },
      'list import failed',
    );
    throw new ImportRunError(reason);
  }
};
