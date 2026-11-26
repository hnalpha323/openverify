/**
 * Test support for the Phase 4 selfie job (Workflow 4A Stage 3): a three-pose analysis built from
 * the synthetic golden vision fixture, and a submitted selfie capture with its pose files. Every
 * value is synthetic (seeded embeddings, drawn landmarks, the fixture's layout). Test-only.
 */
import { createHash, randomBytes } from 'node:crypto';
import { newId } from '@openverify/contracts';
import {
  consumeSelfieCapture,
  createSelfieCapture,
  encryptBytes,
  files,
  setVerificationStatus,
  type Db,
  type Keyring,
} from '@openverify/db';
import type { FileStorage, SelfieAnalysis, SelfiePoseAnalysis } from '../ports.js';
import { selfieFixture } from './testing.js';

export type Pose = 'center' | 'left' | 'right';

export const POSE_FILE_KINDS = Object.freeze({
  center: 'selfie-center',
  left: 'selfie-left',
  right: 'selfie-right',
} as const);

/**
 * The yaw ratios of a well-taken three-pose capture, in the unmirrored convention (C41.1: a turn
 * to the user's left is positive). Each side changes by more than the provisional 0.077.
 */
export const TURNED_YAW = Object.freeze({ center: -0.012, left: 0.1, right: -0.12 });

/** A deterministic 128-dimension unit vector (a seeded LCG): a synthetic embedding. */
export function unitVector(seed: number): number[] {
  let state = seed >>> 0;
  const values = Array.from({ length: 128 }, () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 2 ** 32 - 0.5;
  });
  const norm = Math.hypot(...values);
  return values.map((value) => value / norm);
}

/** A unit vector at cosine `cosine` to the unit vector `base`, built from `seed`'s direction. */
export function vectorAtCosine(base: readonly number[], seed: number, cosine: number): number[] {
  const other = unitVector(seed);
  const dot = other.reduce((sum, value, index) => sum + value * (base[index] ?? 0), 0);
  const orthogonal = other.map((value, index) => value - dot * (base[index] ?? 0));
  const norm = Math.hypot(...orthogonal);
  const sine = Math.sqrt(1 - cosine * cosine);
  return base.map((value, index) => cosine * value + sine * ((orthogonal[index] ?? 0) / norm));
}

/** The dot product: the cosine of two unit vectors. */
export const cosine = (a: readonly number[], b: readonly number[]) =>
  a.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0);

function turned(pose: SelfiePoseAnalysis, yawRatio: number): SelfiePoseAnalysis {
  const copy = structuredClone(pose);
  if (copy.head_pose !== null) {
    copy.head_pose = {
      ...copy.head_pose,
      yaw_ratio: yawRatio,
      yaw_deg: Math.round(yawRatio * 160 * 10) / 10,
    };
  }
  return copy;
}

/**
 * The golden selfie analysis as a three-pose capture: the centre unchanged, a left turn and a
 * right turn (the golden left pose turned each way), and a consistency entry per side. With
 * `mirrored`, every yaw ratio has the sign a mirrored image reads.
 */
export function threePoseAnalysis(options: { mirrored?: boolean } = {}): SelfieAnalysis {
  const golden = selfieFixture();
  const sign = options.mirrored === true ? -1 : 1;
  const side = golden.poses.left;
  const consistency = golden.consistency[0];
  if (side === null || consistency === undefined) {
    throw new Error('the golden selfie fixture has a left pose and its consistency');
  }
  return {
    ...golden,
    poses: {
      center: turned(golden.poses.center, sign * TURNED_YAW.center),
      left: turned(side, sign * TURNED_YAW.left),
      right: turned(side, sign * TURNED_YAW.right),
    },
    consistency: [
      { ...consistency, pose: 'left' },
      { ...consistency, pose: 'right' },
    ],
  };
}

/** A synthetic JPEG: the SOI and APP0 markers, then random bytes. */
export const syntheticJpeg = () => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...randomBytes(48)]);

export interface StoredPoseFile {
  id: string;
  bytes: Uint8Array;
  sha256: string;
  storageKey: string;
}

export interface SeededCapture {
  captureId: string;
  files: Partial<Record<Pose, StoredPoseFile>>;
}

export interface SeedCaptureDeps {
  db: Db;
  keyring: Keyring;
  storage: FileStorage;
}

export interface SeedCaptureInput {
  inquiryId: string;
  verificationId: string;
  /** Centre first; defaults to the C45.1 three poses. */
  prompts?: readonly Pose[];
  method?: 'camera' | 'upload';
  liveness?: 'passive' | 'active';
  /** The C40.4 device snapshot the client submitted, if any. */
  device?: unknown;
  createdAt: Date;
  /** Bytes per pose (a replay test reuses another file's); random JPEG bytes otherwise. */
  bytes?: Partial<Record<Pose, Uint8Array>>;
  /** Prompted poses with no file. */
  omit?: readonly Pose[];
}

/**
 * A capture created at `createdAt`, each prompted pose uploaded under it two seconds apart (the
 * client's elapsed time 1.5 s apart), then consumed by the submit with the device snapshot, and
 * the verification `submitted`.
 */
export async function seedSubmittedCapture(
  deps: SeedCaptureDeps,
  environmentId: string,
  input: SeedCaptureInput,
): Promise<SeededCapture> {
  const { db, keyring, storage } = deps;
  const prompts = input.prompts ?? ['center', 'left', 'right'];
  const captureId = newId('self');
  const at = (seconds: number) => new Date(input.createdAt.getTime() + seconds * 1000);
  await createSelfieCapture(db, environmentId, {
    id: captureId,
    verificationId: input.verificationId,
    inquiryId: input.inquiryId,
    method: input.method ?? 'camera',
    liveness: input.liveness ?? 'active',
    prompts,
    nonceSha256: randomBytes(32),
    createdAt: input.createdAt,
    expiresAt: at(180),
  });
  const stored: SeededCapture['files'] = {};
  for (const [index, pose] of prompts.entries()) {
    if (input.omit?.includes(pose) === true) {
      continue;
    }
    const id = newId('file');
    const bytes = input.bytes?.[pose] ?? syntheticJpeg();
    const sealed = encryptBytes(bytes, keyring, { context: id });
    const storageKey = `${environmentId}/${id}`;
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    await storage.put(storageKey, sealed.ciphertext);
    await db.insert(files).values({
      id,
      environmentId,
      verificationId: input.verificationId,
      kind: POSE_FILE_KINDS[pose],
      storageKey,
      mimeType: 'image/jpeg',
      byteSize: bytes.length,
      sha256,
      wrappedDek: sealed.wrappedDek,
      selfieCaptureId: captureId,
      clientElapsedMs: 1500 * (index + 1),
      receivedAt: at(2 * (index + 1)),
    });
    stored[pose] = { id, bytes, sha256, storageKey };
  }
  const consumed = await consumeSelfieCapture(db, environmentId, {
    id: captureId,
    verificationId: input.verificationId,
    now: at(10),
    ...(input.device === undefined ? {} : { device: input.device }),
  });
  if (consumed === null) {
    throw new Error('seedSubmittedCapture: the capture could not be consumed');
  }
  await setVerificationStatus(db, environmentId, input.verificationId, { to: 'submitted' });
  return { captureId, files: stored };
}

/** A C40.4 device snapshot of an ordinary webcam (synthetic label). */
export const WEBCAM_DEVICE = Object.freeze({
  label: 'Integrated Webcam (0c45:6a10)',
  settings: { width: 1280, height: 720, 'frame-rate': 30, 'facing-mode': 'user' },
  webdriver: false,
  'image-mirrored': false,
});
