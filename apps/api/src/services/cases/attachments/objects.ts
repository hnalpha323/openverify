/**
 * C135 (Workflow 8B, `api-case-files`): reading a sealed object back. AES-GCM authenticates the whole
 * object before any byte is released, under the context it was sealed for (an attachment's or a
 * file's id, or a page's `<source>/<page>`), and an original must then have its recorded size and
 * SHA-256. A missing or altered object is an {@link ObjectUnreadableError}, never served; its message
 * names no byte.
 */
import { createHash } from 'node:crypto';
import { decryptBytes, type Keyring } from '@openverify/db';
import type { FileStorage } from '../../../ports.js';

/** An object that is gone from storage, or fails its checks. */
export class ObjectUnreadableError extends Error {
  override name = 'ObjectUnreadableError';
}

export interface SealedObject {
  storageKey: string;
  wrappedDek: string;
  /** The encryption context it was sealed for. */
  context: string;
  /** The recorded plaintext size and digest, when the row holds them. */
  byteSize?: number | undefined;
  sha256?: string | null | undefined;
}

/** The object's plaintext, authenticated and checked against its row. */
export async function openSealedObject(
  deps: { storage: FileStorage; keyring: Keyring },
  object: SealedObject,
): Promise<Buffer> {
  const ciphertext = await deps.storage.get(object.storageKey);
  if (ciphertext === null) {
    throw new ObjectUnreadableError('the stored object is missing');
  }
  let bytes: Buffer;
  try {
    bytes = decryptBytes({ wrappedDek: object.wrappedDek, ciphertext }, deps.keyring, {
      context: object.context,
    });
  } catch {
    throw new ObjectUnreadableError('the stored object failed its authentication');
  }
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (
    (object.byteSize !== undefined && bytes.byteLength !== object.byteSize) ||
    (object.sha256 != null && digest !== object.sha256)
  ) {
    bytes.fill(0);
    throw new ObjectUnreadableError('the stored object is not what its row records');
  }
  return bytes;
}
