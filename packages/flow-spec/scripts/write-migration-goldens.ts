/**
 * Writes `src/v2/golden/migrations/<name>.json`: each v1 source of `src/v2/golden/v1-sources.ts`
 * with its migrated v2 flow and the migration's notes (C147.10). Run with
 * `pnpm --filter @openverify/flow-spec exec tsx --conditions=@openverify/source
 * scripts/write-migration-goldens.ts` after a change to the migration, then review the diff;
 * `migrate.test.ts` fails a stale or missing file.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { migrationGolden } from '../src/v2/golden/migration-golden.js';
import { allV1Sources } from '../src/v2/golden/v1-sources.js';

const directory = path.resolve(import.meta.dirname, '../src/v2/golden/migrations');
mkdirSync(directory, { recursive: true });
for (const source of allV1Sources()) {
  const target = path.join(directory, `${source.name}.json`);
  writeFileSync(target, `${JSON.stringify(migrationGolden(source), null, 2)}\n`);
  console.log(`Wrote ${path.relative(process.cwd(), target)}`);
}
