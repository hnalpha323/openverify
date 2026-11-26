/**
 * Writes `src/v2/pattern/vectors.json`, the golden vectors of C148.3's matcher (P03, V10): our
 * web and server matcher passes them today and Android's Kotlin port must pass the same file in
 * Phase 10 (C175.1). Run with `pnpm --filter @openverify/flow-spec exec tsx
 * scripts/write-pattern-vectors.ts`; `pattern.test.ts` checks every vector against both our
 * matcher and ECMAScript's `RegExp` (the oracle, run here and in that test on these fixed patterns
 * only, never on an operator's text) and fails when the file is stale.
 *
 * Inputs come from each pattern's own small alphabet through a seeded generator, so the file is
 * long but nothing in it is typed by hand beyond the patterns and their seeds.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { PATTERN_VECTOR_SOURCES, generatePatternVectors } from './pattern-vector-sources.js';

const target = path.resolve(import.meta.dirname, '../src/v2/pattern/vectors.json');
writeFileSync(
  target,
  `${JSON.stringify(generatePatternVectors(PATTERN_VECTOR_SOURCES), null, 2)}\n`,
);
console.log(`Wrote ${path.relative(process.cwd(), target)}`);
