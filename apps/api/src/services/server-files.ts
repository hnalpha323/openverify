/**
 * C54.1: `storeServerFile`, how a job stores a file it made (a document's `document-preview`, a
 * chip's `chip-portrait`, C60.4, C62.6): a PNG, sealed with its own data key (`encryptBytes`, the
 * file id as context) under a new random key, its row written in `tx` in place of the kind's
 * earlier file, so every re-run of a job leaves exactly one. The object is put before the row;
 * should `tx` roll back, the object stays unreadable (its wrapped key went with the row). The
 * replaced files' objects are returned, to delete once `tx` committed.
 */
import { createHash } from 'node:crypto';
import { detectUploadMimeType, newId, type FileKind } from '@openverify/contracts';
import {
  encryptBytes,
  replaceServerWrittenFile,
  type Db,
  type Keyring,
  type StoredFile,
} from '@openverify/db';
import type { FileStorage } from '../ports.js';
import { deleteRenditionsForFilesInTx } from './cases/attachments/renditions.js';
import { newStorageKey } from '../storage/index.js';

/** The kinds only the server writes (C52.4). */
export type ServerWrittenFileKind = Extract<FileKind, 'document-preview' | 'chip-portrait'>;

export interface ServerFileInput {
  environmentId: string;
  verificationId: string;
  kind: ServerWrittenFileKind;
  /** The PNG the job made. */
  bytes: Uint8Array;
}

export interface StoredServerFile {
  file: StoredFile;
  /** Objects of the replaced files, to delete once the transaction committed. */
  replacedStorageKeys: string[];
}

/**
 * Stores a server-written file in `tx` (see the header).
 * @throws {RangeError} when `bytes` is not a PNG.
 */
export async function storeServerFile(
  tx: Db,
  deps: { storage: FileStorage; keyring: Keyring },
  input: ServerFileInput,
): Promise<StoredServerFile> {
  const mimeType = detectUploadMimeType(input.kind, input.bytes);
  if (mimeType === null) {
    throw new RangeError(`A ${input.kind} file is a PNG image`);
  }
  const id = newId('file');
  const storageKey = newStorageKey(input.environmentId);
  const sealed = encryptBytes(input.bytes, deps.keyring, { context: id });
  await deps.storage.put(storageKey, sealed.ciphertext);
  const stored = await replaceServerWrittenFile(tx, input.environmentId, {
    id,
    verificationId: input.verificationId,
    kind: input.kind,
    storageKey,
    mimeType,
    byteSize: input.bytes.byteLength,
    sha256: createHash('sha256').update(input.bytes).digest('hex'),
    wrappedDek: sealed.wrappedDek,
  });
  // C135.3 (Stage 1a amendment 9; `api-case-files`): a replaced file's rendition pages go with it.
  const renditionKeys = await deleteRenditionsForFilesInTx(tx, {
    environmentId: input.environmentId,
    fileIds: stored.replaced.map((file) => file.id),
  });
  return {
    file: stored.file,
    replacedStorageKeys: [...stored.replaced.map((file) => file.storageKey), ...renditionKeys],
  };
}
