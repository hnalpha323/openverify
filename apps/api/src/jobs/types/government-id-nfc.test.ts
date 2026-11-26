/**
 * C62.3-C62.6, C54.1: the government ID NFC job. It reads the verification's chip files and its
 * consumed challenge, verifies Passive Authentication against the environment kind's trust store
 * (the Utopia sandbox anchor here) and Active Authentication over the challenge's nonce, decodes
 * DG2 through vision only after its hash verified, compares it with the inquiry's latest selfie
 * centre, DG1 with the government ID's MRZ reading, and looks up selfie-bound sightings of the
 * SOD on other accounts. In the decision transaction it writes `chip_reads` (only with integrity
 * established; `selfie_bound` when the selfie comparison passed and the verification ended passed
 * or needs review), stores the `chip-portrait` PNG, and clears the AA response and device report.
 * Every chip, key and face is synthetic.
 */
import { createHash } from 'node:crypto';
import {
  createFile,
  createVerification,
  encryptBytes,
  getChipChallenge,
  getChipRead,
  getVerification,
  listEvents,
  listVerificationFiles,
  openChipChallengeSubmission,
  openChipReadEvidence,
  setVerificationStatus,
  type Db,
  type Keyring,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestTenant,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEventPublisher } from '../../events/index.js';
import type { VisionFace, VisionImage } from '../../ports.js';
import {
  seedNfcInquiry,
  TEST_PORTRAIT,
  TEST_SELFIE,
  testChip,
  type SeedNfcOptions,
} from '../../services/chip-challenges/testing.js';
import { installSandboxTrustAnchor } from '../../trust-anchors/sandbox.js';
import { createRecordingQueue as createRecordingVerificationQueue } from '../../test-support/fakes.js';
import { createWebhookDeliveryScheduler, type WebhookDeliveryJob } from '../../webhooks/queue.js';
import {
  failVerificationAfterError,
  processVerification,
  type ProcessVerificationDeps,
} from '../process-verification.js';
import {
  createCapturingLogger,
  createFakeVision,
  createMemoryStorage,
  createRecordingQueue,
  embedFaceAnswer,
  FAKE_PNG,
  governmentIdFixture,
} from '../testing.js';

const NOW = new Date('2026-10-20T12:00:00.000Z');
const KEY = new Uint8Array(32).fill(0x5b);

let database: TestDatabase;
let db: Db;
let keyring: Keyring;
let sandboxEnv: string;
let productionEnv: string;
const storage = createMemoryStorage();

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  keyring = database.keyring;
  sandboxEnv = (await createTestTenant(db, { organizationName: 'Chip Test Org' })).environment.id;
  productionEnv = (await createTestTenant(db, { kind: 'production' })).environment.id;
  await installSandboxTrustAnchor(db, { now: NOW });
}, 60_000);

afterAll(async () => {
  await database.close();
});

/** The golden ID portrait's face, and one whose embedding points elsewhere. */
const portrait = governmentIdFixture().sides.front.portrait;
if (portrait === null) {
  throw new Error('the golden ID front has a portrait');
}
const FACE: VisionFace = portrait;
const OTHER_FACE: VisionFace = {
  ...FACE,
  embedding: FACE.embedding.map((value, index) => (index % 2 === 0 ? -value : value)),
};

const isPortrait = (image: { bytes: readonly number[] | Uint8Array }) =>
  image.bytes.length === TEST_PORTRAIT.length;

function setup(options: { chipFace?: VisionFace | null; selfieFace?: VisionFace | null } = {}) {
  const logger = createCapturingLogger();
  const events = createEventPublisher({
    db,
    deliveries: createWebhookDeliveryScheduler(createRecordingQueue<WebhookDeliveryJob>()),
    logger,
  });
  const vision = createFakeVision();
  vision.answers.embedFace = (image: VisionImage) =>
    embedFaceAnswer(
      isPortrait(image)
        ? options.chipFace === undefined
          ? FACE
          : options.chipFace
        : options.selfieFace === undefined
          ? FACE
          : options.selfieFace,
    );
  vision.answers.convertPortrait = FAKE_PNG;
  const deps: ProcessVerificationDeps = {
    db,
    storage,
    keyring,
    vision: vision.client,
    events,
    clock: { now: () => NOW },
    logger,
    blindIndexKey: KEY,
    queue: createRecordingVerificationQueue(),
  };
  return { deps, vision, logger };
}

async function seeded(options: Partial<SeedNfcOptions> & { environmentId?: string } = {}) {
  return seedNfcInquiry(db, {
    environmentId: options.environmentId ?? sandboxEnv,
    storage,
    keyring,
    now: NOW,
    chip: options.chip ?? testChip({ now: NOW }),
    ...options,
  });
}

async function judge(
  target: { environmentId?: string; verificationId: string },
  options: Parameters<typeof setup>[0] = {},
) {
  const { deps, vision, logger } = setup(options);
  const environmentId = target.environmentId ?? sandboxEnv;
  const result = await processVerification(
    { environmentId, verificationId: target.verificationId },
    deps,
    { lastAttempt: true },
  );
  const verification = await getVerification(db, environmentId, target.verificationId);
  const check = (name: string) => verification?.checks.find((one) => one.name === name);
  return { result, verification, check, vision, logger };
}

describe('the government ID NFC job (C62)', () => {
  it('passes a genuine chip bound to the selfie and the ID, and stores the read and the portrait', async () => {
    const chip = testChip({ now: NOW, seed: 'job/genuine' });
    const target = await seeded({
      chip,
      deviceReport: {
        protocols: [
          { protocol: 'pace-cam', outcome: 'succeeded' },
          { protocol: 'chip-authentication', outcome: 'failed' },
        ],
      },
    });

    const { verification, check, vision } = await judge(target);

    expect(verification?.status).toBe('passed');
    expect(
      Object.fromEntries((verification?.checks ?? []).map((one) => [one.name, one.status])),
    ).toEqual({
      id_nfc_expired_detection: 'passed',
      id_nfc_passive_authentication_detection: 'passed',
      id_nfc_chip_authentication_detection: 'passed',
      id_nfc_mrz_comparison: 'passed',
      id_nfc_selfie_comparison: 'passed',
      id_nfc_repeat_detection: 'passed',
    });
    expect(check('id_nfc_passive_authentication_detection')?.metadata).toMatchObject({
      integrity: 'established',
      revocation: 'unrevoked',
    });
    expect(check('id_nfc_chip_authentication_detection')?.metadata).toMatchObject({
      'device-reported': ['pace_cam'],
    });
    expect(check('id_nfc_repeat_detection')?.metadata).toEqual({ sightings: 0 });
    // DG2 was decoded through vision as a chip portrait, the selfie centre as a selfie.
    expect(
      vision.calls
        .filter((call) => call.endpoint === 'embed-face')
        .map((call) => call.subject)
        .sort(),
    ).toEqual(['chip', 'selfie']);

    const read = await getChipRead(db, sandboxEnv, target.verificationId);
    expect(read).toMatchObject({
      integrity: 'established',
      selfieBound: true,
      issuingCountry: 'UTO',
      paSummary: { integrity: 'established', anchorSource: 'openverify-sandbox' },
    });
    expect(
      (await openChipReadEvidence(db, sandboxEnv, target.verificationId))?.fields,
    ).toMatchObject({
      'name-first': 'AVERY',
      'name-last': 'EXAMPLE',
      'identification-number': 'UT1234567',
      'id-class': 'passport',
    });
    const files = await listVerificationFiles(db, sandboxEnv, [target.verificationId]);
    expect(files.filter((file) => file.kind === 'chip-portrait')).toMatchObject([
      { mimeType: 'image/png' },
    ]);
    // Decision 43: the AA response and the device report are cleared once processing ended.
    expect((await getChipChallenge(db, sandboxEnv, target.challengeId))?.status).toBe('processed');
    expect(await openChipChallengeSubmission(db, sandboxEnv, target.challengeId)).toEqual({
      nonce: null,
      aaResponse: null,
      deviceReport: null,
    });
    const events = await listEvents(db, sandboxEnv, { name: 'verification.passed' });
    expect(JSON.stringify(events)).not.toContain('nonce');
  });

  it('fails a tampered DG1 for proven tampering and keeps no read', async () => {
    const target = await seeded({
      chip: testChip({ now: NOW, seed: 'job/tampered', variants: ['tampered-dg1'] }),
    });

    const { verification, check } = await judge(target);

    expect(verification?.status).toBe('failed');
    expect(check('id_nfc_passive_authentication_detection')).toMatchObject({
      status: 'failed',
      reasons: ['dg_hash_mismatch'],
    });
    expect(await getChipRead(db, sandboxEnv, target.verificationId)).toBeNull();
    const files = await listVerificationFiles(db, sandboxEnv, [target.verificationId]);
    expect(files.some((file) => file.kind === 'chip-portrait')).toBe(false);
  });

  it('fails another face (face_mismatch) and records the read as not selfie-bound', async () => {
    const target = await seeded({ chip: testChip({ now: NOW, seed: 'job/other-face' }) });

    const { verification, check } = await judge(target, { selfieFace: OTHER_FACE });

    expect(verification?.status).toBe('failed');
    expect(check('id_nfc_selfie_comparison')).toMatchObject({
      status: 'failed',
      reasons: ['face_mismatch'],
    });
    expect(await getChipRead(db, sandboxEnv, target.verificationId)).toMatchObject({
      integrity: 'established',
      selfieBound: false,
    });
  });

  it('counts a selfie-bound read of the same SOD on another account as a sighting, never a mismatched one', async () => {
    const chip = testChip({ now: NOW, seed: 'job/replayed' });
    const mismatched = await seeded({ chip, referenceId: 'account-replay-a' });
    await judge(mismatched, { selfieFace: OTHER_FACE });
    const first = await seeded({ chip, referenceId: 'account-replay-b' });
    expect((await judge(first)).check('id_nfc_repeat_detection')?.metadata).toEqual({
      sightings: 0,
    });

    const replay = await seeded({ chip, referenceId: 'account-replay-c' });
    const { verification, check } = await judge(replay);

    expect(check('id_nfc_repeat_detection')).toMatchObject({
      status: 'not_applicable',
      reasons: ['chip_seen_on_other_account'],
      requirement: 'not_required',
      metadata: { sightings: 1 },
    });
    // The repeat check is advisory (decision 35): the other required checks decide.
    expect(verification?.status).toBe('passed');

    const sameAccount = await seeded({ chip, referenceId: 'account-replay-c' });
    expect((await judge(sameAccount)).check('id_nfc_repeat_detection')?.metadata).toEqual({
      sightings: 1,
    });
  });

  it('sends a chip whose SOD lists DG15 but whose AA response is missing to review', async () => {
    const target = await seeded({
      chip: testChip({ now: NOW, seed: 'job/withheld' }),
      activeAuthentication: 'none',
    });

    const { verification, check } = await judge(target);

    expect(check('id_nfc_chip_authentication_detection')).toMatchObject({
      status: 'not_applicable',
      reasons: ['active_authentication_withheld'],
    });
    expect(verification?.status).toBe('needs_review');
  });

  it('fails an AA response over another nonce', async () => {
    const target = await seeded({
      chip: testChip({ now: NOW, seed: 'job/replayed-aa' }),
      activeAuthentication: 'other-nonce',
    });

    const { verification, check } = await judge(target);

    expect(check('id_nfc_chip_authentication_detection')).toMatchObject({
      status: 'failed',
      reasons: ['active_authentication_failed'],
    });
    expect(verification?.status).toBe('failed');
  });

  it('sends a chip without a selfie in the inquiry to review (no_reference_data)', async () => {
    const target = await seeded({
      chip: testChip({ now: NOW, seed: 'job/no-selfie' }),
      selfie: false,
    });

    const { verification, check } = await judge(target);

    expect(check('id_nfc_selfie_comparison')).toMatchObject({
      status: 'not_applicable',
      reasons: ['no_reference_data'],
    });
    expect(verification?.status).toBe('needs_review');
    expect(await getChipRead(db, sandboxEnv, target.verificationId)).toMatchObject({
      selfieBound: false,
    });
  });

  // Workflow 5C review P005: a selfie still being judged has had no liveness decision, so it is
  // no reference; nor is an earlier one, since the inquiry is judged on the latest selfie. The job
  // waits for its decision while attempts remain, then goes to review.
  describe('while the inquiry’s latest selfie is still submitted', () => {
    /** A later selfie, its centre photo uploaded, submitted and not yet decided. */
    async function withSelfieStillJudged(seed: string) {
      const target = await seeded({ chip: testChip({ now: NOW, seed }) });
      const later = testId('ver');
      await createVerification(db, sandboxEnv, {
        id: later,
        inquiryId: target.inquiryId,
        type: 'selfie',
      });
      const fileId = testId('file');
      const sealed = encryptBytes(TEST_SELFIE, keyring, { context: fileId });
      await storage.put(`${sandboxEnv}/${fileId}`, sealed.ciphertext);
      await createFile(db, sandboxEnv, {
        id: fileId,
        verificationId: later,
        kind: 'selfie-center',
        storageKey: `${sandboxEnv}/${fileId}`,
        mimeType: 'image/jpeg',
        byteSize: TEST_SELFIE.byteLength,
        sha256: createHash('sha256').update(TEST_SELFIE).digest('hex'),
        wrappedDek: sealed.wrappedDek,
      });
      await setVerificationStatus(db, sandboxEnv, later, { to: 'submitted' });
      return target;
    }

    it('retries later while attempts remain, deciding nothing', async () => {
      const target = await withSelfieStillJudged('job/selfie-pending');
      const { deps } = setup();

      await expect(
        processVerification(
          { environmentId: sandboxEnv, verificationId: target.verificationId },
          deps,
          { lastAttempt: false },
        ),
      ).rejects.toMatchObject({ name: 'SelfieReferencePendingError' });
      expect((await getVerification(db, sandboxEnv, target.verificationId))?.status).toBe(
        'submitted',
      );
      expect(await getChipRead(db, sandboxEnv, target.verificationId)).toBeNull();
    });

    it('answers no_reference_data on the last attempt, comparing neither the undecided selfie nor an earlier one', async () => {
      const target = await withSelfieStillJudged('job/selfie-pending-last');

      const { verification, check, vision } = await judge(target);

      expect(check('id_nfc_selfie_comparison')).toMatchObject({
        status: 'not_applicable',
        reasons: ['no_reference_data'],
      });
      expect(verification?.status).toBe('needs_review');
      // No selfie face was embedded: only the chip portrait was.
      expect(
        vision.calls.filter((call) => call.endpoint === 'embed-face' && call.subject === 'selfie'),
      ).toHaveLength(0);
    });
  });

  it('never decodes a DG2 whose hash differs', async () => {
    const target = await seeded({
      chip: testChip({ now: NOW, seed: 'job/tampered-dg2', variants: ['tampered-dg2'] }),
    });

    const { check, vision } = await judge(target);

    expect(
      vision.calls.some((call) => call.endpoint === 'embed-face' && call.subject === 'chip'),
    ).toBe(false);
    expect(vision.calls.some((call) => call.endpoint === 'convert-portrait')).toBe(false);
    expect(check('id_nfc_selfie_comparison')?.reasons).toEqual(['integrity_not_established']);
  });

  it('fails a Utopia chip in a production environment as a specimen (V04)', async () => {
    const target = await seeded({
      environmentId: productionEnv,
      chip: testChip({ now: NOW, seed: 'job/production' }),
    });

    const { verification, check } = await judge({ ...target, environmentId: productionEnv });

    expect(check('id_nfc_passive_authentication_detection')).toMatchObject({
      status: 'failed',
      reasons: ['specimen_issuer'],
    });
    expect(verification?.status).toBe('failed');
  });

  it('marks the challenge processed and clears its evidence when processing cannot finish', async () => {
    const target = await seeded({ chip: testChip({ now: NOW, seed: 'job/failed' }) });
    const { deps } = setup();

    await failVerificationAfterError(
      { environmentId: sandboxEnv, verificationId: target.verificationId },
      deps,
      'synthetic_failure',
    );

    expect((await getChipChallenge(db, sandboxEnv, target.challengeId))?.status).toBe('processed');
    expect(await openChipChallengeSubmission(db, sandboxEnv, target.challengeId)).toEqual({
      nonce: null,
      aaResponse: null,
      deviceReport: null,
    });
  });
});
