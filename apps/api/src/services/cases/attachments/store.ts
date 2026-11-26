/**
 * C135.1, C135.2, C135.5 (Workflow 8B, `api-case-files`): what both uploads share, the multipart route
 * and the public PATCH.
 *
 * - The type is the bytes' (JPEG, PNG, WebP or PDF by their magic bytes), never the client's word,
 *   and must be one the case's pinned version takes (`attachment-policy.types`), else 422
 *   `attachment_type_refused`; a case holds at most `attachment-policy.max-files` (at most 20), counted
 *   under the case row's lock, else 422 `case_attachment_limit`.
 * - The object is sealed with `encryptBytes` (the attachment id as its context) under a key from
 *   `newStorageKey`, so no client name reaches a key, a path or a header; the name is sealed for the
 *   row. A redacted case takes none (410 `case_redacted`, from the caller's lock).
 * - With a scanner bound for the environment's kind it is `pending`; with none, `not_scanned`.
 * - The history row names the attachment's id alone (C131.4).
 */
import { createHash } from 'node:crypto';
import { detectUploadMimeType } from '@openverify/contracts';
import {
  CASE_ATTACHMENT_MEDIA_TYPES,
  CASE_ATTACHMENT_TYPES,
  CASE_LIMITS,
  type CaseAttachmentType,
} from '@openverify/core';
import {
  appendCaseHistory,
  countCaseAttachments,
  createCaseAttachmentRow,
  encryptBytes,
  getCaseTemplateVersionRow,
  type CaseAttachment,
  type Db,
} from '@openverify/db';
import { newStorageKey } from '../../../storage/index.js';
import type { ApiDependencies } from '../../context.js';
import { CaseProblemError } from '../problems.js';

/** What storing needs beyond the transaction. */
export type AttachmentStoreDeps = Pick<
  ApiDependencies,
  'keyring' | 'storage' | 'ids' | 'attachmentScanners'
>;

/** The uploader of an attachment. */
export interface AttachmentUploader {
  type: 'user' | 'api-key' | 'workflow-run';
  id: string;
}

/** A version's attachment policy, with C130.2's default where it holds none. */
export interface AttachmentPolicy {
  maxFiles: number;
  types: readonly CaseAttachmentType[];
}

const DEFAULT_FILENAME = 'attachment';
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

/** A filename the row can hold: control characters removed, 1 to 255 characters. */
export function cleanFilename(filename: string): string {
  let cleaned = filename
    .replace(CONTROL_CHARACTERS, '')
    .trim()
    .slice(0, CASE_LIMITS['filename-characters'].value);
  if (/[\ud800-\udbff]$/.test(cleaned)) {
    cleaned = cleaned.slice(0, -1);
  }
  return cleaned === '' ? DEFAULT_FILENAME : cleaned;
}

/** The attachment type of a media type the four types hold. */
export function attachmentTypeOf(mediaType: string): CaseAttachmentType | null {
  return (
    CASE_ATTACHMENT_TYPES.find((type) => CASE_ATTACHMENT_MEDIA_TYPES[type] === mediaType) ?? null
  );
}

/** C130.2: the pinned version's policy. */
export async function attachmentPolicyOf(
  db: Db,
  environmentId: string,
  versionId: string,
): Promise<AttachmentPolicy> {
  const version = await getCaseTemplateVersionRow(db, environmentId, versionId);
  const stored = version?.attachmentPolicy as
    { 'max-files'?: number; types?: CaseAttachmentType[] } | null | undefined;
  return {
    maxFiles: Math.min(
      stored?.['max-files'] ?? CASE_LIMITS['attachments-per-case'].value,
      CASE_LIMITS['attachments-per-case'].value,
    ),
    types: stored?.types ?? CASE_ATTACHMENT_TYPES,
  };
}

/**
 * The bytes' type when the policy takes it.
 * @throws {CaseProblemError} `attachment_type_refused`, at `pointer` when one is given.
 */
export function typedBytes(
  bytes: Uint8Array,
  policy: AttachmentPolicy,
  pointer?: string,
): { mediaType: string; type: CaseAttachmentType } {
  const sniffed = bytes.byteLength === 0 ? null : detectUploadMimeType('document', bytes);
  const type = sniffed === null ? null : attachmentTypeOf(sniffed);
  if (sniffed === null || type === null || !policy.types.includes(type)) {
    const detail = 'The file’s content is not of a type this case takes.';
    throw new CaseProblemError('attachment_type_refused', detail, {
      ...(pointer === undefined ? {} : { errors: [{ location: 'body', pointer, detail }] }),
    });
  }
  return { mediaType: sniffed, type };
}

/** C135.5: the scanner bound for the environment's kind, by name; `null` reads `none`. */
export const scannerOf = (
  deps: Pick<ApiDependencies, 'attachmentScanners'>,
  environmentKind: 'sandbox' | 'production',
): 'sandbox' | 'clamd' | null => deps.attachmentScanners?.[environmentKind] ?? null;

/** A sealed object put in storage, not yet written to a row. */
export interface SealedAttachment {
  id: string;
  storageKey: string;
  wrappedDek: string;
  sha256: string;
  byteSize: number;
}

/** Seals `bytes` under a new id and key and puts the object. */
export async function sealAttachment(
  deps: AttachmentStoreDeps,
  environmentId: string,
  bytes: Uint8Array,
): Promise<SealedAttachment> {
  const id = deps.ids.newId('catt');
  const storageKey = newStorageKey(environmentId);
  const sealed = encryptBytes(bytes, deps.keyring, { context: id });
  await deps.storage.put(storageKey, sealed.ciphertext);
  return {
    id,
    storageKey,
    wrappedDek: sealed.wrappedDek,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteSize: bytes.byteLength,
  };
}

/**
 * Writes the row of a sealed object and its history row, the case's row already locked; the cap is
 * counted here, under that lock.
 * @throws {CaseProblemError} `case_attachment_limit`.
 */
export async function writeAttachmentInTx(
  tx: Db,
  input: {
    environmentId: string;
    environmentKind: 'sandbox' | 'production';
    caseId: string;
    policy: AttachmentPolicy;
    sealed: SealedAttachment;
    mediaType: string;
    filename: string;
    uploader: AttachmentUploader;
    requestId?: string | undefined;
  },
  deps: Pick<ApiDependencies, 'attachmentScanners'>,
): Promise<CaseAttachment> {
  const { environmentId, caseId, sealed } = input;
  if ((await countCaseAttachments(tx, environmentId, caseId)) >= input.policy.maxFiles) {
    throw new CaseProblemError(
      'case_attachment_limit',
      `A case of this template holds at most ${String(input.policy.maxFiles)} attachments.`,
    );
  }
  const provider = scannerOf(deps, input.environmentKind);
  const made = await createCaseAttachmentRow(tx, environmentId, {
    id: sealed.id,
    caseId,
    mimeType: input.mediaType,
    byteSize: sealed.byteSize,
    filename: cleanFilename(input.filename),
    sha256: sealed.sha256,
    storageKey: sealed.storageKey,
    wrappedDek: sealed.wrappedDek,
    uploader: input.uploader,
    scanStatus: provider === null ? 'not_scanned' : 'pending',
    scanProvider: provider,
  });
  await appendCaseHistory(tx, environmentId, [
    {
      caseId,
      kind: 'attachment-added',
      actorType: input.uploader.type,
      actorId: input.uploader.id,
      to: { 'attachment-id': made.id },
      requestId: input.requestId ?? null,
    },
  ]);
  return made;
}
