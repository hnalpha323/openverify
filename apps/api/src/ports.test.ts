import { readFileSync } from 'node:fs';
import { isId } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import {
  actorOf,
  NotImplementedError,
  systemClock,
  ulidIdGenerator,
  type FaceEmbeddingResult,
  type GovernmentIdAnalysis,
  type GovernmentIdSideAnalysis,
  type SelfieAnalysis,
  type SelfiePoseAnalysis,
  type VisionDetectedFace,
  type VisionFace,
  type VisionQuality,
} from './ports.js';

function visionFixture(name: string): Record<string, unknown> {
  const url = new URL(`../../../contracts/fixtures/vision/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as Record<string, unknown>;
}

/** Lists exactly the keys of `T`: the compiler rejects a missing or extra key. */
const keysOf = <T>(keys: Record<keyof T, true>): string[] => Object.keys(keys).sort();

const QUALITY = keysOf<VisionQuality>({
  blur_score: true,
  is_blurry: true,
  glare_ratio: true,
  has_glare: true,
  brightness: true,
  is_too_dark: true,
  is_too_bright: true,
});
const DETECTED_FACE = keysOf<VisionDetectedFace>({ bbox: true, score: true });
const FACE = keysOf<VisionFace>({ bbox: true, score: true, embedding: true });
const SIDE = keysOf<GovernmentIdSideAnalysis>({
  quality: true,
  faces: true,
  portrait: true,
  // C32.1 (Phase 3).
  document: true,
  document_quality: true,
  text: true,
  mrz: true,
  barcodes: true,
  portrait_clarity: true,
  forensics: true,
  phash: true,
});
const POSE = keysOf<SelfiePoseAnalysis>({
  quality: true,
  faces: true,
  face: true,
  // C41.1 (Phase 4).
  image: true,
  face_quality: true,
  head_pose: true,
  passive_liveness: true,
  occlusion: true,
  synthetic: true,
  background: true,
});

const sorted = (value: unknown): string[] => Object.keys(value as object).sort();

describe('NotImplementedError', () => {
  it('names the missing feature and the agent that owns it', () => {
    const error = new NotImplementedError('createFileStorage', 'api-http');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('NotImplementedError');
    expect(error.feature).toBe('createFileStorage');
    expect(error.owner).toBe('api-http');
    expect(error.message).toBe('createFileStorage is not implemented yet (owner: api-http)');
  });
});

describe('systemClock', () => {
  it('reads the current time', () => {
    const before = Date.now();
    const now = systemClock.now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});

describe('ulidIdGenerator', () => {
  it('creates prefixed ULIDs', () => {
    const id = ulidIdGenerator.newId('evt');
    expect(isId('evt', id)).toBe(true);
    expect(ulidIdGenerator.newId('evt')).not.toBe(id);
  });
});

describe('vision port types match the C6 golden fixtures', () => {
  it('POST /v1/analyze/government-id', () => {
    const analysis = visionFixture('analyze-government-id');
    expect(sorted(analysis)).toEqual(
      keysOf<GovernmentIdAnalysis>({ model_versions: true, sides: true }),
    );
    const sides = analysis.sides as Record<string, Record<string, unknown> | null>;
    expect(sorted(sides)).toEqual(
      keysOf<GovernmentIdAnalysis['sides']>({ front: true, back: true }),
    );
    for (const side of [sides.front, sides.back]) {
      if (side) {
        expect(sorted(side)).toEqual(SIDE);
        expect(sorted(side.quality)).toEqual(QUALITY);
        for (const face of side.faces as unknown[]) {
          expect(sorted(face)).toEqual(DETECTED_FACE);
        }
        if (side.portrait !== null) {
          expect(sorted(side.portrait)).toEqual(FACE);
        }
      }
    }
  });

  it('POST /v1/analyze/selfie', () => {
    const analysis = visionFixture('analyze-selfie');
    expect(sorted(analysis)).toEqual(
      keysOf<SelfieAnalysis>({ model_versions: true, poses: true, consistency: true }),
    );
    const poses = analysis.poses as Record<string, Record<string, unknown> | null>;
    expect(sorted(poses)).toEqual(
      keysOf<SelfieAnalysis['poses']>({ center: true, left: true, right: true }),
    );
    for (const pose of Object.values(poses)) {
      if (pose) {
        expect(sorted(pose)).toEqual(POSE);
        expect(sorted(pose.quality)).toEqual(QUALITY);
        if (pose.face !== null) {
          expect(sorted(pose.face)).toEqual(FACE);
        }
      }
    }
  });

  it('POST /v1/embed/face', () => {
    const result = visionFixture('embed-face');
    expect(sorted(result)).toEqual(
      keysOf<FaceEmbeddingResult>({ model_versions: true, face: true, face_count: true }),
    );
    expect(sorted(result.model_versions)).toEqual(['detector', 'recognizer']);
    if (result.face !== null) {
      expect(sorted(result.face)).toEqual(FACE);
    }
  });
});

describe('Phase 2 stub owners', () => {
  it.each([
    'api-inquiries',
    'api-lifecycle',
    'api-platform',
    'api-integrations',
    'api-operators',
  ] as const)('names %s as the owner of a stub', (owner) => {
    const error = new NotImplementedError('createSomething', owner);

    expect(error.owner).toBe(owner);
    expect(error.message).toBe(`createSomething is not implemented yet (owner: ${owner})`);
  });
});

describe('actorOf (C15 audit actor)', () => {
  it('is the API key of an api-key principal', () => {
    expect(
      actorOf({
        kind: 'api-key',
        apiKeyId: 'key_01M5CJXHG0000000000000000A',
        organizationId: 'org_01M5CJXHG0000000000000000A',
        environmentId: 'env_01M5CJXHG0000000000000000A',
        environmentKind: 'sandbox',
        permissions: new Set(),
      }),
    ).toEqual({ type: 'api-key', id: 'key_01M5CJXHG0000000000000000A' });
  });

  it('is the user of a user principal, not the session', () => {
    expect(
      actorOf({
        kind: 'user',
        userId: 'usr_01M5CJXHG0000000000000000A',
        userSessionId: 'uss_01M5CJXHG0000000000000000A',
        organizationId: 'org_01M5CJXHG0000000000000000A',
        environmentId: 'env_01M5CJXHG0000000000000000A',
        environmentKind: 'production',
        permissions: new Set(['pii:view']),
        mfaSatisfied: true,
      }),
    ).toEqual({ type: 'user', id: 'usr_01M5CJXHG0000000000000000A' });
  });
});
