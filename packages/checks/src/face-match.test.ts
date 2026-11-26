import { readFileSync } from 'node:fs';
import { DomainError } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FACE_MATCH_THRESHOLD,
  FACE_EMBEDDING_LENGTH,
  InvalidFaceEmbeddingError,
  cosineSimilarity,
  faceMatch,
} from './face-match.js';

/** Synthetic C6 fixture embeddings (seeded unit vectors, never a real face). */
function fixtureEmbedding(file: string, path: readonly string[]): number[] {
  const url = new URL(`../../../contracts/fixtures/vision/${file}.json`, import.meta.url);
  let node: unknown = JSON.parse(readFileSync(url, 'utf8'));
  for (const key of path) {
    node = (node as Record<string, unknown>)[key];
  }
  return node as number[];
}

const idPortrait = fixtureEmbedding('analyze-government-id', [
  'sides',
  'front',
  'portrait',
  'embedding',
]);
const selfieCenter = fixtureEmbedding('analyze-selfie', ['poses', 'center', 'face', 'embedding']);
const otherFace = fixtureEmbedding('embed-face', ['face', 'embedding']);

/** A 128-dimension vector with `value` at `index` and zeros elsewhere. */
function basis(index: number, value = 1): number[] {
  const vector = new Array<number>(FACE_EMBEDDING_LENGTH).fill(0);
  vector[index] = value;
  return vector;
}

describe('constants', () => {
  it('uses SFace embeddings and the shared threshold calibrated by C49', () => {
    expect(FACE_EMBEDDING_LENGTH).toBe(128);
    expect(DEFAULT_FACE_MATCH_THRESHOLD).toBe(0.394);
  });
});

describe('cosineSimilarity', () => {
  it('is 1 for identical directions, whatever the magnitude', () => {
    expect(cosineSimilarity(basis(3), basis(3, 7.5))).toBeCloseTo(1, 12);
  });

  it('is 0 for orthogonal vectors and -1 for opposite ones', () => {
    expect(cosineSimilarity(basis(0), basis(1))).toBe(0);
    expect(cosineSimilarity(basis(5), basis(5, -2))).toBeCloseTo(-1, 12);
  });

  it('matches the documented similarities of the C6 fixtures', () => {
    expect(cosineSimilarity(idPortrait, selfieCenter)).toBeCloseTo(0.72, 2);
    expect(cosineSimilarity(idPortrait, otherFace)).toBeCloseTo(0.05, 2);
  });

  it('is symmetric', () => {
    expect(cosineSimilarity(selfieCenter, idPortrait)).toBe(
      cosineSimilarity(idPortrait, selfieCenter),
    );
  });

  it('stays within [-1, 1] despite rounding', () => {
    const value = cosineSimilarity(idPortrait, [...idPortrait]);
    expect(value).toBeLessThanOrEqual(1);
    expect(value).toBeCloseTo(1, 12);
  });
});

describe('faceMatch', () => {
  it('matches the ID portrait and the selfie of the same synthetic person', () => {
    const result = faceMatch(idPortrait, selfieCenter);
    expect(result.match).toBe(true);
    expect(result.threshold).toBe(0.394);
    expect(result.similarity).toBeCloseTo(0.72, 2);
  });

  it('does not match a different synthetic face', () => {
    const result = faceMatch(idPortrait, otherFace);
    expect(result.match).toBe(false);
    expect(result.similarity).toBeCloseTo(0.05, 2);
  });

  it('matches at exactly the threshold and not just below it', () => {
    const angle = Math.acos(0.5);
    const a = basis(0);
    const b = basis(0, Math.cos(angle));
    b[1] = Math.sin(angle);
    expect(faceMatch(a, b, { threshold: cosineSimilarity(a, b) }).match).toBe(true);
    expect(faceMatch(a, b, { threshold: cosineSimilarity(a, b) + 1e-9 }).match).toBe(false);
  });

  it('honours a custom threshold', () => {
    expect(faceMatch(idPortrait, selfieCenter, { threshold: 0.9 })).toMatchObject({
      match: false,
      threshold: 0.9,
    });
  });

  it.each([
    ['a', () => faceMatch(idPortrait.slice(0, 127), selfieCenter), 'length'],
    ['b', () => faceMatch(idPortrait, [...selfieCenter, 0]), 'length'],
    ['a', () => faceMatch([], selfieCenter), 'length'],
    ['a', () => faceMatch([Number.NaN, ...idPortrait.slice(1)], selfieCenter), 'non_finite'],
    ['b', () => faceMatch(idPortrait, [...selfieCenter.slice(1), Infinity]), 'non_finite'],
    ['b', () => faceMatch(idPortrait, basis(0, 0)), 'zero_norm'],
  ] as const)('rejects an invalid embedding %s (%#)', (which, call, issue) => {
    let thrown: unknown;
    try {
      call();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(InvalidFaceEmbeddingError);
    expect(thrown).toBeInstanceOf(DomainError);
    expect(thrown).toMatchObject({ code: 'invalid_face_embedding', embedding: which, issue });
  });

  it('never echoes embedding values in its errors', () => {
    const leaky = [0.123456789, ...idPortrait.slice(1, 127)];
    try {
      faceMatch(leaky, selfieCenter);
    } catch (error) {
      expect((error as Error).message).not.toContain('0.123456789');
      expect(JSON.stringify(error)).not.toContain('0.123456789');
    }
    expect.assertions(2);
  });

  it('rejects values that are not arrays of numbers', () => {
    expect(() => faceMatch('nope' as unknown as number[], selfieCenter)).toThrow(
      InvalidFaceEmbeddingError,
    );
    const strings = idPortrait.map(String) as unknown as number[];
    expect(() => faceMatch(strings, selfieCenter)).toThrow(InvalidFaceEmbeddingError);
  });

  it.each([Number.NaN, Infinity, -1.01, 1.01])('rejects the threshold %s', (threshold) => {
    expect(() => faceMatch(idPortrait, selfieCenter, { threshold })).toThrow(RangeError);
  });
});
