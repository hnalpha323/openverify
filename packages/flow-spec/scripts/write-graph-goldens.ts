/**
 * Writes `src/v2/golden/graph/<name>.json`, the golden flows of the graph rules (C147.6, C148,
 * C152.1; C178.1): the valid base flow, and per rule and case its mutation with the problems it
 * adds, as `src/v2/golden/graph-cases.ts` states them by hand. Run with
 * `pnpm --filter @openverify/flow-spec exec tsx --conditions=@openverify/source
 * scripts/write-graph-goldens.ts`; `graph.test.ts` fails a stale or missing file.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { graphGoldens } from '../src/v2/golden/graph-golden.js';

const directory = path.resolve(import.meta.dirname, '../src/v2/golden/graph');
mkdirSync(directory, { recursive: true });
for (const [name, content] of graphGoldens()) {
  const target = path.join(directory, `${name}.json`);
  writeFileSync(target, `${JSON.stringify(content, null, 2)}\n`);
  console.log(`Wrote ${path.relative(process.cwd(), target)}`);
}
