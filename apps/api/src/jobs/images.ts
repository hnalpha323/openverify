/**
 * The uploaded images a job sends to vision: decrypted from storage (`FileStorage` +
 * `decryptBytes`, the file id as context), checked against their stored SHA-256 and type, and
 * wiped after use. Images are never stored decrypted or logged.
 */
import { createHash } from 'node:crypto';
import { detectImageMimeType } from '@openverify/contracts';
import { decryptBytes, type FileKind, type Keyring, type StoredFile } from '@openverify/db';
import type { FileStorage, VisionImage } from '../ports.js';
import { PermanentJobError } from './errors.js';

export interface ImageDeps {
  storage: FileStorage;
  /** Unwraps the files' data keys. */
  keyring: Keyring;
}

/** The most recent upload of `kind` (files are listed oldest first). */
export const latestOfKind = (
  files: readonly StoredFile[],
  kind: FileKind,
): StoredFile | undefined => files.filter((file) => file.kind === kind).at(-1);

/**
 * The decrypted image of `file`.
 * @throws {PermanentJobError} `file_missing`, `file_undecryptable`, `file_integrity` or
 * `file_type`: retrying cannot bring a file back.
 */
export async function decryptImage(deps: ImageDeps, file: StoredFile): Promise<VisionImage> {
  const ciphertext = await deps.storage.get(file.storageKey);
  if (ciphertext === null) {
    throw new PermanentJobError('file_missing');
  }
  let bytes: Buffer;
  try {
    bytes = decryptBytes({ wrappedDek: file.wrappedDek, ciphertext }, deps.keyring, {
      context: file.id,
    });
  } catch {
    throw new PermanentJobError('file_undecryptable');
  }
  const mimeType = detectImageMimeType(bytes);
  const intact = createHash('sha256').update(bytes).digest('hex') === file.sha256;
  if (!intact || mimeType === null) {
    bytes.fill(0);
    throw new PermanentJobError(intact ? 'file_type' : 'file_integrity');
  }
  return { bytes, mimeType };
}

/**
 * The decrypted image of an earlier verification's `file`, or `null` when it can no longer be
 * read (deleted by redaction or retention, or damaged): a lookup over history never fails the
 * current verification for an old file (C31.9). Wipe the bytes after use.
 */
export async function readStoredImage(
  deps: ImageDeps,
  file: StoredFile,
): Promise<VisionImage | null> {
  try {
    return await decryptImage(deps, file);
  } catch (error) {
    if (error instanceof PermanentJobError) {
      return null;
    }
    throw error;
  }
}

/** Decrypts `files`, runs `use`, then overwrites the plaintext, whatever happened. */
export async function withImages<T>(
  deps: ImageDeps,
  files: readonly [StoredFile, ...StoredFile[]],
  use: (images: readonly [VisionImage, ...VisionImage[]]) => Promise<T>,
): Promise<T> {
  const images: VisionImage[] = [];
  try {
    for (const file of files) {
      images.push(await decryptImage(deps, file));
    }
    return await use(images as [VisionImage, ...VisionImage[]]);
  } finally {
    for (const image of images) {
      image.bytes.fill(0);
    }
  }
}
