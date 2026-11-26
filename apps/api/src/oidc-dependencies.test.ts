import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Workflow 11B Stage 1a (contracts-11b; C248.2): the OIDC libraries, each pinned exactly in the
 * catalog at a version published on or before 2026-10-15 (all three on 2026-09-05, read from the
 * registry on 2026-11-13), MIT, with no build script, one version each in the lockfile, and a
 * licence row with its date.
 */
const root = new URL('../../../', import.meta.url);
const read = (file: string) => readFileSync(new URL(file, root), 'utf8');

const PINS = [
  ['openid-client', '6.8.8'],
  ['oauth4webapi', '3.8.8'],
  ['jose', '6.2.12'],
] as const;

describe('the Workflow 11B OIDC dependencies (C248.2)', () => {
  it.each(PINS)('pins %s %s in the catalog and gives it to the API through it', (name, version) => {
    expect(read('pnpm-workspace.yaml')).toContain(`\n  ${name}: ${version}\n`);
    const api = JSON.parse(read('apps/api/package.json')) as {
      dependencies?: Record<string, string>;
    };
    expect(api.dependencies?.[name]).toBe('catalog:');
  });

  it.each(PINS)('locks one %s, the pinned %s', (name, version) => {
    const versions = new Set(
      read('pnpm-lock.yaml').match(new RegExp(`^ {2}${name}@[\\d.]+`, 'gm')),
    );
    expect(versions).toEqual(new Set([`  ${name}@${version}`]));
  });

  it.each(PINS)('carries a licence row for %s %s, MIT, dated', (name, version) => {
    expect(read('THIRD_PARTY_LICENSES.md')).toContain(`| ${name} | ${version} (2026-09-05) | MIT`);
  });

  it('adds no release-age exclusion', () => {
    expect(read('pnpm-workspace.yaml')).not.toContain('minimumReleaseAgeExclude');
  });
});
