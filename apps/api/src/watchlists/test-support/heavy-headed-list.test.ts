/**
 * Owner decision 6 after Workflow 6C: the C78.7 gate draws the calibration's 100,000-name table by
 * construction. Its table is `@openverify/watchlist/testing`'s `heavyHeadedTable` of the gate's
 * fixed seed, over the raw rigour groups of `data/` (never the held-out generator), and its output
 * names the case it ran by the data files it found. Every name is fictional, or a form of a test
 * group written here.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { heavyHeadedTable, parseRigourPersonNames } from '@openverify/watchlist/testing';
import { describe, expect, it } from 'vitest';
import { GATE_SEED, gateCase, gateTable, rigourPersonNamesPath } from './heavy-headed-list.js';

const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');

/** Test groups in rigour's `person_names.txt` format: two with a Latin form, one without. */
const RAW = [
  'orlan, orlen, орлан => Q-unit-1',
  'vexby, wexby, vexbi => Q-unit-2',
  'тестов => Q-unit-3',
]
  .map((line) => `${line}\n`)
  .join('');

describe('GATE_SEED', () => {
  it('is 32 hexadecimal digits, so `benchmark:performance --seed` draws the same table', () => {
    expect(GATE_SEED).toMatch(/^[0-9a-f]{32}$/u);
  });

  it('is the evaluation seed docs/calibration/watchlist-phase6c.md published, so the gate draws the table that report measured', () => {
    const report = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        '../../../../../docs/calibration/watchlist-phase6c.md',
      ),
      'utf8',
    );

    expect(/\*\*The evaluation seed\*\* is `([0-9a-f]{32})`/u.exec(report)?.[1]).toBe(GATE_SEED);
  });
});

describe('gateTable', () => {
  it('is the shared 100,000-name table of the seed, over the raw groups', () => {
    const table = gateTable({ seed: 'unit', rawText: RAW });
    const shared = heavyHeadedTable({ seed: 'unit', groups: parseRigourPersonNames(RAW) });

    expect(digest(table.records)).toBe(digest(shared.records));
    expect(digest(table.subjects)).toBe(digest(shared.subjects));
    expect(table.records.reduce((sum, record) => sum + record.names.length, 0)).toBeGreaterThan(
      99_999,
    );
    expect(table.subjects.filter((subject) => subject.subject === 'listed')).toHaveLength(150);
    expect(table.subjects.filter((subject) => subject.entryId === null)).toHaveLength(150);
  }, 120_000);

  it('is drawn over the fictional names alone when data/ has no rigour file', () => {
    const table = gateTable({ seed: 'unit', rawText: null });

    expect(digest(table.records)).toBe(
      digest(heavyHeadedTable({ seed: 'unit', groups: [] }).records),
    );
  }, 120_000);
});

describe('rigourPersonNamesPath', () => {
  it('finds the file the manifest names in a data directory, or null when it is absent or unnamed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openverify-gate-data-'));
    try {
      const manifest = (data: unknown[]) =>
        writeFile(join(directory, 'manifest.json'), JSON.stringify({ data }));
      await manifest([{ name: 'rigour_person_names', filename: 'names.txt' }]);
      expect(rigourPersonNamesPath(directory)).toBeNull();

      await writeFile(join(directory, 'names.txt'), RAW);
      expect(rigourPersonNamesPath(directory)).toBe(join(directory, 'names.txt'));

      await manifest([{ name: 'other', filename: 'names.txt' }]);
      expect(rigourPersonNamesPath(directory)).toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('reads the repository’s data/ by default', () => {
    const data = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../data');
    const { data: entries } = JSON.parse(readFileSync(join(data, 'manifest.json'), 'utf8')) as {
      data: { name: string; filename: string }[];
    };
    const filename = entries.find((entry) => entry.name === 'rigour_person_names')?.filename ?? '';
    const path = join(data, filename);

    expect(rigourPersonNamesPath()).toBe(existsSync(path) ? path : null);
  });
});

describe('gateCase', () => {
  it('names the calibration’s case when both data files are there, and each one missing otherwise', () => {
    expect(gateCase({ variantGroups: 'loaded', rawGroups: true })).toBe('shipped-variant-groups');
    expect(gateCase({ variantGroups: 'missing', rawGroups: true })).toBe(
      'no-variant-groups (data/variant-groups.json missing)',
    );
    expect(gateCase({ variantGroups: 'loaded', rawGroups: false })).toBe(
      'no-raw-groups (data/ has no rigour_person_names file)',
    );
    expect(gateCase({ variantGroups: 'unexpected', rawGroups: false })).toBe(
      'no-variant-groups (data/variant-groups.json unexpected), no-raw-groups (data/ has no rigour_person_names file)',
    );
  });
});
