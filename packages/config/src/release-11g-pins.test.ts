import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Workflow 11G Stage 1a (contracts-11g): the pins 11G's parts need and the dependency review it was
 * handed (KP11-42, KP11-96), each read on 2026-11-21 and released at least 14 days before it (rule 3;
 * Q5 granted 2026-11-21: the rule covers toolchain binaries, base images and Actions too).
 *
 * - CodeQL (Q1 granted, public at the release; Q9 declined): `github/codeql-action` by commit,
 *   tooling used only once the repository is public, never shipped and never a gate.
 * - uv (Q5): the newest release at least 14 days old, which records-11g applies.
 * - npm publication (Q4, trusted publishing with provenance): pnpm 12.14.0, already the root pin, does
 *   the registry's OIDC exchange and signs provenance itself, so no npm CLI (Artistic-2.0, outside rule
 *   4's list) and no second Node are adopted.
 * - Node 22.23.4 and the two base images by digest (KP11-42), and next 16.4.5 with fast-uri 3.1.9
 *   and 4.2.3 (KP11-96), each past the advisories the H14 table lists.
 */
const root = new URL('../../../', import.meta.url);
const read = (file: string) => readFileSync(new URL(file, root), 'utf8');
const licences = () => read('THIRD_PARTY_LICENSES.md');
const tooling = () => {
  const text = licences();
  const start = text.indexOf('## 1. Development infrastructure and CI');
  return text.slice(start, text.indexOf('## 2. Runtime and build libraries', start));
};

/** The versions pnpm-lock.yaml's `packages:` section holds for `name`. */
function lockedVersions(name: string): string[] {
  const lock = read('pnpm-lock.yaml');
  const packages = lock.slice(
    lock.lastIndexOf('\npackages:\n'),
    lock.lastIndexOf('\nsnapshots:\n'),
  );
  return packages
    .split('\n')
    .filter((line) => line.startsWith(`  ${name}@`))
    .map((line) =>
      line
        .trim()
        .replace(/:$/, '')
        .slice(name.length + 1),
    );
}

/** Whether `version` is at least `floor` (both x.y.z). */
function atLeast(version: string, floor: string): boolean {
  const a = version.split('.').map(Number);
  const b = floor.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) {
      return (a[i] ?? 0) > (b[i] ?? 0);
    }
  }
  return true;
}

describe('the 11G tool pins and their rows (C258.3, C282; Q1, Q4, Q5, Q9)', () => {
  it('records github/codeql-action v4.39.3 by commit, with its bundle, as tooling used only under Q1', () => {
    const row = tooling()
      .split('\n')
      .find((line) => line.startsWith('| github/codeql-action |'));
    expect(row).toContain('| github/codeql-action | v4.39.3 (2026-11-04) | MIT');
    expect(row).toContain('`33d7b85da1a04171e211befe2c739303b9a4c066`');
    expect(row).toContain('codeql-bundle-v2.27.4');
    expect(row).toContain('GitHub CodeQL Terms and Conditions');
  });

  it('no longer lists CodeQL under Not adopted', () => {
    const notAdopted = licences().slice(licences().indexOf('## Not adopted'));
    expect(notAdopted).not.toContain('| CodeQL |');
  });

  it('records uv 0.13.7 with its image index digest and its linux asset checksum (Q5)', () => {
    const row = tooling()
      .split('\n')
      .find((line) => line.startsWith('| uv |'));
    expect(row).toContain('| uv | 0.13.7 (2026-11-03) | MIT OR Apache-2.0 |');
    expect(row).toContain(
      'ghcr.io/astral-sh/uv:0.13.7@sha256:96f40d3904aad8d0bd010539001d36c8e2188b981e1334471a90c4a1d93bb490',
    );
    expect(row).toContain('c5221ff41b7892bfc223543883600125f6a47fe845093e0f5bdff4f359196d83');
  });

  it('records pnpm 12.14.0 as the npm publisher (OIDC trusted publishing with provenance) and adopts no npm CLI (Q4)', () => {
    const row = tooling()
      .split('\n')
      .find((line) => line.startsWith('| pnpm publish (npm trusted publishing and provenance) |'));
    expect(row).toContain('| 12.14.0 (the root `packageManager` pin) | MIT |');
    expect(row).toContain('Artistic-2.0');
    const manifest = JSON.parse(read('package.json')) as { packageManager: string };
    expect(manifest.packageManager).toBe('pnpm@12.14.0');
  });

  it('records Node.js 22.23.4 and both base images by index digest (KP11-42)', () => {
    const text = tooling();
    expect(text).toContain(
      "| Node.js (CI, `release.yml`'s build and the four Node images) | 22.23.4 (2026-10-20) |",
    );
    expect(text).toContain(
      '`node:22.23.4-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d`',
    );
    expect(text).toContain(
      '`python:3.12-slim@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b`',
    );
    expect(licences()).toContain('the Debian of `node:22.23.4-bookworm-slim`');
  });
});

describe('the dependency review (KP11-42, KP11-96)', () => {
  it('pins next 16.4.5 in the catalog and locks it alone, past its seven medium advisories', () => {
    expect(read('pnpm-workspace.yaml')).toMatch(/^ {2}next: 16\.4\.5$/m);
    expect(lockedVersions('next')).toEqual(['16.4.5']);
    expect(licences()).toContain('| Next.js, React, react-dom | 16.4.5, 19.3.1, 19.3.1 |');
  });

  it.each([
    ['3', '3.1.9'],
    ['4', '4.2.3'],
  ])(
    'locks fast-uri %s.x at %s or later (GHSA-w74x-v6f9-j3xg, GHSA-wjr9-j795-jxcr)',
    (major, floor) => {
      const locked = lockedVersions('fast-uri').filter((version) =>
        version.startsWith(`${major}.`),
      );
      expect(locked.length).toBeGreaterThan(0);
      expect(locked.filter((version) => !atLeast(version, floor))).toEqual([]);
    },
  );

  it('adds no release-age exclusion', () => {
    expect(read('pnpm-workspace.yaml')).not.toContain('minimumReleaseAgeExclude');
  });
});
