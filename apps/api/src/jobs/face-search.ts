/**
 * C42.4 and C42.8: the selfie job's searches over stored face data.
 * - {@link scanFaceTemplates}: the 1:N scan of `selfie_repeat_detection`, newest first in batches
 *   up to `face-search-max-templates`, cosines computed in process;
 * - {@link bestTemplateCosine}: the account comparison's best cosine;
 * - {@link faceGroups}: candidates whose faces match each other at the 1:1 threshold share a
 *   group, so the background check counts distinct faces.
 *
 * Embeddings are biometric data: compared in memory, never logged or returned.
 */
import { listFaceTemplates, type Db } from '@openverify/db';

/** Templates decrypted per query of the scan. */
export const FACE_SCAN_BATCH_SIZE = 1000;

export interface FaceScanOptions {
  /** The current centre face (unit vector). */
  embedding: readonly number[];
  /** The current inquiry and every inquiry of its account (C42.4). */
  excludeInquiryIds: readonly string[];
  /** `face-search-max-templates`. */
  maxTemplates: number;
  /** Cosines at or above it are reported in `matchCosines`. */
  floor: number;
  batchSize?: number | undefined;
}

export interface FaceScanResult {
  kind: 'searched';
  /** Templates scored. */
  searched: number;
  /** The cap stopped the scan while older templates remained. */
  truncated: boolean;
  bestCosine: number | null;
  /** Every cosine at or above the floor, in scan order (newest first). */
  matchCosines: number[];
}

/** The cosine of two L2-normalised embeddings: their dot product. */
export function cosineOf(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    throw new Error('cosineOf: the embeddings differ in length');
  }
  let sum = 0;
  for (let index = 0; index < a.length; index += 1) {
    sum += (a[index] ?? 0) * (b[index] ?? 0);
  }
  return sum;
}

/**
 * C42.4: decrypts the environment's templates newest first, `batchSize` at a time, outside
 * `excludeInquiryIds`, up to `maxTemplates`, scoring each against `embedding`. One more row is
 * read past the cap only to tell whether the scan was truncated; it is not scored.
 * @throws when a template cannot be opened (the caller records the check as not executed).
 */
export async function scanFaceTemplates(
  db: Db,
  environmentId: string,
  options: FaceScanOptions,
): Promise<FaceScanResult> {
  const batchSize = Math.max(1, options.batchSize ?? FACE_SCAN_BATCH_SIZE);
  let searched = 0;
  let best: number | null = null;
  const matchCosines: number[] = [];
  let before: { createdAt: Date; id: string } | undefined;
  for (;;) {
    const remaining = options.maxTemplates - searched;
    const batch = await listFaceTemplates(db, environmentId, {
      excludeInquiryIds: options.excludeInquiryIds,
      // One past the cap tells a truncated scan from a complete one.
      limit: Math.min(batchSize, remaining + 1),
      ...(before === undefined ? {} : { before }),
    });
    for (const template of batch.slice(0, remaining)) {
      const cosine = cosineOf(options.embedding, template.embedding);
      searched += 1;
      best = best === null ? cosine : Math.max(best, cosine);
      if (cosine >= options.floor) {
        matchCosines.push(cosine);
      }
    }
    if (batch.length > remaining) {
      return { kind: 'searched', searched, truncated: true, bestCosine: best, matchCosines };
    }
    const last = batch.at(-1);
    if (last === undefined || batch.length < Math.min(batchSize, remaining + 1)) {
      return { kind: 'searched', searched, truncated: false, bestCosine: best, matchCosines };
    }
    before = { createdAt: last.createdAt, id: last.id };
  }
}

/** The best cosine of `embedding` to `templates`, `null` without templates. */
export function bestTemplateCosine(
  embedding: readonly number[],
  templates: readonly (readonly number[])[],
): number | null {
  return templates.reduce<number | null>((best, template) => {
    const cosine = cosineOf(embedding, template);
    return best === null ? cosine : Math.max(best, cosine);
  }, null);
}

/**
 * A group number per face, numbered by first appearance: faces at or above `threshold` to each
 * other share one, transitively (union-find over every pair; at most five candidates).
 */
export function faceGroups(faces: readonly (readonly number[])[], threshold: number): number[] {
  const parent = faces.map((_, index) => index);
  const root = (index: number): number => {
    let current = index;
    while (parent[current] !== current) {
      current = parent[current] ?? current;
    }
    return current;
  };
  faces.forEach((face, index) => {
    for (let other = 0; other < index; other += 1) {
      if (cosineOf(face, faces[other] ?? []) >= threshold) {
        parent[root(index)] = root(other);
      }
    }
  });
  const numbers = new Map<number, number>();
  return faces.map((_, index) => {
    const group = root(index);
    const number = numbers.get(group) ?? numbers.size;
    numbers.set(group, number);
    return number;
  });
}
