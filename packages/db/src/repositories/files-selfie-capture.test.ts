/**
 * C40.3 (Workflow 4A Stage 3, api-flow): a selfie pose is stored with its capture, the client's
 * elapsed time and the server's receipt time; a re-upload of the kind replaces it.
 */
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import {
  createdAtClock,
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  testId,
  type TestDatabase,
  wallClockStepsBack,
} from '../testing.js';
import {
  createFile,
  createSelfieCapture,
  createVerification,
  getFile,
  listVerificationFiles,
  replaceVerificationFile,
  selfieCapturePromptTimings,
} from './index.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

const CREATED = new Date('2026-10-21T10:00:00.000Z');

async function capturedSelfie() {
  const { environment } = await createTestTenant(database.db);
  const { inquiry } = await createTestInquiry(database.db, environment.id);
  const verification = await createVerification(database.db, environment.id, {
    id: testId('ver'),
    inquiryId: inquiry.id,
    type: 'selfie',
  });
  const capture = await createSelfieCapture(database.db, environment.id, {
    id: testId('self'),
    verificationId: verification.id,
    inquiryId: inquiry.id,
    method: 'camera',
    liveness: 'active',
    prompts: ['center', 'left', 'right'],
    nonceSha256: new Uint8Array(32).fill(7),
    createdAt: CREATED,
    expiresAt: new Date(CREATED.getTime() + 180_000),
  });
  return { environmentId: environment.id, verificationId: verification.id, captureId: capture.id };
}

function pose(verificationId: string, kind: 'selfie-center' | 'selfie-left', seed: string) {
  const id = testId('file');
  return {
    id,
    verificationId,
    kind,
    storageKey: `objects/${id}`,
    mimeType: 'image/jpeg',
    byteSize: 64,
    sha256: createHash('sha256').update(seed).digest('hex'),
    wrappedDek: `ov1.${'k'.repeat(11)}.${'d'.repeat(80)}`,
  } as const;
}

describe('a selfie pose with its capture (C40.3)', () => {
  it('stores the capture, the client elapsed time and the receipt time', async () => {
    const { environmentId, verificationId, captureId } = await capturedSelfie();
    const receivedAt = new Date(CREATED.getTime() + 2_500);

    const file = await createFile(database.db, environmentId, {
      ...pose(verificationId, 'selfie-center', 'a'),
      selfieCaptureId: captureId,
      clientElapsedMs: 2_310,
      receivedAt,
    });

    expect(await getFile(database.db, environmentId, file.id)).toMatchObject({
      selfieCaptureId: captureId,
      clientElapsedMs: 2_310,
      receivedAt,
    });
  });

  it('replaces the earlier file of the kind, and the capture keeps the latest per pose', async () => {
    onTestFinished(wallClockStepsBack());
    const { environmentId, verificationId, captureId } = await capturedSelfie();
    const clock = createdAtClock(database.db);
    const first = await replaceVerificationFile(database.db, environmentId, {
      ...pose(verificationId, 'selfie-center', 'first'),
      selfieCaptureId: captureId,
      clientElapsedMs: 900,
      receivedAt: new Date(CREATED.getTime() + 1_000),
    });
    await clock.at('files', first?.file.id ?? '');
    const left = await replaceVerificationFile(database.db, environmentId, {
      ...pose(verificationId, 'selfie-left', 'left'),
      selfieCaptureId: captureId,
      clientElapsedMs: 2_000,
      receivedAt: new Date(CREATED.getTime() + 2_100),
    });
    await clock.at('files', left?.file.id ?? '');

    const second = await replaceVerificationFile(database.db, environmentId, {
      ...pose(verificationId, 'selfie-center', 'second'),
      selfieCaptureId: captureId,
      clientElapsedMs: 3_000,
      receivedAt: new Date(CREATED.getTime() + 3_100),
    });
    await clock.at('files', second?.file.id ?? '');

    expect(second?.replaced.map((file) => file.id)).toEqual([first?.file.id]);
    expect(
      (await listVerificationFiles(database.db, environmentId, [verificationId])).map(
        (file) => file.id,
      ),
    ).toEqual([left?.file.id, second?.file.id]);
    expect(await selfieCapturePromptTimings(database.db, environmentId, captureId)).toEqual([
      { pose: 'left', clientElapsedMs: 2_000, receivedAt: new Date(CREATED.getTime() + 2_100) },
      { pose: 'center', clientElapsedMs: 3_000, receivedAt: new Date(CREATED.getTime() + 3_100) },
    ]);
  });

  it('leaves the three columns empty for a file outside a capture', async () => {
    const { environmentId, verificationId } = await capturedSelfie();

    const file = await createFile(
      database.db,
      environmentId,
      pose(verificationId, 'selfie-center', 'plain'),
    );

    expect(file).toMatchObject({ selfieCaptureId: null, clientElapsedMs: null, receivedAt: null });
  });
});
