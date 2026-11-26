import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  BUILD_VARIANT_GROUPS_ARGS,
  FETCH_DATA_ARGS,
  FETCH_MODELS_ARGS,
  GENERATOR_VERSION_ARGS,
  needsRegeneration,
  readStamp,
} from './assets.js';
import { FIXTURES, REPO_ROOT } from './paths.js';

describe('model weights (C33)', () => {
  it('fetches every model in models/manifest.json, so models added later reach the run', () => {
    expect(FETCH_MODELS_ARGS).toEqual(['scripts/fetch_models.py']);
    expect(FETCH_MODELS_ARGS).not.toContain('--only');
  });
});

describe('data files (C56)', () => {
  it('fetches every file in data/manifest.json, as the CI e2e job does, so the worker reads the disposable list', () => {
    expect(FETCH_DATA_ARGS).toEqual(['scripts/fetch_data.py']);
    expect(FETCH_DATA_ARGS).not.toContain('--only');
  });
});

describe('the variant groups (C78.3, F14)', () => {
  it('builds data/variant-groups.json from the fetched rigour file through the watchlist package script', () => {
    expect(BUILD_VARIANT_GROUPS_ARGS).toEqual([
      '--filter',
      '@openverify/watchlist',
      'build:variant-groups',
    ]);
    const manifest = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'packages', 'watchlist', 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    expect(manifest.scripts['build:variant-groups']).toContain('scripts/build-variant-groups.mjs');
    expect(manifest.scripts['build:variant-groups']).not.toContain('--hold-out');
  });
});

describe('the synthetic fixtures (C36)', () => {
  it('asks the generator for its version', () => {
    expect(GENERATOR_VERSION_ARGS).toEqual([
      'run',
      'python',
      'tools/make_synthetic_fixtures.py',
      '--print-version',
    ]);
    expect(FIXTURES.generatorStamp).toBe(
      path.join(REPO_ROOT, 'fixtures', 'generated', '.generator-version'),
    );
  });

  it.each([
    ['every file is there and the stamp matches', [], '3', '3', false],
    ['a file is missing', ['id-front.jpg'], '3', '3', true],
    ['the stamp is from another version', [], '2', '3', true],
    ['there is no stamp (fixtures from before C36)', [], null, '3', true],
  ] as const)('regenerates only when needed: %s', (_label, missing, stamp, version, expected) => {
    expect(needsRegeneration({ missing, stamp, version })).toBe(expected);
  });

  describe('readStamp', () => {
    let dir: string;
    beforeEach(async () => {
      dir = await mkdtemp(path.join(tmpdir(), 'openverify-e2e-stamp-'));
    });
    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('reads the version a run wrote, without its newline', async () => {
      const file = path.join(dir, '.generator-version');
      await writeFile(file, '3\n');
      expect(await readStamp(file)).toBe('3');
    });

    it('is null when there is no stamp', async () => {
      expect(await readStamp(path.join(dir, '.generator-version'))).toBeNull();
    });

    it('reports any other read failure', async () => {
      await expect(readStamp(dir)).rejects.toMatchObject({ code: 'EISDIR' });
    });
  });
});
