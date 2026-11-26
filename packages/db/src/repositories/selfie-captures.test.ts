/**
 * C40 and C42 shared repository functions (Workflow 4A Stage 1), on PGlite. The Postgres-only
 * behaviour (row locks, the conditional consume racing a supersede) is tested against Postgres
 * in `selfie-captures.integration.test.ts`.
 */
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { ENCRYPTED_COLUMNS, SEALED } from '../encrypted-columns.js';
import { faceTemplates, files, inquiries, selfieCaptures, verifications } from '../schema.js';
import {
  createdAtClock,
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  testId,
  type TestDatabase,
  wallClockStepsBack,
} from '../testing.js';
import { createFile } from './files.js';
import { REWRAP_TABLES } from './key-rotation.js';
import {
  clearSelfieCaptureDevice,
  consumeSelfieCapture,
  countSelfieCaptures,
  createFaceTemplate,
  createSelfieBackground,
  createSelfieCapture,
  decodeFaceTemplate,
  deleteFaceDataForInquiry,
  encodeFaceTemplate,
  errorOpenSelfieCaptures,
  findReplayedDigests,
  getSelfieCapture,
  listFaceTemplates,
  listSelfieCaptures,
  lockSelfieCapture,
  markSelfieCaptureFailed,
  markSelfieCaptureProcessed,
  newestSubmittedSelfieCapture,
  openSelfieCaptureDevice,
  selfieCapturePromptTimings,
} from './selfie-captures.js';
import { REDACTION_SUBJECT_ID_PREFIXES } from './subject-ids.js';
import { createVerification } from './verifications.js';

let database: TestDatabase;
let environmentId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  ({
    environment: { id: environmentId },
  } = await createTestTenant(database.db));
});

afterAll(async () => {
  await database.close();
});

const T0 = new Date('2026-10-21T12:00:00.000Z');
const later = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
const digest = (value: string) => createHash('sha256').update(value).digest();
const DEVICE = { label: 'Synthetic Test Camera', webdriver: false, 'image-mirrored': false };

async function selfieVerification(): Promise<{ inquiryId: string; verificationId: string }> {
  const { inquiry } = await createTestInquiry(database.db, environmentId);
  const verification = await createVerification(database.db, environmentId, {
    id: testId('ver'),
    inquiryId: inquiry.id,
    type: 'selfie',
  });
  return { inquiryId: inquiry.id, verificationId: verification.id };
}

async function capture(ids: { inquiryId: string; verificationId: string }, nonce = 'nonce') {
  return createSelfieCapture(database.db, environmentId, {
    id: testId('self'),
    ...ids,
    method: 'camera',
    liveness: 'active',
    prompts: ['center', 'right', 'left'],
    nonceSha256: digest(nonce),
    createdAt: T0,
    expiresAt: later(180),
  });
}

async function poseFile(
  ids: { verificationId: string },
  captureId: string | null,
  kind: 'selfie-center' | 'selfie-left' | 'selfie-right',
  sha256: string,
  receivedAt = T0,
) {
  const id = testId('file');
  await createFile(database.db, environmentId, {
    id,
    verificationId: ids.verificationId,
    kind,
    storageKey: `${environmentId}/${id}`,
    mimeType: 'image/jpeg',
    byteSize: 10,
    sha256,
    wrappedDek: `ov1.${'k'.repeat(11)}.${'d'.repeat(80)}`,
  });
  await database.db
    .update(files)
    .set({ selfieCaptureId: captureId, clientElapsedMs: 1200, receivedAt })
    .where(eq(files.id, id));
  return id;
}

describe('the stored lists (C40.5, C42.1)', () => {
  it('seal the capture device and the face template to their rows, and rewrap them', () => {
    expect(ENCRYPTED_COLUMNS).toContainEqual({
      table: 'selfie_captures',
      column: 'device',
      aad: 'row',
    });
    expect(ENCRYPTED_COLUMNS).toContainEqual({
      table: 'face_templates',
      column: 'template',
      aad: 'row',
    });
    expect(SEALED).toMatchObject({
      selfieCaptureDevice: 'selfie_captures.device',
      faceTemplate: 'face_templates.template',
    });
    expect(REWRAP_TABLES).toEqual(expect.arrayContaining(['selfie_captures', 'face_templates']));
  });

  it('find the self_ ids that API answers and events mention, for redaction', () => {
    expect(REDACTION_SUBJECT_ID_PREFIXES).toContain('self');
  });

  it('require a capture of new selfie verifications (C40.7)', async () => {
    const ids = await selfieVerification();
    const [row] = await database.db
      .select({ required: verifications.selfieCaptureRequired })
      .from(verifications)
      .where(eq(verifications.id, ids.verificationId));
    expect(row?.required).toBe(true);
  });
});

describe('the selfie capture transitions (C40.2-C40.5)', () => {
  it('create an initiated capture, never returning the nonce digest or the device', async () => {
    const ids = await selfieVerification();
    const created = await capture(ids);
    expect(created).toMatchObject({
      status: 'initiated',
      method: 'camera',
      liveness: 'active',
      prompts: ['center', 'right', 'left'],
      expiresAt: later(180),
      submittedAt: null,
      errorCode: null,
      hasDevice: false,
    });
    expect(created).not.toHaveProperty('nonceSha256');
    expect(await getSelfieCapture(database.db, environmentId, created.id)).toEqual(created);
    expect(await countSelfieCaptures(database.db, environmentId, ids.verificationId)).toBe(1);
  });

  it('lock a capture only within its environment and verification, with its digest', async () => {
    const ids = await selfieVerification();
    const created = await capture(ids, 'secret');
    const locked = await lockSelfieCapture(
      database.db,
      environmentId,
      ids.verificationId,
      created.id,
    );
    expect(Buffer.from(locked?.nonceSha256 ?? []).equals(digest('secret'))).toBe(true);
    const other = await selfieVerification();
    expect(
      await lockSelfieCapture(database.db, environmentId, other.verificationId, created.id),
    ).toBeNull();
    expect(
      await lockSelfieCapture(database.db, testId('env'), ids.verificationId, created.id),
    ).toBeNull();
  });

  it('supersede the open capture, deleting its files, and allow one open capture only', async () => {
    onTestFinished(wallClockStepsBack());
    const ids = await selfieVerification();
    const clock = createdAtClock(database.db);
    const first = await capture(ids);
    await clock.at('selfie_captures', first.id);
    const fileId = await poseFile(ids, first.id, 'selfie-center', 'a'.repeat(64));
    const { captures, files: deleted } = await errorOpenSelfieCaptures(
      database.db,
      environmentId,
      ids.verificationId,
      'superseded',
    );
    expect(captures.map((entry) => [entry.id, entry.status, entry.errorCode])).toEqual([
      [first.id, 'errored', 'superseded'],
    ]);
    expect(deleted.map((file) => file.id)).toEqual([fileId]);
    const second = await capture(ids);
    await clock.at('selfie_captures', second.id);
    await expect(capture(ids)).rejects.toThrow();
    expect((await listSelfieCaptures(database.db, environmentId, ids)).map((c) => c.id)).toEqual([
      second.id,
      first.id,
    ]);
  });

  it('consume an unexpired capture once, sealing its device', async () => {
    const ids = await selfieVerification();
    const created = await capture(ids);
    const input = {
      id: created.id,
      verificationId: ids.verificationId,
      now: later(60),
      device: DEVICE,
    };
    const consumed = await consumeSelfieCapture(database.db, environmentId, input);
    expect(consumed).toMatchObject({
      status: 'submitted',
      submittedAt: later(60),
      hasDevice: true,
    });
    expect(await consumeSelfieCapture(database.db, environmentId, input)).toBeNull();
    const [row] = await database.db
      .select({ device: selfieCaptures.deviceSealed })
      .from(selfieCaptures)
      .where(eq(selfieCaptures.id, created.id));
    expect(row?.device).not.toContain('Synthetic');
    expect(await openSelfieCaptureDevice(database.db, environmentId, created.id)).toEqual(DEVICE);
  });

  it('refuse to consume an expired capture', async () => {
    const ids = await selfieVerification();
    const created = await capture(ids);
    expect(
      await consumeSelfieCapture(database.db, environmentId, {
        id: created.id,
        verificationId: ids.verificationId,
        now: later(180),
      }),
    ).toBeNull();
  });

  it('give the worker the newest submitted capture with its device, then clear it', async () => {
    const ids = await selfieVerification();
    const created = await capture(ids);
    await consumeSelfieCapture(database.db, environmentId, {
      id: created.id,
      verificationId: ids.verificationId,
      now: later(30),
      device: DEVICE,
    });
    const newest = await newestSubmittedSelfieCapture(
      database.db,
      environmentId,
      ids.verificationId,
    );
    expect(newest?.capture.id).toBe(created.id);
    expect(newest?.device).toEqual(DEVICE);
    const processed = await markSelfieCaptureProcessed(
      database.db,
      environmentId,
      created.id,
      later(40),
    );
    expect(processed).toMatchObject({
      status: 'processed',
      processedAt: later(40),
      hasDevice: false,
    });
    expect(
      await markSelfieCaptureProcessed(database.db, environmentId, created.id, later(41)),
    ).toBeNull();
    expect(
      await newestSubmittedSelfieCapture(database.db, environmentId, ids.verificationId),
    ).toBeNull();
  });

  it('error a submitted capture whose processing failed, clearing its device', async () => {
    const ids = await selfieVerification();
    const created = await capture(ids);
    await consumeSelfieCapture(database.db, environmentId, {
      id: created.id,
      verificationId: ids.verificationId,
      now: later(30),
      device: DEVICE,
    });
    expect(await markSelfieCaptureFailed(database.db, environmentId, created.id)).toMatchObject({
      status: 'errored',
      errorCode: 'processing_failed',
      hasDevice: false,
    });
  });

  it('clear a device on demand', async () => {
    const ids = await selfieVerification();
    const created = await capture(ids);
    await consumeSelfieCapture(database.db, environmentId, {
      id: created.id,
      verificationId: ids.verificationId,
      now: later(30),
      device: DEVICE,
    });
    await clearSelfieCaptureDevice(database.db, environmentId, created.id);
    expect(await openSelfieCaptureDevice(database.db, environmentId, created.id)).toBeNull();
  });

  it('report the latest file per pose with its timings', async () => {
    const ids = await selfieVerification();
    const created = await capture(ids);
    await poseFile(ids, created.id, 'selfie-center', 'b'.repeat(64), later(5));
    await poseFile(ids, created.id, 'selfie-right', 'c'.repeat(64), later(9));
    expect(await selfieCapturePromptTimings(database.db, environmentId, created.id)).toEqual([
      { pose: 'center', clientElapsedMs: 1200, receivedAt: later(5) },
      { pose: 'right', clientElapsedMs: 1200, receivedAt: later(9) },
    ]);
  });
});

describe('findReplayedDigests: the single C43 replay lookup (Workflow 4B review K203)', () => {
  it('finds bytes stored anywhere in the environment outside this capture, but deleted or redacted ones', async () => {
    const mine = await selfieVerification();
    const mineCapture = await capture(mine);
    // An earlier attempt of the same inquiry: another selfie verification, its own capture.
    const earlier = {
      inquiryId: mine.inquiryId,
      verificationId: (
        await createVerification(database.db, environmentId, {
          id: testId('ver'),
          inquiryId: mine.inquiryId,
          type: 'selfie',
        })
      ).id,
    };
    const earlierCapture = await capture(earlier);
    const theirs = await selfieVerification();
    const theirsCapture = await capture(theirs);
    const redacted = await selfieVerification();
    const redactedCapture = await capture(redacted);
    const own = 'a'.repeat(64);
    const sameInquiry = 'b'.repeat(64);
    const otherInquiry = 'c'.repeat(64);
    const noCapture = 'd'.repeat(64);
    const ownInquiryNoCapture = 'e'.repeat(64);
    const deleted = 'f'.repeat(64);
    const gone = '1'.repeat(64);
    const unseen = '2'.repeat(64);
    await poseFile(mine, mineCapture.id, 'selfie-center', own);
    // Another capture of the same inquiry, and a file without a capture in it (pre-Phase 4).
    await poseFile(earlier, earlierCapture.id, 'selfie-center', sameInquiry);
    await poseFile(mine, null, 'selfie-left', ownInquiryNoCapture);
    // Another inquiry: a capture's file and a file without a capture.
    await poseFile(theirs, theirsCapture.id, 'selfie-center', otherInquiry);
    await poseFile(theirs, null, 'selfie-right', noCapture);
    // A file whose object redaction deleted, and a file of a redacted inquiry.
    const deletedFile = await poseFile(theirs, theirsCapture.id, 'selfie-left', deleted);
    await database.db.update(files).set({ deletedAt: T0 }).where(eq(files.id, deletedFile));
    await poseFile(redacted, redactedCapture.id, 'selfie-center', gone);
    await database.db
      .update(inquiries)
      .set({ redactedAt: T0 })
      .where(eq(inquiries.id, redacted.inquiryId));

    const sha256s = [own, sameInquiry, otherInquiry, noCapture, ownInquiryNoCapture, deleted, gone];
    expect(
      await findReplayedDigests(database.db, environmentId, {
        sha256s: [...sha256s, unseen],
        excludeCaptureId: mineCapture.id,
      }),
    ).toEqual([sameInquiry, otherInquiry, noCapture, ownInquiryNoCapture].sort());
    expect(
      await findReplayedDigests(database.db, environmentId, {
        sha256s: [],
        excludeCaptureId: mineCapture.id,
      }),
    ).toEqual([]);
  });
});

describe('face templates and backgrounds (C42)', () => {
  it('seal a template to its row and read it back newest first', async () => {
    const ids = await selfieVerification();
    const embedding = Array.from({ length: 128 }, (_, index) => (index % 7) / 10);
    const template = await createFaceTemplate(database.db, environmentId, {
      id: testId('ftpl'),
      ...ids,
      model: 'sface-2021dec',
      embedding,
    });
    const [row] = await database.db
      .select()
      .from(faceTemplates)
      .where(eq(faceTemplates.id, template.id));
    expect(row?.templateSealed).toMatch(/^ov1\./);
    const listed = await listFaceTemplates(database.db, environmentId, {
      excludeInquiryIds: [],
      limit: 10,
    });
    expect(listed[0]?.embedding).toEqual(decodeFaceTemplate(encodeFaceTemplate(embedding)));
    expect(
      await listFaceTemplates(database.db, environmentId, {
        excludeInquiryIds: [ids.inquiryId],
        limit: 10,
      }),
    ).not.toContainEqual(expect.objectContaining({ id: template.id }));
  });

  it('delete an inquiry face data, templates and backgrounds', async () => {
    const ids = await selfieVerification();
    const template = await createFaceTemplate(database.db, environmentId, {
      id: testId('ftpl'),
      ...ids,
      model: 'sface-2021dec',
      embedding: Array.from({ length: 128 }, () => 0.088),
    });
    await createSelfieBackground(database.db, environmentId, {
      id: testId('sbg'),
      ...ids,
      faceTemplateId: template.id,
      layout: Array.from({ length: 144 }, (_, index) => index / 2),
      validCells: '1'.repeat(48),
      coverage: 1,
    });
    expect(await deleteFaceDataForInquiry(database.db, environmentId, ids.inquiryId)).toEqual({
      templates: 1,
      backgrounds: 1,
    });
    expect(await deleteFaceDataForInquiry(database.db, environmentId, ids.inquiryId)).toEqual({
      templates: 0,
      backgrounds: 0,
    });
  });
});
