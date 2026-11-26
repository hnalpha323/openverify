/**
 * C62.1, decision 37: the parsers run over `asn1js@3.1.0` (already locked through
 * `@simplewebauthn/server`, used although younger than 14 days because it is in the lockfile) and
 * `pkijs@3.4.1`; the test chips sign through `@noble/curves` (C65.3). The lockfile must hold one
 * `asn1js` version, so every parser in the install shares its untrusted-input limits.
 * `@openverify/emrtd` reaches the API, the checks and the e2e run as a workspace dependency.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../../..');

interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function manifest(folder: string): Manifest {
  return JSON.parse(readFileSync(path.join(repoRoot, folder, 'package.json'), 'utf8')) as Manifest;
}

/**
 * The versions `pnpm-lock.yaml` resolves `name` to: the `name@version` keys of the `packages:`
 * section of its last document (the first one locks pnpm itself).
 */
function lockedVersions(name: string): string[] {
  const lock = readFileSync(path.join(repoRoot, 'pnpm-lock.yaml'), 'utf8');
  const packages = lock.slice(
    lock.lastIndexOf('\npackages:\n'),
    lock.lastIndexOf('\nsnapshots:\n'),
  );
  const key = name.startsWith('@') ? `'${name}@` : `${name}@`;
  return packages
    .split('\n')
    .filter((line) => line.startsWith(`  ${key}`))
    .map((line) =>
      line
        .trim()
        .replace(/:$/, '')
        .replaceAll("'", '')
        .slice(name.length + 1),
    );
}

describe('the emrtd dependencies (C62.1, decision 37)', () => {
  it('pins asn1js and pkijs exactly, takes @noble/curves from the catalog and core from the workspace', () => {
    expect(manifest('packages/emrtd').dependencies).toEqual({
      '@noble/curves': 'catalog:',
      '@openverify/core': 'workspace:*',
      asn1js: '3.1.0',
      pkijs: '3.4.1',
    });
  });

  it('leaves one asn1js version in the lockfile, the one already locked', () => {
    expect(lockedVersions('asn1js')).toEqual(['3.1.0']);
  });

  it('locks pkijs 3.4.1 and the helpers it brings', () => {
    expect(lockedVersions('pkijs')).toEqual(['3.4.1']);
    expect(lockedVersions('bytestreamjs')).toEqual(['2.0.1']);
    expect(lockedVersions('@noble/curves')).toEqual(['2.4.0']);
  });

  it.each([
    ['apps/api', 'dependencies'],
    ['packages/checks', 'dependencies'],
    ['e2e', 'devDependencies'],
  ] as const)('is a workspace dependency of %s', (folder, group) => {
    expect(manifest(folder)[group]?.['@openverify/emrtd']).toBe('workspace:*');
  });
});
