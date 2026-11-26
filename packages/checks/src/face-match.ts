/**
 * Face match on SFace embeddings (contract C6): the vision service returns L2-normalised
 * 128-dimension vectors, and the API compares them here with cosine similarity.
 *
 * Embeddings are biometric data. They are compared in memory and never persisted or logged
 * in Phase 1, so errors from this module name the problem but never echo a value.
 */
import { DomainError, FACE_MATCH_DEFAULTS } from '@openverify/core';

/** Length of an SFace embedding. */
export const FACE_EMBEDDING_LENGTH = 128;

/** The shared SFace cosine threshold (C39.3): a similarity at or above it is a match. */
export const DEFAULT_FACE_MATCH_THRESHOLD = FACE_MATCH_DEFAULTS.threshold;

export type InvalidEmbeddingIssue = 'length' | 'non_finite' | 'zero_norm';

/** An embedding is not 128 finite numbers with a non-zero norm. */
export class InvalidFaceEmbeddingError extends DomainError {
  /** Which argument was invalid: the first (`a`) or the second (`b`). */
  readonly embedding: 'a' | 'b';
  readonly issue: InvalidEmbeddingIssue;

  constructor(embedding: 'a' | 'b', issue: InvalidEmbeddingIssue) {
    super('invalid_face_embedding', `Face embedding ${embedding} is invalid (${issue})`);
    this.embedding = embedding;
    this.issue = issue;
  }
}

export interface FaceMatchOptions {
  /** Cosine similarity at or above which the faces match. Defaults to `FACE_MATCH_DEFAULTS`. */
  threshold?: number;
}

export interface FaceMatchResult {
  /** Cosine similarity in [-1, 1]. */
  similarity: number;
  threshold: number;
  match: boolean;
}

/** Returns the squared norm after checking the length and that every value is finite. */
function checkedSquaredNorm(vector: readonly number[], which: 'a' | 'b'): number {
  if (!Array.isArray(vector) || vector.length !== FACE_EMBEDDING_LENGTH) {
    throw new InvalidFaceEmbeddingError(which, 'length');
  }
  let sum = 0;
  for (const value of vector) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new InvalidFaceEmbeddingError(which, 'non_finite');
    }
    sum += value * value;
  }
  if (sum === 0) {
    throw new InvalidFaceEmbeddingError(which, 'zero_norm');
  }
  return sum;
}

/**
 * Cosine similarity of two 128-dimension embeddings, clamped to [-1, 1].
 * @throws {InvalidFaceEmbeddingError} when either vector is not 128 finite numbers with a
 * non-zero norm.
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  const normA = checkedSquaredNorm(a, 'a');
  const normB = checkedSquaredNorm(b, 'b');
  let dot = 0;
  a.forEach((value, index) => {
    dot += value * (b[index] ?? 0);
  });
  const similarity = dot / Math.sqrt(normA * normB);
  return Math.min(1, Math.max(-1, similarity));
}

/**
 * Compares two face embeddings.
 * @throws {InvalidFaceEmbeddingError} for a malformed embedding.
 * @throws {RangeError} for a threshold outside [-1, 1].
 */
export function faceMatch(
  a: readonly number[],
  b: readonly number[],
  { threshold = DEFAULT_FACE_MATCH_THRESHOLD }: FaceMatchOptions = {},
): FaceMatchResult {
  if (!Number.isFinite(threshold) || threshold < -1 || threshold > 1) {
    throw new RangeError('The face match threshold must be a number in [-1, 1]');
  }
  const similarity = cosineSimilarity(a, b);
  return { similarity, threshold, match: similarity >= threshold };
}

const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;

/**
 * Uncalibrated, margin-based confidence in a face match decision: 0 at the threshold, rising
 * linearly to 1 at a similarity of 1 (match) or -1 (no match). Workflow 4B's calibration (C49)
 * measures the threshold; until then every face comparison is `beta`.
 */
export function faceMatchConfidence(similarity: number, threshold: number): number {
  const span = similarity >= threshold ? 1 - threshold : threshold + 1;
  const margin = Math.abs(similarity - threshold);
  return round4(span === 0 ? 1 : Math.min(1, margin / span));
}
