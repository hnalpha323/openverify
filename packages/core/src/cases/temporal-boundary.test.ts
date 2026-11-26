/**
 * F30 (plan C133.3): business time runs on `temporal-polyfill` in the API alone
 * (`apps/api/src/services/cases/sla/business-time.ts`), so the polyfill (about 34 kB gzipped,
 * `docs/research/phase8-editor-cases.md` 4.5) never enters the flow's bundle. The flow bundles
 * `@openverify/core` through `@openverify/contracts`, so the guard is here: core neither declares nor
 * imports it, and no workspace package the flow can bundle declares it at run time.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPOSITORY = fileURLToPath(new URL('../../../../', import.meta.url));
const CORE = join(REPOSITORY, 'packages/core');
const TEMPORAL = /^(?:temporal-polyfill|temporal-spec|temporal-utils|@js-temporal\/.*)$/;

interface Manifest {
  readonly name: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
}

const manifestAt = (directory: string): Manifest =>
  JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as Manifest;

/** Every workspace package by name, from the two folders the workspace lists. */
function workspacePackages(): Map<string, string> {
  const found = new Map<string, string>();
  for (const folder of ['apps', 'packages']) {
    for (const entry of readdirSync(join(REPOSITORY, folder), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const directory = join(REPOSITORY, folder, entry.name);
        try {
          found.set(manifestAt(directory).name, directory);
        } catch {
          // A folder without a manifest is not a package.
        }
      }
    }
  }
  return found;
}

const declared = (manifest: Manifest): string[] => [
  ...Object.keys(manifest.dependencies ?? {}),
  ...Object.keys(manifest.devDependencies ?? {}),
  ...Object.keys(manifest.peerDependencies ?? {}),
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** `from 'x'`, `import 'x'`, `import('x')` and `require('x')`, as the formatter writes them. */
const SPECIFIER = /(?:\bfrom |\bimport |\bimport\(|\brequire\()['"]([^'"]+)['"]/g;

describe('temporal-polyfill stays out of core and the flow (F30, C133.3)', () => {
  it('is not declared by @openverify/core', () => {
    expect(declared(manifestAt(CORE)).filter((name) => TEMPORAL.test(name))).toEqual([]);
  });

  it('is imported by no source of @openverify/core', () => {
    const files = sourceFiles(join(CORE, 'src'));
    expect(files.length).toBeGreaterThan(50);
    const importing = files.filter((file) =>
      [...readFileSync(file, 'utf8').matchAll(SPECIFIER)].some(([, specifier]) =>
        TEMPORAL.test(specifier ?? ''),
      ),
    );
    expect(importing).toEqual([]);
  });

  it('is declared at run time by no workspace package the flow can bundle', () => {
    const packages = workspacePackages();
    const seen = new Set<string>();
    const pending = ['@openverify/flow'];
    while (pending.length > 0) {
      const name = pending.pop() ?? '';
      const directory = packages.get(name);
      if (seen.has(name) || directory === undefined) {
        continue;
      }
      seen.add(name);
      pending.push(
        ...declared(manifestAt(directory)).filter((dependency) => packages.has(dependency)),
      );
    }
    expect(seen).toContain('@openverify/core');
    expect(seen).not.toContain('@openverify/api');
    expect(seen).not.toContain('@openverify/workflow-engine');
    const runtime = [...seen].flatMap((name) =>
      Object.keys(manifestAt(packages.get(name) ?? '').dependencies ?? {})
        .filter((dependency) => TEMPORAL.test(dependency))
        .map((dependency) => `${name} -> ${dependency}`),
    );
    expect(runtime).toEqual([]);
  });

  it('is declared where business time and schedules run', () => {
    const packages = workspacePackages();
    const declaring = [...packages.entries()]
      .filter(([, directory]) =>
        Object.keys(manifestAt(directory).dependencies ?? {}).includes('temporal-polyfill'),
      )
      .map(([name]) => name)
      .sort();
    expect(declaring).toEqual(['@openverify/api', '@openverify/workflow-engine']);
  });
});
