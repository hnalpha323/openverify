// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The analytics charts' primitives (C164.9, decision 42; owner decision B9 (b), 2026-11-06):
 * `d3-scale` and `d3-shape`, ISC, pinned in the catalog at versions at least 14 days old, with
 * axes, groups and text drawn as plain React SVG. visx is not adopted: `@visx/vendor` pulls in
 * `robust-predicates`, licensed only under The Unlicense, which CLAUDE.md rule 4 does not list.
 */
const root = new URL('../../../', import.meta.url);
const read = (file: string) => readFileSync(new URL(file, root), 'utf8');
const manifest = JSON.parse(read('apps/dashboard/package.json')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

describe('the chart dependencies', () => {
  it.each([
    ['d3-scale', '4.0.2'],
    ['d3-shape', '3.2.0'],
    ['@types/d3-scale', '4.0.9'],
    ['@types/d3-shape', '3.2.0'],
  ])('pins %s %s in the catalog', (name, version) => {
    const quoted = name.startsWith('@') ? `'${name}'` : name;
    expect(read('pnpm-workspace.yaml')).toContain(`\n  ${quoted}: ${version}\n`);
  });

  it('gives the dashboard the primitives at run time and their types for development', () => {
    expect(manifest.dependencies?.['d3-scale']).toBe('catalog:');
    expect(manifest.dependencies?.['d3-shape']).toBe('catalog:');
    expect(manifest.devDependencies?.['@types/d3-scale']).toBe('catalog:');
    expect(manifest.devDependencies?.['@types/d3-shape']).toBe('catalog:');
  });

  it('adds no visx package, no robust-predicates and no release-age exclusion', () => {
    const lockfile = read('pnpm-lock.yaml');
    expect(lockfile).not.toMatch(/^\s+'?@visx\//m);
    expect(lockfile).not.toMatch(/^\s+robust-predicates@/m);
    expect(lockfile).not.toMatch(/^\s+d3-delaunay@/m);
    expect(read('pnpm-workspace.yaml')).not.toContain('minimumReleaseAgeExclude');
  });

  it('carries a licence row for every package the two bring in, from the lockfile', () => {
    const licences = read('THIRD_PARTY_LICENSES.md');
    const lockfile = read('pnpm-lock.yaml');
    for (const name of [
      'd3-scale',
      'd3-shape',
      'd3-array',
      'd3-format',
      'd3-time',
      'd3-time-format',
      'd3-path',
      'internmap',
      '@types/d3-scale',
      '@types/d3-shape',
      '@types/d3-time',
      '@types/d3-path',
    ]) {
      const versions = new Set(
        [...lockfile.matchAll(new RegExp(`^ {2}'?${name}@(\\d+\\.\\d+\\.\\d+)'?:`, 'gm'))].map(
          ([, version]) => version,
        ),
      );
      expect(versions.size, name).toBe(1);
      const [version = ''] = [...versions];
      expect(licences, name).toMatch(
        new RegExp(`\\| ${name.replace('/', '\\/')} \\| ${version.replaceAll('.', '\\.')} \\(`),
      );
    }
  });
});
