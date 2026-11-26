/**
 * C105.4 (Workflow 7B): `transaction_files`, a `file` field's envelope object. Owner:
 * `api-transactions`; `foundation-7b` (Stage 1b (T)) built what the C16 pass reads
 * ({@link listRedactedTransactionFiles}, {@link markTransactionFilesDeleted}) and
 * {@link toTransactionFile}.
 *
 * The object is sealed with `encryptBytes`, the row's id as its context, and `filename` for its row
 * as `transaction_files.filename#<id>`.
 */
import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { SEALED } from '../encrypted-columns.js';
import { openOptional, sealValue } from '../sealed.js';
import { transactionFiles, type TransactionFileRow } from '../schema.js';
import { firstOrNull, inserted } from './rows.js';

/** A file with its name opened; `filename` is `null` once redacted. */
export interface TransactionFile extends Omit<TransactionFileRow, 'filenameSealed'> {
  filename: string | null;
}

export interface NewTransactionFile {
  id: string;
  transactionId: string;
  fieldKey: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  storageKey: string;
  wrappedDek: string;
}

/** The file of a row, its name opened. */
export function toTransactionFile(row: TransactionFileRow): TransactionFile {
  const { filenameSealed, ...rest } = row;
  return {
    ...rest,
    filename: openOptional(SEALED.transactionFileFilename, row.id, filenameSealed),
  };
}

/**
 * Writes the row in the field's transaction. A field's last file is redacted first, not marked
 * deleted: `deleted_at` means the object is gone, and the row keeps the wrapped key until then, so
 * the caller reads it beforehand, deletes its object after the commit and then marks it, and the
 * C16 purge finishes a delete that failed (owner decision 9 after Workflow 7B).
 */
export async function createTransactionFile(
  tx: Db,
  environmentId: string,
  input: NewTransactionFile,
): Promise<TransactionFile> {
  await tx
    .update(transactionFiles)
    .set({ filenameSealed: null, redactedAt: sql`now()` })
    .where(
      and(
        eq(transactionFiles.environmentId, environmentId),
        eq(transactionFiles.transactionId, input.transactionId),
        eq(transactionFiles.fieldKey, input.fieldKey),
        isNull(transactionFiles.deletedAt),
        isNull(transactionFiles.redactedAt),
      ),
    );
  return toTransactionFile(
    inserted(
      await tx
        .insert(transactionFiles)
        .values({
          id: input.id,
          environmentId,
          transactionId: input.transactionId,
          fieldKey: input.fieldKey,
          filenameSealed: sealValue(SEALED.transactionFileFilename, input.id, input.filename),
          mimeType: input.mimeType,
          byteSize: input.byteSize,
          sha256: input.sha256,
          storageKey: input.storageKey,
          wrappedDek: input.wrappedDek,
        })
        .returning(),
      'createTransactionFile',
    ),
  );
}

export async function getTransactionFile(
  db: Db,
  environmentId: string,
  transactionId: string,
  id: string,
): Promise<TransactionFile | null> {
  const row = firstOrNull(
    await db
      .select()
      .from(transactionFiles)
      .where(
        and(
          eq(transactionFiles.environmentId, environmentId),
          eq(transactionFiles.transactionId, transactionId),
          eq(transactionFiles.id, id),
        ),
      )
      .limit(1),
  );
  return row === null ? null : toTransactionFile(row);
}

/** Each live file of the transaction, by field key. */
export async function listTransactionFiles(
  db: Db,
  environmentId: string,
  transactionId: string,
): Promise<TransactionFile[]> {
  const rows = await db
    .select()
    .from(transactionFiles)
    .where(
      and(
        eq(transactionFiles.environmentId, environmentId),
        eq(transactionFiles.transactionId, transactionId),
        isNull(transactionFiles.deletedAt),
        isNull(transactionFiles.redactedAt),
      ),
    )
    .orderBy(asc(transactionFiles.fieldKey));
  return rows.map(toTransactionFile);
}

/** A redacted transaction's file whose object is not gone yet (C105.5). */
export interface RedactedTransactionFile {
  id: string;
  environmentId: string;
  storageKey: string;
}

/**
 * C105.5: the files whose object a redaction or a replacement could not delete from storage, across
 * environments, oldest first: the C16 pass deletes them.
 */
export async function listRedactedTransactionFiles(
  db: Db,
  options: { limit: number },
): Promise<RedactedTransactionFile[]> {
  return db
    .select({
      id: transactionFiles.id,
      environmentId: transactionFiles.environmentId,
      storageKey: transactionFiles.storageKey,
    })
    .from(transactionFiles)
    .where(and(isNotNull(transactionFiles.redactedAt), isNull(transactionFiles.deletedAt)))
    .orderBy(asc(transactionFiles.redactedAt), asc(transactionFiles.id))
    .limit(options.limit);
}

/**
 * Marks the files whose objects were deleted from storage, and answers how many it marked.
 * Idempotent; keeps the first time.
 */
export async function markTransactionFilesDeleted(
  db: Db,
  environmentId: string,
  ids: readonly string[],
  at: Date = new Date(),
): Promise<number> {
  if (ids.length === 0) {
    return 0;
  }
  const rows = await db
    .update(transactionFiles)
    .set({ deletedAt: at })
    .where(
      and(
        eq(transactionFiles.environmentId, environmentId),
        inArray(transactionFiles.id, [...ids]),
        isNull(transactionFiles.deletedAt),
      ),
    )
    .returning({ id: transactionFiles.id });
  return rows.length;
}
