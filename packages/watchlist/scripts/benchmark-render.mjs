// @ts-check
/**
 * Prints the tables of `docs/calibration/watchlist-phase6.md` from the benchmarks' result files
 * (evaluation-6, plan C78.7 and C78.8), through the tested renderer in `benchmark-report.mjs`.
 *
 *   pnpm --filter @openverify/watchlist benchmark:render [--out /tmp/openverify-eval-6]
 *
 * `--out` is a run's directory, holding `quality/` and `performance/` as the steps write them.
 * Workflow 6C's tables (the typo kinds, the held-out population in each table, the unlisted
 * alerts, the compacted round, the development variants, and a base and head comparison written
 * to `<out>/compare.json`) are printed after the 6B tables, each when its file exists.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  compactMarkdown,
  compareMarkdown,
  performanceMarkdown,
  qualityMarkdown,
  scaleMarkdown,
  typoKindsMarkdown,
  unlistedMarkdown,
  variantsMarkdown,
} from './benchmark-report.mjs';

/** @param {string} path */
const json = async (path) => /** @type {any} */ (JSON.parse(await readFile(path, 'utf8')));
/** @param {string} path */
const optional = (path) => json(path).catch(() => undefined);

const { values } = parseArgs({
  options: { out: { type: 'string', default: '/tmp/openverify-eval-6' } },
});
const performance = join(values.out, 'performance');
const quality = await optional(join(values.out, 'quality', 'results.json'));
if (quality !== undefined) {
  process.stdout.write(`${qualityMarkdown(quality)}\n`);
}
const typoKinds = await optional(join(values.out, 'quality', 'typo-kinds.json'));
if (typoKinds !== undefined) {
  process.stdout.write(`${typoKindsMarkdown(typoKinds)}\n`);
}
/** @type {Record<string, unknown>} */
const scaleResults = {};
for (const scale of ['100k', '2m']) {
  const results = await optional(join(values.out, 'quality', `scale-${scale}`, 'results.json'));
  if (results !== undefined) {
    scaleResults[scale] = results;
  }
}
if (Object.keys(scaleResults).length > 0) {
  process.stdout.write(`${scaleMarkdown(scaleResults)}\n`);
}
const machine = await optional(join(performance, 'machine.json'));
if (machine !== undefined) {
  /** @type {Record<string, { imports: unknown[], measure: any }>} */
  const scales = {};
  for (const scale of ['100k', '2m']) {
    const imports = [];
    // A run's import parts (8 at 2,000,000 names unless the run chose `--parts`).
    for (let part = 1; part <= 64; part += 1) {
      const record = await optional(join(performance, scale, `import-${String(part)}.json`));
      if (record === undefined) {
        break;
      }
      imports.push(record);
    }
    scales[scale] = { imports, measure: await optional(join(performance, scale, 'measure.json')) };
  }
  const runs = [];
  for (const size of [100, 300, 1000, 3000]) {
    const run = await optional(join(performance, 'rescreen', `${String(size)}.json`));
    if (run !== undefined) {
      runs.push(run);
    }
  }
  const version = String(scales['100k']?.measure?.database?.version ?? '');
  process.stdout.write(
    performanceMarkdown({
      machine,
      postgres: /^PostgreSQL [\d.]+/u.exec(version)?.[0] ?? 'PostgreSQL',
      scales,
      rescreen: { seed: await optional(join(performance, 'rescreen', 'seed.json')), runs },
    }),
  );
}
/** @type {Record<string, Record<string, unknown>>} */
const extra = { unlisted: {}, compact: {}, variants: {} };
for (const scale of ['100k', '2m']) {
  for (const name of Object.keys(extra)) {
    const record = await optional(join(performance, scale, `${name}.json`));
    if (record !== undefined) {
      /** @type {Record<string, unknown>} */ (extra[name])[scale] = record;
    }
  }
}
for (const [name, render] of /** @type {const} */ ([
  ['unlisted', unlistedMarkdown],
  ['compact', compactMarkdown],
  ['variants', variantsMarkdown],
])) {
  const scales = extra[name] ?? {};
  if (Object.keys(scales).length > 0) {
    process.stdout.write(`${render(scales)}\n`);
  }
}
const comparison = await optional(join(values.out, 'compare.json'));
if (comparison !== undefined) {
  process.stdout.write(`${compareMarkdown(comparison)}\n`);
}
