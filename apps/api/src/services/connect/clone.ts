/**
 * C234.3, C234.4, C234.11, C235.1, C235.2 (Workflow 11A, `api-redeem`): writing a clone in the
 * destination environment, inside the redeem job's one transaction. Every row written here is in the
 * caller's own (destination) environment; the source's rows arrive already read through the
 * cross-tenant module (`readRedemptionSource`, rule 20(a)) and already filtered by the token's policy
 * version (`shareableContent`): this module copies only what `shared` names.
 *
 * - **A verification** becomes a new `ver_` row on the destination inquiry, with its source's type,
 *   status, country, ID class and times (`completed_at` is the source's decision, which C235.4's age
 *   reads), and `provenance` (`connect-clone`, `cloned: true` beside it in every served form).
 * - **Its checks** (only with `check-results`, the policy's names) keep ADR 0002's labels as the
 *   source recorded them: status, type, requirement, reasons, metadata, stage, confidence and
 *   `provenance`; `connect_provenance` says they are a clone (C235.2).
 * - **Its files** (only with `files`, the policy's kinds, never a face template) are decrypted under
 *   the source's data key and re-encrypted under a new data key as a new object, the file id the
 *   context (C234.3); the object is put before the row, so a rolled-back transaction leaves only an
 *   unreadable object behind (the new row held its only key), which `storageKeys` names for removal.
 * - **Its extracted data** (only with `extracted-data`): a government ID's extraction (sealed for the
 *   new verification, with no identification-number index and no front hash, so the clone joins no
 *   repeat or same-number search in the destination: ours, as a cloned selfie gets no face template)
 *   and a document's extraction. A type whose extracted data is not copied here is named in
 *   `extractionsNotCopied` (counts only).
 *
 * Never written: a face template or its background row, a report link, a signal, a session record,
 * a device fact, a note or a tag, a flow step record, a case or a workflow run of the source (C234.3,
 * Stage 1a amendment 17). No `verification.*` or check event is staged for a clone (C235.7(a)): the
 * destination learns of it through `connect/share-token.inbound-redeemed` with `redeem-summary`.
 */
import { createHash } from 'node:crypto';
import type { SharedVerification } from '@openverify/core';
import {
  createGovernmentIdExtraction,
  getDocumentExtraction,
  getGovernmentIdExtraction,
  getVerification,
  listVerificationFiles,
  openDocumentExtractionFields,
  decryptBytes,
  encryptBytes,
  files,
  putDocumentExtraction,
  verificationChecks,
  verifications,
  type Db,
  type DocumentExtractionInput,
  type Keyring,
  type NewGovernmentIdExtractionInput,
  type VerificationCheck,
} from '@openverify/db';
import type { FileStorage, IdGenerator } from '../../ports.js';
import { newStorageKey } from '../../storage/index.js';

/** The C235.1 clone provenance of one copied object (the builders are `connect-logic`'s). */
export type CloneProvenanceOf = (source: {
  createdAt: Date;
  status: string;
}) => Record<string, unknown>;

/** A source file as the copy needs it: its row, never shown to anyone. */
export interface SourceFileMaterial {
  id: string;
  kind: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  storageKey: string;
  wrappedDek: string;
  createdAt: Date;
}

/** A source check row (ADR 0002's labels included). */
export type SourceCheckMaterial = Pick<
  VerificationCheck,
  | 'name'
  | 'status'
  | 'type'
  | 'requirement'
  | 'reasons'
  | 'metadata'
  | 'stage'
  | 'confidence'
  | 'provenance'
  | 'createdAt'
>;

/** A source verification as the copy needs it, read through the cross-tenant module. */
export interface SourceVerificationMaterial {
  id: string;
  type: string;
  status: string;
  country: string | null;
  idClass: string | null;
  submittedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  checks: readonly SourceCheckMaterial[];
  files: readonly SourceFileMaterial[];
  /** A government ID's extraction, opened; `null` when it has none or it was redacted. */
  governmentIdExtraction?: Pick<
    NewGovernmentIdExtractionInput,
    'fields' | 'fieldSources' | 'idClassGroup'
  > | null;
  /** A document's extraction, opened; `null` when it has none or it was redacted. */
  documentExtraction?: Omit<DocumentExtractionInput, 'verificationId' | 'inquiryId'> | null;
}

/** What the clone writes with. */
export interface CloneWriter {
  tx: Db;
  /** The destination environment (the caller's). */
  environmentId: string;
  storage: FileStorage;
  keyring: Keyring;
  ids: IdGenerator;
  provenanceOf: CloneProvenanceOf;
  /** Whether the policy version shares extracted data (`verifications.extracted-data`). */
  extractedData: boolean;
}

/** C234.8: what one clone wrote (counts and object keys; never a value). */
export interface CloneCounts {
  verifications: number;
  checks: number;
  files: number;
  fileBytes: number;
  /** Verification types whose extracted data this module does not copy (counts only). */
  extractionsNotCopied: string[];
  /** Objects put in storage, to delete if the transaction rolls back. */
  storageKeys: string[];
}

export const emptyCloneCounts = (): CloneCounts => ({
  verifications: 0,
  checks: 0,
  files: 0,
  fileBytes: 0,
  extractionsNotCopied: [],
  storageKeys: [],
});

/** The types whose extracted data has a writer here; the others' is counted as not copied. */
const EXTRACTION_TYPES: ReadonlySet<string> = new Set(['government_id', 'document']);

/**
 * C234.3, C234.4: copies the shared verifications onto `inquiryId` (a destination inquiry), in the
 * order `shared` lists them. A shared verification without its material is a defect of the read and
 * throws (the job then ends `unrecoverable_error`).
 */
export async function cloneVerificationsInTx(
  writer: CloneWriter,
  inquiryId: string,
  shared: readonly SharedVerification[],
  material: ReadonlyMap<string, SourceVerificationMaterial>,
): Promise<CloneCounts> {
  const counts = emptyCloneCounts();
  for (const verification of shared) {
    const source = material.get(verification.id);
    if (source === undefined) {
      throw new Error('the redemption read holds no material for a shared verification');
    }
    await cloneOneInTx(writer, inquiryId, verification, source, counts);
  }
  counts.extractionsNotCopied = [...new Set(counts.extractionsNotCopied)].sort();
  return counts;
}

async function cloneOneInTx(
  writer: CloneWriter,
  inquiryId: string,
  shared: SharedVerification,
  source: SourceVerificationMaterial,
  counts: CloneCounts,
): Promise<void> {
  const { tx, environmentId } = writer;
  const id = writer.ids.newId('ver');
  await tx.insert(verifications).values({
    id,
    environmentId,
    inquiryId,
    type: source.type as typeof verifications.$inferInsert.type,
    status: source.status as typeof verifications.$inferInsert.status,
    country: source.country,
    idClass: source.idClass as typeof verifications.$inferInsert.idClass,
    submittedAt: source.submittedAt,
    completedAt: source.completedAt,
    // A clone needs no capture to be read: it is never submitted or processed again.
    selfieCaptureRequired: false,
    provenance: writer.provenanceOf(source) as typeof verifications.$inferInsert.provenance,
  });
  counts.verifications += 1;

  const checkNames = new Set(shared.checks.map(({ name }) => name));
  const checks = source.checks.filter(({ name }) => checkNames.has(name));
  if (checks.length > 0) {
    await tx.insert(verificationChecks).values(
      checks.map((check) => ({
        environmentId,
        verificationId: id,
        name: check.name,
        status: check.status,
        type: check.type,
        requirement: check.requirement,
        reasons: [...check.reasons],
        metadata: check.metadata,
        stage: check.stage,
        confidence: check.confidence,
        provenance: check.provenance,
        connectProvenance: writer.provenanceOf({
          createdAt: check.createdAt,
          status: check.status,
        }) as typeof verificationChecks.$inferInsert.connectProvenance,
      })),
    );
    counts.checks += checks.length;
  }

  const fileIds = new Set(shared.files.map((file) => file.id));
  for (const file of source.files.filter((candidate) => fileIds.has(candidate.id))) {
    counts.fileBytes += await cloneFileInTx(writer, id, file, counts);
    counts.files += 1;
  }

  if (writer.extractedData) {
    await cloneExtractionInTx(writer, id, inquiryId, source, counts);
  }
}

/** Re-encrypts one file under a new data key as a new object (C234.3); answers its byte size. */
async function cloneFileInTx(
  writer: CloneWriter,
  verificationId: string,
  file: SourceFileMaterial,
  counts: CloneCounts,
): Promise<number> {
  const ciphertext = await writer.storage.get(file.storageKey);
  if (ciphertext === null) {
    throw new Error('a shared file has no stored object');
  }
  const plaintext = decryptBytes({ ciphertext, wrappedDek: file.wrappedDek }, writer.keyring, {
    context: file.id,
  });
  try {
    const digest = createHash('sha256').update(plaintext).digest('hex');
    if (digest !== file.sha256) {
      throw new Error('a shared file does not match its digest');
    }
    const id = writer.ids.newId('file');
    const storageKey = newStorageKey(writer.environmentId);
    const sealed = encryptBytes(plaintext, writer.keyring, { context: id });
    await writer.storage.put(storageKey, sealed.ciphertext);
    counts.storageKeys.push(storageKey);
    await writer.tx.insert(files).values({
      id,
      environmentId: writer.environmentId,
      verificationId,
      kind: file.kind as typeof files.$inferInsert.kind,
      storageKey,
      mimeType: file.mimeType,
      byteSize: plaintext.byteLength,
      sha256: digest,
      wrappedDek: sealed.wrappedDek,
      provenance: writer.provenanceOf({
        createdAt: file.createdAt,
        status: 'stored',
      }) as typeof files.$inferInsert.provenance,
    });
    return plaintext.byteLength;
  } finally {
    plaintext.fill(0);
  }
}

async function cloneExtractionInTx(
  writer: CloneWriter,
  verificationId: string,
  inquiryId: string,
  source: SourceVerificationMaterial,
  counts: CloneCounts,
): Promise<void> {
  if (!EXTRACTION_TYPES.has(source.type)) {
    counts.extractionsNotCopied.push(source.type);
    return;
  }
  if (source.type === 'government_id' && source.governmentIdExtraction != null) {
    await createGovernmentIdExtraction(writer.tx, writer.environmentId, {
      verificationId,
      fields: source.governmentIdExtraction.fields,
      fieldSources: source.governmentIdExtraction.fieldSources,
      identificationNumberIndex: null,
      frontPhash: null,
      idClassGroup: source.governmentIdExtraction.idClassGroup,
    });
  }
  if (source.type === 'document' && source.documentExtraction != null) {
    await putDocumentExtraction(writer.tx, writer.environmentId, {
      ...source.documentExtraction,
      verificationId,
      inquiryId,
    });
  }
}

/** C234.2: the copy's material of a share's verifications, by source verification id. */
export interface RedemptionMaterial {
  verifications: ReadonlyMap<string, SourceVerificationMaterial>;
}

/**
 * C234.2: the material of the copy (the rows a clone writes from) of `verificationIds` of one
 * environment, read at the redemption. An ordinary environment-scoped read, like `api-connect`'s
 * `loadShareSource`: the redeem job reaches the source environment only through `cross-tenant.ts`'s
 * `readRedemptionSource`, which calls this with a token already bound to its destination (rule
 * 20(a)). A redacted extraction is left out (`null`); a file deleted by redaction is left out.
 */
export async function loadRedemptionMaterial(
  db: Db,
  environmentId: string,
  verificationIds: readonly string[],
): Promise<RedemptionMaterial> {
  const stored = await listVerificationFiles(db, environmentId, verificationIds);
  const verifications = new Map<string, SourceVerificationMaterial>();
  for (const id of verificationIds) {
    const row = await getVerification(db, environmentId, id);
    if (row === null) {
      continue;
    }
    const extraction =
      row.type === 'government_id' ? await getGovernmentIdExtraction(db, environmentId, id) : null;
    const document =
      row.type === 'document' ? await getDocumentExtraction(db, environmentId, id) : null;
    const documentFields =
      document?.redactedAt !== null
        ? null
        : await openDocumentExtractionFields(db, environmentId, id);
    verifications.set(id, {
      id: row.id,
      type: row.type,
      status: row.status,
      country: row.country,
      idClass: row.idClass,
      submittedAt: row.submittedAt,
      completedAt: row.completedAt,
      createdAt: row.createdAt,
      checks: row.checks,
      files: stored
        .filter((file) => file.verificationId === id && file.deletedAt === null)
        .map((file) => ({
          id: file.id,
          kind: file.kind,
          mimeType: file.mimeType,
          byteSize: file.byteSize,
          sha256: file.sha256,
          storageKey: file.storageKey,
          wrappedDek: file.wrappedDek,
          createdAt: file.createdAt,
        })),
      governmentIdExtraction:
        extraction?.redactedAt !== null || extraction.fields === null
          ? null
          : {
              fields: extraction.fields,
              fieldSources: extraction.fieldSources,
              idClassGroup: extraction.idClassGroup,
            },
      documentExtraction:
        document === null || documentFields === null
          ? null
          : {
              documentType: document.documentType,
              typeConfidence: document.typeConfidence,
              fields: documentFields,
              pageCount: document.pageCount,
              mimeType: document.mimeType,
            },
    });
  }
  return { verifications };
}
