/**
 * C58.7: our Jaro and Jaro-Winkler (`src/name-matching.ts`) against the vectors that jellyfish
 * 1.2.1 and rapidfuzz 3.14.6 computed offline (`data/jaro-winkler-vectors.json`, built by
 * `scripts/build-jaro-winkler-vectors.py`, where both oracles agree to 1e-12).
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { jaroSimilarity, jaroWinkler } from '../name-matching.js';
import { readMatchingData } from './data-files.js';

const vectorsSchema = z.object({
  oracles: z.object({ jellyfish: z.literal('1.2.1'), rapidfuzz: z.literal('3.14.6') }),
  vectors: z
    .array(
      z.strictObject({
        a: z.string(),
        b: z.string(),
        jaro: z.number().min(0).max(1),
        'jaro-winkler': z.number().min(0).max(1),
      }),
    )
    .min(50),
});

const { vectors } = vectorsSchema.parse(readMatchingData('jaro-winkler-vectors.json'));

describe('Jaro-Winkler against the offline oracles (C58.7)', () => {
  it.each(vectors.map((vector) => [vector.a, vector.b, vector] as const))(
    '%j and %j',
    (a, b, vector) => {
      expect(Math.abs(jaroSimilarity(a, b) - vector.jaro)).toBeLessThan(1e-12);
      expect(Math.abs(jaroWinkler(a, b) - vector['jaro-winkler'])).toBeLessThan(1e-12);
      expect(Math.abs(jaroWinkler(b, a) - vector['jaro-winkler'])).toBeLessThan(1e-12);
    },
  );
});
