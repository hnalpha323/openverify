import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Workflow 8A Stage 1a (common): what the engine needs, each pinned exactly in the catalog at a
 * version at least 14 days old when adopted, with a licence rule 4 allows. Not the umbrella
 * `quickjs-emscripten`, not an `asyncify` variant and not the `quickjs-ng` variant (C123.1).
 */
const root = new URL('../../../', import.meta.url);
const read = (file: string) => readFileSync(new URL(file, root), 'utf8');
const manifest = (file: string) =>
  JSON.parse(read(file)) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

describe('the Workflow 8A dependencies', () => {
  it.each([
    ['bullmq', '6.3.14'],
    ['cron-parser', '5.10.2'],
    ['temporal-polyfill', '1.0.5'],
    ['quickjs-emscripten-core', '0.32.0'],
    ['@jitl/quickjs-wasmfile-release-sync', '0.32.0'],
    ['json-logic-js', '2.0.5'],
  ])('pins %s %s in the catalog', (name, version) => {
    const quoted = name.startsWith('@') ? `'${name}'` : name;
    expect(read('pnpm-workspace.yaml')).toContain(`\n  ${quoted}: ${version}\n`);
  });

  it('gives the engine its runtime libraries from the catalog, and the oracle as a dev dependency', () => {
    const engine = manifest('packages/workflow-engine/package.json');
    for (const name of [
      'cron-parser',
      'temporal-polyfill',
      'quickjs-emscripten-core',
      '@jitl/quickjs-wasmfile-release-sync',
    ]) {
      expect(engine.dependencies?.[name], name).toBe('catalog:');
    }
    expect(engine.devDependencies?.['json-logic-js']).toBe('catalog:');
    expect(engine.dependencies?.['json-logic-js']).toBeUndefined();
  });

  it('moves the API to the bumped queue library, through the catalog (decision 3)', () => {
    expect(manifest('apps/api/package.json').dependencies?.bullmq).toBe('catalog:');
  });

  it('gives the API the polyfill for business time, through the catalog (C133.3, V14)', () => {
    expect(manifest('apps/api/package.json').dependencies?.['temporal-polyfill']).toBe('catalog:');
    expect(read('THIRD_PARTY_LICENSES.md')).toMatch(
      /\| temporal-polyfill \| 1\.0\.5[^\n]*`apps\/api`[^\n]*business time/,
    );
  });

  it('adds no build script and no release-age exclusion', () => {
    const workspace = read('pnpm-workspace.yaml');
    expect(workspace).not.toContain('minimumReleaseAgeExclude');
    // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
    const [, builds = ''] = /allowBuilds:\n((?: {2}.+\n)+)/.exec(workspace) ?? [];
    expect(builds.match(/: true$/gm)).toBeNull();
  });

  it('holds one cron-parser and one bullmq in the lockfile, the pinned ones', () => {
    const lock = read('pnpm-lock.yaml');
    // The packages section and the snapshots section each list a version once.
    const versions = (name: string) =>
      new Set(lock.match(new RegExp(`^ {2}${name}@[\\d.]+`, 'gm')) ?? []);
    expect(versions('cron-parser')).toEqual(new Set(['  cron-parser@5.10.2']));
    expect(versions('bullmq')).toEqual(new Set(['  bullmq@6.3.14']));
  });

  it('carries a licence row for each, and the Emscripten notice', () => {
    const licences = read('THIRD_PARTY_LICENSES.md');
    for (const row of [
      '| bullmq | 6.3.14',
      '| cron-parser | 5.10.2',
      '| temporal-polyfill | 1.0.5',
      '| temporal-spec | 1.0.1',
      '| temporal-utils | 1.0.3',
      '| quickjs-emscripten-core | 0.32.0',
      '| @jitl/quickjs-wasmfile-release-sync | 0.32.0',
      '| @jitl/quickjs-ffi-types | 0.32.0',
      '| json-logic-js | 2.0.5',
    ]) {
      expect(licences, row).toContain(row);
    }
    expect(licences).toMatch(/Emscripten[^\n]*MIT[^\n]*NCSA/);
  });
});
