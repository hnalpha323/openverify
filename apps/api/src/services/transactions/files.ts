/**
 * C105.2 (Workflow 7B; P12, P22): one `file` field's content, and reading it back. Owner:
 * `api-transactions`.
 *
 * The upload reads the transaction's pinned version before it touches the body: only then does it
 * know the field's `max-file-size-bytes`, which it hands to {@link TransactionFileUpload.parts} and
 * enforces with the parser's byte counter (413 `transaction_file_too_large`). Below the minimum, of
 * a type the field does not take (read from the bytes' signature, never the client's word), or
 * past its page count, a file answers 422 `transaction_file_refused`; a PDF whose pages cannot be
 * counted is refused rather than passed. Workflow 11B: a PDF's pages are counted by vision's
 * guarded child (`page-count.ts`), only for a field that limits pages; while vision cannot count,
 * the upload answers a retryable 503, never a pass. A `write_once` field already holding a file answers 409
 * `field_write_once`. The object is sealed with `encryptBytes` (the row's id as its context) and
 * written before the row; a replaced file's object is deleted after the commit.
 *
 * The content route serves `transaction_files` only, never a `platform-file`, audits the view
 * before any byte is sent, and answers 410 `transaction_redacted` once the transaction or the file
 * was redacted.
 */
import { createHash } from 'node:crypto';
import type { Multipart } from '@fastify/multipart';
import { detectUploadMimeType, type TransactionDocument } from '@openverify/contracts';
import { TRANSACTION_LIMITS, type FieldSchema } from '@openverify/core';
import {
  createTransactionFile,
  decryptBytes,
  encryptBytes,
  getTransaction,
  getTransactionFile,
  listTransactionFiles,
  markTransactionFilesDeleted,
  type TransactionFile,
  lockTransaction,
  updateTransaction as writeTransaction,
  type Db,
} from '@openverify/db';
import {
  BadRequestError,
  NotFoundError,
  TransactionProblemError,
  UnsupportedMediaTypeError,
} from '../../errors.js';
import { newStorageKey } from '../../storage/index.js';
import { auditEntryOf, type ApiDependencies } from '../context.js';
import type { TransactionActing } from './acting.js';
import { countTransactionPdfPages } from './page-count.js';
import { transactionResource } from './resources.js';
import { change, requireTransactionTypeVersion } from './shared.js';
import { UNMASKED } from '../../auth/pii.js';

/** The request's body, unread until {@link parts} is called. */
export interface TransactionFileUpload {
  /** The multipart parts, with the field's cap: the stream ends at `limits.fileSize`. */
  parts(limits: { fileSize: number }): AsyncIterableIterator<Multipart>;
}

/** The decrypted content, as the route sends it (`no-store`, `nosniff`). */
export interface TransactionFileContent {
  bytes: Uint8Array;
  mimeType: string;
}

/** The multipart part that carries the content. */
const FILE_PART = 'file';
const DEFAULT_FILENAME = 'file';

const redacted = (detail: string) => new TransactionProblemError('transaction_redacted', detail);

const refused = (detail: string) => new TransactionProblemError('transaction_file_refused', detail);

/** The pinned version's top-level `file` field of this key, or a refusal at the param. */
function fileFieldOf(fieldSchemas: readonly FieldSchema[], fieldKey: string): FieldSchema {
  const field = fieldSchemas.find((candidate) => candidate.key === fieldKey);
  if (field?.type !== 'file') {
    throw new TransactionProblemError(
      'field_schema_invalid',
      'The transaction’s version has no file field of this key.',
      {
        errors: [
          { location: 'params', pointer: '/fieldKey', detail: 'Not a file field of the version.' },
        ],
      },
    );
  }
  return field;
}

function writtenOnce(field: FieldSchema): boolean {
  return field.config?.['write-policy'] === 'write_once';
}

const numberOf = (config: Readonly<Record<string, unknown>>, key: string): number | undefined => {
  const value = config[key];
  return typeof value === 'number' ? value : undefined;
};

/** The one file part's bytes, read under the cap. */
async function readFilePart(
  upload: TransactionFileUpload,
  maxBytes: number,
): Promise<{ bytes: Buffer; filename: string }> {
  let found: { bytes: Buffer; filename: string } | undefined;
  try {
    for await (const part of upload.parts({ fileSize: maxBytes })) {
      if (part.type !== 'file' || part.fieldname !== FILE_PART || found !== undefined) {
        throw new BadRequestError(
          `The form takes one file part named "${FILE_PART}" and nothing else.`,
        );
      }
      found = { bytes: await part.toBuffer(), filename: part.filename };
    }
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === 'FST_REQ_FILE_TOO_LARGE') {
      throw new TransactionProblemError(
        'transaction_file_too_large',
        'The file is larger than this field takes.',
      );
    }
    if (code === 'FST_INVALID_MULTIPART_CONTENT_TYPE') {
      throw new UnsupportedMediaTypeError('The request must be multipart/form-data.');
    }
    throw error;
  }
  if (found === undefined) {
    throw new BadRequestError(`The form needs a file part named "${FILE_PART}".`);
  }
  return found;
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

/** A filename the value can hold: control characters removed, 1-255 characters. */
function cleanFilename(filename: string): string {
  let cleaned = filename.replace(CONTROL_CHARACTERS, '').trim().slice(0, 255);
  if (/[\ud800-\udbff]$/.test(cleaned)) {
    cleaned = cleaned.slice(0, -1);
  }
  return cleaned === '' ? DEFAULT_FILENAME : cleaned;
}

/** C104.2: the field's own rules on the bytes; the MIME type is the signature's. */
async function checkedMimeType(
  field: FieldSchema,
  bytes: Uint8Array,
  vision: ApiDependencies['vision'],
): Promise<string> {
  const config = (field.config ?? {}) as Readonly<Record<string, unknown>>;
  const minBytes =
    numberOf(config, 'min-file-size-bytes') ?? TRANSACTION_LIMITS.fileDefaultMinBytes;
  if (bytes.byteLength < minBytes) {
    throw refused('The file is smaller than this field takes.');
  }
  const sniffed = detectUploadMimeType('document', bytes);
  const supported = config['supported-mime-types'];
  if (Array.isArray(supported) && (sniffed === null || !supported.includes(sniffed))) {
    throw refused('The file’s content is not of a type this field takes.');
  }
  if (config['page-count-limit-enabled'] === true) {
    // Workflow 11B: counted by vision's guarded child; it refuses or answers 503, never 0.
    const pages = sniffed === 'application/pdf' ? await countTransactionPdfPages(vision, bytes) : 1;
    const min = numberOf(config, 'page-count-min') ?? 1;
    const max = numberOf(config, 'page-count-max') ?? Number.POSITIVE_INFINITY;
    if (pages === 0 || pages < min || pages > max) {
      throw refused('The file’s page count is outside what this field takes, or unreadable.');
    }
  }
  return sniffed ?? 'application/octet-stream';
}

async function liveFileOf(tx: Db, environmentId: string, transactionId: string, fieldKey: string) {
  return (await listTransactionFiles(tx, environmentId, transactionId)).find(
    (file) => file.fieldKey === fieldKey,
  );
}

export async function putTransactionFile(
  deps: ApiDependencies,
  acting: TransactionActing,
  id: string,
  fieldKey: string,
  upload: TransactionFileUpload,
): Promise<TransactionDocument> {
  const { environmentId } = acting.ctx;
  const current = await getTransaction(deps.db, environmentId, id);
  if (current === null) {
    throw new NotFoundError(`Transaction ${id} was not found.`);
  }
  if (current.redactedAt !== null) {
    throw redacted(`Transaction ${id} was redacted; it takes no file.`);
  }
  const version = await requireTransactionTypeVersion(
    deps.db,
    environmentId,
    current.transactionTypeVersionId,
  );
  const field = fileFieldOf(version.fieldSchemas as readonly FieldSchema[], fieldKey);
  const writeOnce = () => {
    throw new TransactionProblemError(
      'field_write_once',
      `The field ${fieldKey} is written once and already holds a file.`,
    );
  };
  if (writtenOnce(field) && (await liveFileOf(deps.db, environmentId, id, fieldKey))) {
    writeOnce();
  }
  const config = (field.config ?? {}) as Readonly<Record<string, unknown>>;
  const maxBytes =
    numberOf(config, 'max-file-size-bytes') ?? TRANSACTION_LIMITS.fileDefaultMaxBytes;
  const { bytes, filename } = await readFilePart(upload, maxBytes);
  const mimeType = await checkedMimeType(field, bytes, deps.vision);
  const fileId = deps.ids.newId('txnf');
  const storageKey = newStorageKey(environmentId);
  const sealed = encryptBytes(bytes, deps.keyring, { context: fileId });
  await deps.storage.put(storageKey, sealed.ciphertext);
  const outcome: { replaced: TransactionFile | null } = { replaced: null };
  let updated;
  try {
    updated = await change(deps, acting, async ({ tx, emit, audit }) => {
      const locked = await lockTransaction(tx, environmentId, id);
      if (locked === null) {
        throw new NotFoundError(`Transaction ${id} was not found.`);
      }
      if (locked.redactedAt !== null) {
        throw redacted(`Transaction ${id} was redacted; it takes no file.`);
      }
      const previous = await liveFileOf(tx, environmentId, id, fieldKey);
      if (previous !== undefined && writtenOnce(field)) {
        writeOnce();
      }
      outcome.replaced = previous ?? null;
      const name = cleanFilename(filename);
      const file = await createTransactionFile(tx, environmentId, {
        id: fileId,
        transactionId: id,
        fieldKey,
        filename: name,
        mimeType,
        byteSize: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        storageKey,
        wrappedDek: sealed.wrappedDek,
      });
      const fields = {
        ...(locked.fields ?? {}),
        [fieldKey]: {
          type: 'file',
          value: {
            'file-id': file.id,
            filename: name,
            'byte-size': file.byteSize,
            'mime-type': file.mimeType,
          },
        },
      };
      const written = (await writeTransaction(tx, environmentId, id, { fields })) ?? locked;
      await emit('transaction.updated-fields', {
        data: await transactionResource(tx, environmentId, written, {
          mask: UNMASKED,
          forEvent: true,
        }),
      });
      await audit({
        action: 'transaction-file.uploaded',
        resourceType: 'transaction-file',
        resourceId: file.id,
        metadata: {
          'transaction-id': id,
          'field-key': fieldKey,
          'mime-type': file.mimeType,
          'byte-size': file.byteSize,
        },
      });
      return written;
    });
  } catch (error) {
    await deps.storage.delete(storageKey);
    throw error;
  }
  if (outcome.replaced !== null) {
    await deleteReplacedObject(deps, environmentId, outcome.replaced);
  }
  return {
    data: await transactionResource(deps.db, environmentId, updated, { mask: acting.mask }),
  };
}

/**
 * Owner decision 9 after Workflow 7B: deletes a replaced file's object, then marks its row, because
 * `deleted_at` means the object is gone. A delete that fails leaves the row redacted and undeleted,
 * so the C16 purge finishes it, and a transaction's redaction reaches it.
 */
async function deleteReplacedObject(
  deps: ApiDependencies,
  environmentId: string,
  replaced: { id: string; storageKey: string },
): Promise<void> {
  try {
    await deps.storage.delete(replaced.storageKey);
  } catch {
    return;
  }
  await markTransactionFilesDeleted(deps.db, environmentId, [replaced.id], deps.clock.now());
}

/**
 * C105.2 (P12): `transaction_files` only, never a `platform-file`. Audited before any byte is sent,
 * as `file.viewed` is; a redacted file answers 410 `transaction_redacted`.
 */
export async function readTransactionFile(
  deps: ApiDependencies,
  acting: TransactionActing,
  id: string,
  fileId: string,
): Promise<TransactionFileContent> {
  const { environmentId } = acting.ctx;
  const transaction = await getTransaction(deps.db, environmentId, id);
  const file =
    transaction === null ? null : await getTransactionFile(deps.db, environmentId, id, fileId);
  if (transaction === null || file === null) {
    throw new NotFoundError('No file with this id exists on this transaction.');
  }
  if (transaction.redactedAt !== null) {
    throw redacted('This file was removed when its transaction was redacted.');
  }
  // A replaced file is redacted until its object is gone, then deleted too (owner decision 9).
  if (file.deletedAt !== null || file.redactedAt !== null) {
    throw new NotFoundError('This file was replaced; its content is no longer held.');
  }
  const ciphertext = await deps.storage.get(file.storageKey);
  if (ciphertext === null) {
    throw new NotFoundError('The content of this file is not available.');
  }
  const bytes = decryptBytes({ wrappedDek: file.wrappedDek, ciphertext }, deps.keyring, {
    context: file.id,
  });
  await deps.audit.record(
    deps.db,
    auditEntryOf(acting.ctx, acting.actor, {
      action: 'transaction-file.viewed',
      resourceType: 'transaction-file',
      resourceId: file.id,
      metadata: { 'transaction-id': id, 'field-key': file.fieldKey },
    }),
  );
  return { bytes, mimeType: file.mimeType };
}
