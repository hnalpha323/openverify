/**
 * C40 and C42 shared repository functions: the selfie capture transitions both the flow API
 * (`api-flow`) and the worker (`api-worker`) call, the replay lookup, the face templates and
 * background rows, and the deletion of an inquiry's face data. Written and tested in Workflow 4A
 * Stage 1; Stage 3 does not change their signatures.
 *
 * Callers hold the C40.6 lock order: the inquiry (`redacted_at` re-checked), then the
 * verification, then the capture. Every transition is a conditional update, so a racing writer
 * finds nothing to change (`null`) instead of overwriting.
 *
 * Never returned: the nonce digest (only {@link lockSelfieCapture} reads it, to compare it in
 * constant time) and the device snapshot (only {@link openSelfieCaptureDevice}, for the worker).
 */
import { and, asc, desc, eq, inArray, isNull, ne, notInArray, or, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { withSensitiveParameters } from '../errors.js';
import { SEALED } from '../encrypted-columns.js';
import { openJson, openValue, sealJson, sealValue } from '../sealed.js';
import {
  faceTemplates,
  files,
  inquiries,
  selfieBackgrounds,
  selfieCaptures,
  type SelfieCaptureRow,
  type StoredFile,
  type StoredSelfieCaptureErrorCode,
  type StoredSelfieCaptureStatus,
  type StoredSelfiePose,
  verifications,
} from '../schema.js';
import { firstOrNull, inserted } from './rows.js';

/** A capture as callers see it: no nonce digest, no device snapshot. */
export interface SelfieCapture {
  id: string;
  environmentId: string;
  verificationId: string;
  inquiryId: string;
  status: StoredSelfieCaptureStatus;
  method: 'camera' | 'upload';
  liveness: 'passive' | 'active';
  prompts: StoredSelfiePose[];
  createdAt: Date;
  expiresAt: Date;
  submittedAt: Date | null;
  processedAt: Date | null;
  errorCode: StoredSelfieCaptureErrorCode | null;
  redactedAt: Date | null;
  /** Whether a sealed device snapshot is stored (cleared when the capture leaves `submitted`). */
  hasDevice: boolean;
  /** C94.6 (Workflow 7A, V02, V03): the flow session that created it; `null` before Phase 7. */
  createdBySessionId: string | null;
}

/** {@link SelfieCapture} with the nonce digest, for the submit and upload checks only. */
export interface LockedSelfieCapture extends SelfieCapture {
  nonceSha256: Uint8Array;
}

export interface NewSelfieCapture {
  id: string;
  verificationId: string;
  inquiryId: string;
  method: 'camera' | 'upload';
  liveness: 'passive' | 'active';
  prompts: readonly StoredSelfiePose[];
  /** SHA-256 of the nonce (32 bytes). */
  nonceSha256: Uint8Array;
  createdAt: Date;
  expiresAt: Date;
  /** C94.6 (Workflow 7A, V02, V03): the flow session that creates it. */
  createdBySessionId?: string | null;
}

/** The latest file per pose of a capture (C40.1 `prompt-timings`). */
export interface SelfiePromptTimingRecord {
  pose: StoredSelfiePose;
  clientElapsedMs: number | null;
  receivedAt: Date;
}

const POSE_OF_KIND: Readonly<Record<string, StoredSelfiePose>> = {
  'selfie-center': 'center',
  'selfie-left': 'left',
  'selfie-right': 'right',
};

function toCapture(row: SelfieCaptureRow): SelfieCapture {
  return {
    id: row.id,
    environmentId: row.environmentId,
    verificationId: row.verificationId,
    inquiryId: row.inquiryId,
    status: row.status,
    method: row.method,
    liveness: row.liveness,
    prompts: [...row.prompts],
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    submittedAt: row.submittedAt,
    processedAt: row.processedAt,
    errorCode: row.errorCode,
    redactedAt: row.redactedAt,
    hasDevice: row.deviceSealed !== null,
    createdBySessionId: row.createdBySessionId,
  };
}

const ofCapture = (environmentId: string, id: string) =>
  and(eq(selfieCaptures.environmentId, environmentId), eq(selfieCaptures.id, id));

/** C40.2: a new `initiated` capture. The caller superseded the open one first. */
export async function createSelfieCapture(
  tx: Db,
  environmentId: string,
  input: NewSelfieCapture,
): Promise<SelfieCapture> {
  const row = inserted(
    await tx
      .insert(selfieCaptures)
      .values({
        id: input.id,
        environmentId,
        verificationId: input.verificationId,
        inquiryId: input.inquiryId,
        method: input.method,
        liveness: input.liveness,
        prompts: [...input.prompts],
        nonceSha256: Buffer.from(input.nonceSha256),
        createdAt: input.createdAt,
        expiresAt: input.expiresAt,
        createdBySessionId: input.createdBySessionId ?? null,
      })
      .returning(),
    'createSelfieCapture',
  );
  return toCapture(row);
}

export async function getSelfieCapture(
  db: Db,
  environmentId: string,
  id: string,
): Promise<SelfieCapture | null> {
  const row = firstOrNull(
    await db.select().from(selfieCaptures).where(ofCapture(environmentId, id)),
  );
  return row === null ? null : toCapture(row);
}

/**
 * The capture `id` of `verificationId`, locked `FOR UPDATE`, with its nonce digest; `null` when
 * the environment, verification or id does not match (C40.4: scoped lookups).
 */
export async function lockSelfieCapture(
  tx: Db,
  environmentId: string,
  verificationId: string,
  id: string,
): Promise<LockedSelfieCapture | null> {
  const row = firstOrNull(
    await tx
      .select()
      .from(selfieCaptures)
      .where(and(ofCapture(environmentId, id), eq(selfieCaptures.verificationId, verificationId)))
      .for('update'),
  );
  return row === null ? null : { ...toCapture(row), nonceSha256: new Uint8Array(row.nonceSha256) };
}

/** A verification's or an inquiry's captures, newest first (C40.1 `selfies`). */
export async function listSelfieCaptures(
  db: Db,
  environmentId: string,
  filter: { verificationId?: string; inquiryId?: string },
): Promise<SelfieCapture[]> {
  const rows = await db
    .select()
    .from(selfieCaptures)
    .where(
      and(
        eq(selfieCaptures.environmentId, environmentId),
        filter.verificationId === undefined
          ? undefined
          : eq(selfieCaptures.verificationId, filter.verificationId),
        filter.inquiryId === undefined ? undefined : eq(selfieCaptures.inquiryId, filter.inquiryId),
      ),
    )
    .orderBy(desc(selfieCaptures.createdAt), desc(selfieCaptures.id));
  return rows.map(toCapture);
}

/** C40.2: how many captures a verification has had (the 11th create cancels it). */
export async function countSelfieCaptures(
  tx: Db,
  environmentId: string,
  verificationId: string,
): Promise<number> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(selfieCaptures)
    .where(
      and(
        eq(selfieCaptures.environmentId, environmentId),
        eq(selfieCaptures.verificationId, verificationId),
      ),
    );
  return row?.count ?? 0;
}

/**
 * C40.2: moves the verification's open (`initiated`) capture to `errored` with `errorCode`
 * (`superseded`, `expired` or `canceled`), clears its device, and deletes its file rows. Returns
 * the errored captures (one `selfie.errored` each) and the deleted files, whose storage objects
 * the caller deletes after commit; an object whose delete fails is crypto-shredded, since its
 * wrapped DEK went with the row.
 */
export async function errorOpenSelfieCaptures(
  tx: Db,
  environmentId: string,
  verificationId: string,
  errorCode: 'superseded' | 'expired' | 'canceled',
): Promise<{ captures: SelfieCapture[]; files: StoredFile[] }> {
  const rows = await tx
    .update(selfieCaptures)
    .set({ status: 'errored', errorCode, deviceSealed: null })
    .where(
      and(
        eq(selfieCaptures.environmentId, environmentId),
        eq(selfieCaptures.verificationId, verificationId),
        eq(selfieCaptures.status, 'initiated'),
      ),
    )
    .returning();
  const ids = rows.map((row) => row.id);
  const deleted =
    ids.length === 0
      ? []
      : await tx
          .delete(files)
          .where(and(eq(files.environmentId, environmentId), inArray(files.selfieCaptureId, ids)))
          .returning();
  return { captures: rows.map(toCapture), files: deleted };
}

/**
 * C40.4: consumes the capture once, in the submit transaction: `initiated` and unexpired at
 * `now` (the injected clock) becomes `submitted`, with the sealed device snapshot. `null` when
 * the conditional update matched nothing (consumed, superseded, expired or foreign).
 */
export async function consumeSelfieCapture(
  tx: Db,
  environmentId: string,
  input: { id: string; verificationId: string; now: Date; device?: unknown },
): Promise<SelfieCapture | null> {
  const row = firstOrNull(
    await tx
      .update(selfieCaptures)
      .set({
        status: 'submitted',
        submittedAt: input.now,
        deviceSealed:
          input.device === undefined
            ? null
            : sealJson(SEALED.selfieCaptureDevice, input.id, input.device),
      })
      .where(
        and(
          ofCapture(environmentId, input.id),
          eq(selfieCaptures.verificationId, input.verificationId),
          eq(selfieCaptures.status, 'initiated'),
          sql`${selfieCaptures.expiresAt} > ${input.now.toISOString()}`,
        ),
      )
      .returning(),
  );
  return row === null ? null : toCapture(row);
}

/** C40.5: `submitted` -> `processed` after the decision, clearing the device in the same update. */
export async function markSelfieCaptureProcessed(
  tx: Db,
  environmentId: string,
  id: string,
  at: Date,
): Promise<SelfieCapture | null> {
  const row = firstOrNull(
    await tx
      .update(selfieCaptures)
      .set({ status: 'processed', processedAt: at, deviceSealed: null })
      .where(and(ofCapture(environmentId, id), eq(selfieCaptures.status, 'submitted')))
      .returning(),
  );
  return row === null ? null : toCapture(row);
}

/**
 * C40.5, C40.8: `submitted` -> `errored` (`processing_failed`), when a job fails without data,
 * clearing the device in the same update.
 */
export async function markSelfieCaptureFailed(
  tx: Db,
  environmentId: string,
  id: string,
): Promise<SelfieCapture | null> {
  const row = firstOrNull(
    await tx
      .update(selfieCaptures)
      .set({ status: 'errored', errorCode: 'processing_failed', deviceSealed: null })
      .where(and(ofCapture(environmentId, id), eq(selfieCaptures.status, 'submitted')))
      .returning(),
  );
  return row === null ? null : toCapture(row);
}

/** C40.5: clears the device snapshot, whatever the status (redaction and retention use it too). */
export async function clearSelfieCaptureDevice(
  tx: Db,
  environmentId: string,
  id: string,
): Promise<void> {
  await tx.update(selfieCaptures).set({ deviceSealed: null }).where(ofCapture(environmentId, id));
}

/**
 * C40.9: the newest `submitted` capture of a verification and its decrypted device snapshot, for
 * the worker only (never logged). `null` without one.
 */
export async function newestSubmittedSelfieCapture(
  db: Db,
  environmentId: string,
  verificationId: string,
): Promise<{ capture: SelfieCapture; device: unknown } | null> {
  const row = firstOrNull(
    await db
      .select()
      .from(selfieCaptures)
      .where(
        and(
          eq(selfieCaptures.environmentId, environmentId),
          eq(selfieCaptures.verificationId, verificationId),
          eq(selfieCaptures.status, 'submitted'),
        ),
      )
      .orderBy(desc(selfieCaptures.submittedAt), desc(selfieCaptures.id))
      .limit(1),
  );
  if (row === null) {
    return null;
  }
  return {
    capture: toCapture(row),
    device:
      row.deviceSealed === null
        ? null
        : openJson(SEALED.selfieCaptureDevice, row.id, row.deviceSealed),
  };
}

/** The decrypted device snapshot of a capture (worker only); `null` when none is stored. */
export async function openSelfieCaptureDevice(
  db: Db,
  environmentId: string,
  id: string,
): Promise<unknown> {
  const row = firstOrNull(
    await db
      .select({ device: selfieCaptures.deviceSealed })
      .from(selfieCaptures)
      .where(ofCapture(environmentId, id)),
  );
  return row?.device == null ? null : openJson(SEALED.selfieCaptureDevice, id, row.device);
}

/**
 * C40.1 `prompt-timings`: the latest file per pose of a capture, in the order the server
 * received them (ties, as under a frozen test clock, in the order the rows were written).
 */
export async function selfieCapturePromptTimings(
  db: Db,
  environmentId: string,
  captureId: string,
): Promise<SelfiePromptTimingRecord[]> {
  const rows = await db
    .select({
      kind: files.kind,
      clientElapsedMs: files.clientElapsedMs,
      receivedAt: files.receivedAt,
    })
    .from(files)
    .where(and(eq(files.environmentId, environmentId), eq(files.selfieCaptureId, captureId)))
    .orderBy(asc(files.receivedAt), asc(files.createdAt), asc(files.id));
  return rows.flatMap((row) => {
    const pose = POSE_OF_KIND[row.kind];
    return pose === undefined || row.receivedAt === null
      ? []
      : [{ pose, clientElapsedMs: row.clientElapsedMs, receivedAt: row.receivedAt }];
  });
}

/**
 * C43 `capture_replayed`, the single replay lookup (Workflow 4B review K203): which of `sha256s`
 * a file of the environment outside `excludeCaptureId` already holds, sorted. Any file counts:
 * another capture of any inquiry (this one's earlier attempts too), and a file without a capture
 * (a government ID image, a selfie from before Phase 4). Files whose object redaction deleted
 * (`deleted_at`) and files of redacted inquiries do not. Uses `files_environment_id_sha256_idx`.
 */
export async function findReplayedDigests(
  db: Db,
  environmentId: string,
  input: { sha256s: readonly string[]; excludeCaptureId: string },
): Promise<string[]> {
  if (input.sha256s.length === 0) {
    return [];
  }
  const rows = await db
    .selectDistinct({ sha256: files.sha256 })
    .from(files)
    .innerJoin(
      verifications,
      and(
        eq(verifications.environmentId, files.environmentId),
        eq(verifications.id, files.verificationId),
      ),
    )
    .innerJoin(
      inquiries,
      and(
        eq(inquiries.environmentId, verifications.environmentId),
        eq(inquiries.id, verifications.inquiryId),
      ),
    )
    .where(
      and(
        eq(files.environmentId, environmentId),
        inArray(files.sha256, [...input.sha256s]),
        isNull(files.deletedAt),
        isNull(inquiries.redactedAt),
        or(isNull(files.selfieCaptureId), ne(files.selfieCaptureId, input.excludeCaptureId)),
      ),
    )
    .orderBy(asc(files.sha256));
  return rows.map((row) => row.sha256);
}

// C42: face templates and background rows -----------------------------------------------------

export interface NewFaceTemplate {
  id: string;
  verificationId: string;
  inquiryId: string;
  model: string;
  /** The L2-normalised SFace embedding. */
  embedding: readonly number[];
}

export interface FaceTemplate {
  id: string;
  verificationId: string;
  inquiryId: string;
  model: string;
  embedding: number[];
  createdAt: Date;
}

/** Encodes an embedding as base64 float32 (little-endian), the sealed template's plaintext. */
export function encodeFaceTemplate(embedding: readonly number[]): string {
  const buffer = Buffer.alloc(embedding.length * 4);
  embedding.forEach((value, index) => buffer.writeFloatLE(value, index * 4));
  return buffer.toString('base64');
}

export function decodeFaceTemplate(encoded: string): number[] {
  const buffer = Buffer.from(encoded, 'base64');
  return Array.from({ length: buffer.length / 4 }, (_, index) => buffer.readFloatLE(index * 4));
}

/** C42.1: writes the sealed template of a passed selfie with matching consent. */
export async function createFaceTemplate(
  tx: Db,
  environmentId: string,
  input: NewFaceTemplate,
): Promise<{ id: string; createdAt: Date }> {
  const row = inserted(
    await tx
      .insert(faceTemplates)
      .values({
        id: input.id,
        environmentId,
        verificationId: input.verificationId,
        inquiryId: input.inquiryId,
        model: input.model,
        templateSealed: sealValue(
          SEALED.faceTemplate,
          input.id,
          encodeFaceTemplate(input.embedding),
        ),
      })
      .returning({ id: faceTemplates.id, createdAt: faceTemplates.createdAt }),
    'createFaceTemplate',
  );
  return row;
}

/** Decrypts one template row. */
export function openFaceTemplate(row: typeof faceTemplates.$inferSelect): FaceTemplate {
  return {
    id: row.id,
    verificationId: row.verificationId,
    inquiryId: row.inquiryId,
    model: row.model,
    embedding: decodeFaceTemplate(openValue(SEALED.faceTemplate, row.id, row.templateSealed)),
    createdAt: row.createdAt,
  };
}

/**
 * C42.4: a batch of the environment's templates, newest first, outside `excludeInquiryIds`,
 * decrypted. Page with `before` (the last row's `createdAt` and `id`).
 */
export async function listFaceTemplates(
  db: Db,
  environmentId: string,
  input: {
    excludeInquiryIds: readonly string[];
    limit: number;
    before?: { createdAt: Date; id: string };
  },
): Promise<FaceTemplate[]> {
  const rows = await db
    .select()
    .from(faceTemplates)
    .where(
      and(
        eq(faceTemplates.environmentId, environmentId),
        input.excludeInquiryIds.length === 0
          ? undefined
          : notInArray(faceTemplates.inquiryId, [...input.excludeInquiryIds]),
        input.before === undefined
          ? undefined
          : sql`(${faceTemplates.createdAt}, ${faceTemplates.id}) < (${input.before.createdAt.toISOString()}, ${input.before.id})`,
      ),
    )
    .orderBy(desc(faceTemplates.createdAt), desc(faceTemplates.id))
    .limit(input.limit);
  return rows.map(openFaceTemplate);
}

export interface NewSelfieBackground {
  id: string;
  verificationId: string;
  inquiryId: string;
  faceTemplateId: string;
  layout: readonly number[];
  validCells: string;
  coverage: number;
}

/** C42.5: the background row written beside its template. */
export async function createSelfieBackground(
  tx: Db,
  environmentId: string,
  input: NewSelfieBackground,
): Promise<{ id: string }> {
  return inserted(
    await withSensitiveParameters('createSelfieBackground', () =>
      tx
        .insert(selfieBackgrounds)
        .values({ ...input, environmentId, layout: [...input.layout] })
        .returning({ id: selfieBackgrounds.id }),
    ),
    'createSelfieBackground',
  );
}

/**
 * C42.2, C42.6: deletes the inquiry's face templates and background rows (redaction, an
 * operator decline, a failed inquiry). Returns how many of each went.
 */
export async function deleteFaceDataForInquiry(
  tx: Db,
  environmentId: string,
  inquiryId: string,
): Promise<{ templates: number; backgrounds: number }> {
  const backgrounds = await tx
    .delete(selfieBackgrounds)
    .where(
      and(
        eq(selfieBackgrounds.environmentId, environmentId),
        eq(selfieBackgrounds.inquiryId, inquiryId),
      ),
    )
    .returning({ id: selfieBackgrounds.id });
  const templates = await tx
    .delete(faceTemplates)
    .where(
      and(eq(faceTemplates.environmentId, environmentId), eq(faceTemplates.inquiryId, inquiryId)),
    )
    .returning({ id: faceTemplates.id });
  return { templates: templates.length, backgrounds: backgrounds.length };
}
