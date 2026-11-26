import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../client.js';
import type { FileCaptureMethod, FileCaptureTrigger } from '@openverify/core';
import { files, verifications, type FileKind, type StoredFile } from '../schema.js';
import { firstOrNull, inserted } from './rows.js';

export interface NewFileInput {
  id: string;
  verificationId: string;
  kind: FileKind;
  /** S3 key of the `encryptBytes` ciphertext. */
  storageKey: string;
  mimeType: string;
  /** Plaintext size in bytes. */
  byteSize: number;
  /** SHA-256 of the plaintext, lowercase hex. */
  sha256: string;
  /** `encryptBytes(...).wrappedDek`; use the file id as the encryption context. */
  wrappedDek: string;
  /** C40.3: the selfie capture a pose belongs to (selfie kinds only). */
  selfieCaptureId?: string | null;
  /** C40.3: the client's milliseconds since the capture was created, 0-600,000. */
  clientElapsedMs?: number | null;
  /** C40.3: when the server received the pose, from its clock inside the write transaction. */
  receivedAt?: Date | null;
  /** C153.2 (Workflow 9A Stage 1b (F)): the upload's `capture-method`; left out, `null`. */
  captureMethod?: FileCaptureMethod | null;
  /** C206.2 (Workflow 10B Stage 1b (C)): the upload's `capture-trigger`; left out, `null`. */
  captureTrigger?: FileCaptureTrigger | null;
}

export async function createFile(
  db: Db,
  environmentId: string,
  input: NewFileInput,
): Promise<StoredFile> {
  const rows = await db
    .insert(files)
    .values({
      id: input.id,
      environmentId,
      verificationId: input.verificationId,
      kind: input.kind,
      storageKey: input.storageKey,
      mimeType: input.mimeType,
      byteSize: input.byteSize,
      sha256: input.sha256,
      wrappedDek: input.wrappedDek,
      selfieCaptureId: input.selfieCaptureId ?? null,
      clientElapsedMs: input.clientElapsedMs ?? null,
      receivedAt: input.receivedAt ?? null,
      captureMethod: input.captureMethod ?? null,
      captureTrigger: input.captureTrigger ?? null,
    })
    .returning();
  return inserted(rows, 'createFile');
}

export interface ReplacedVerificationFile {
  file: StoredFile;
  /**
   * The earlier files of the same kind, whose rows are gone. Their stored objects are no
   * longer referenced: delete them (without its row's wrapped key an object cannot be read).
   */
  replaced: StoredFile[];
}

/**
 * Stores `input` as the verification's file of its kind while the verification is still
 * `initiated` (C3: files change only before submitting). In one transaction it locks the
 * verification row, deletes any earlier file of the kind and inserts the new one, so a
 * concurrent upload or submit is serialized with it (last write wins).
 * Returns `null`, having written nothing, when the verification is not in this environment
 * or is no longer `initiated`.
 */
export async function replaceVerificationFile(
  db: Db,
  environmentId: string,
  input: NewFileInput,
): Promise<ReplacedVerificationFile | null> {
  return db.transaction(async (tx) => {
    const verification = firstOrNull(
      await tx
        .select({ status: verifications.status })
        .from(verifications)
        .where(
          and(
            eq(verifications.id, input.verificationId),
            eq(verifications.environmentId, environmentId),
          ),
        )
        .for('update'),
    );
    if (verification?.status !== 'initiated') {
      return null;
    }
    const replaced = await tx
      .delete(files)
      .where(
        and(
          eq(files.environmentId, environmentId),
          eq(files.verificationId, input.verificationId),
          eq(files.kind, input.kind),
        ),
      )
      .returning();
    return { file: await createFile(tx, environmentId, input), replaced };
  });
}

export async function getFile(
  db: Db,
  environmentId: string,
  id: string,
): Promise<StoredFile | null> {
  return firstOrNull(
    await db
      .select()
      .from(files)
      .where(and(eq(files.id, id), eq(files.environmentId, environmentId)))
      .limit(1),
  );
}

/** The files of the given verifications, oldest first (C4 inquiry detail). */
export async function listVerificationFiles(
  db: Db,
  environmentId: string,
  verificationIds: readonly string[],
): Promise<StoredFile[]> {
  if (verificationIds.length === 0) {
    return [];
  }
  return db
    .select()
    .from(files)
    .where(
      and(
        eq(files.environmentId, environmentId),
        inArray(files.verificationId, [...verificationIds]),
      ),
    )
    .orderBy(asc(files.createdAt), asc(files.id));
}

/**
 * C16: marks files whose objects were deleted from storage. Returns how many rows changed;
 * files already marked are left as they are.
 */
export async function markFilesDeleted(
  db: Db,
  environmentId: string,
  fileIds: readonly string[],
  at: Date = new Date(),
): Promise<number> {
  if (fileIds.length === 0) {
    return 0;
  }
  const rows = await db
    .update(files)
    .set({ deletedAt: at })
    .where(
      and(
        eq(files.environmentId, environmentId),
        inArray(files.id, [...fileIds]),
        isNull(files.deletedAt),
      ),
    )
    .returning({ id: files.id });
  return rows.length;
}

/** C52.4: the kinds only the server writes, never a client upload. */
export const SERVER_WRITTEN_FILE_KINDS: readonly FileKind[] = Object.freeze([
  'document-preview',
  'chip-portrait',
]);

/**
 * C54.1 (`storeServerFile`): stores `input` as the verification's file of a server-written kind
 * (`document-preview`, `chip-portrait`), whatever the verification's status, deleting any earlier
 * file of the kind in the same statement order, so every re-run of a job leaves one. Returns the
 * file and the replaced rows, whose objects the caller deletes after commit.
 * @throws {RangeError} for a kind a client uploads.
 */
export async function replaceServerWrittenFile(
  db: Db,
  environmentId: string,
  input: NewFileInput,
): Promise<ReplacedVerificationFile> {
  if (!SERVER_WRITTEN_FILE_KINDS.includes(input.kind)) {
    throw new RangeError(`A ${input.kind} file is uploaded by a client, not written by the server`);
  }
  return db.transaction(async (tx) => {
    const replaced = await tx
      .delete(files)
      .where(
        and(
          eq(files.environmentId, environmentId),
          eq(files.verificationId, input.verificationId),
          eq(files.kind, input.kind),
        ),
      )
      .returning();
    return { file: await createFile(tx, environmentId, input), replaced };
  });
}
