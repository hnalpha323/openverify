import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

interface Manifest {
  name?: string;
  version?: string;
  private?: boolean;
  type?: string;
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface WorkspaceProject {
  dir: string;
  folder: string;
  manifest: Manifest;
}

const repoRoot = path.resolve(import.meta.dirname, '../../..');

function listProjects(group: 'apps' | 'packages'): WorkspaceProject[] {
  const groupDir = path.join(repoRoot, group);
  if (!existsSync(groupDir)) {
    return [];
  }
  return readdirSync(groupDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(groupDir, entry.name))
    .filter((dir) => existsSync(path.join(dir, 'package.json')))
    .map((dir) => ({
      dir,
      folder: path.basename(dir),
      manifest: JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as Manifest,
    }));
}

const projects = [...listProjects('apps'), ...listProjects('packages')];

/**
 * C159.1 (Workflow 9A): a package published under a name other than its folder's. The embed client
 * lives in `packages/sdk-js` and is published as `@openverify/js` (Phase 11).
 */
const PUBLISHED_NAMES: Readonly<Record<string, string>> = {
  'sdk-js': '@openverify/js',
  // C266.2 (Workflow 11C Stage 1a): the React bindings, `packages/sdk-react`, are `@openverify/react`.
  'sdk-react': '@openverify/react',
};
const phaseZeroProjects = [
  '@openverify/api',
  '@openverify/dashboard',
  '@openverify/flow',
  '@openverify/checks',
  '@openverify/config',
  '@openverify/core',
  '@openverify/db',
  '@openverify/flow-spec',
  '@openverify/ui',
];

describe('workspace conventions', () => {
  it('contains every Phase 0 skeleton', () => {
    expect(projects.map((project) => project.manifest.name)).toEqual(
      expect.arrayContaining(phaseZeroProjects),
    );
  });

  describe.each(projects)('$manifest.name', ({ dir, folder, manifest }) => {
    it('is a private, unversioned ESM package named after its folder', () => {
      expect(manifest).toMatchObject({
        name: PUBLISHED_NAMES[folder] ?? `@openverify/${folder}`,
        version: '0.0.0',
        private: true,
        type: 'module',
      });
    });

    it('exposes lint, typecheck and a coverage-gated test script', () => {
      expect(manifest.scripts).toMatchObject({
        lint: expect.any(String) as unknown,
        typecheck: expect.any(String) as unknown,
        test: 'vitest run --coverage',
      });
    });

    it('takes its Vitest config from the shared 80% coverage helper', () => {
      const vitestConfigPath = path.join(dir, 'vitest.config.ts');

      expect(existsSync(vitestConfigPath)).toBe(true);
      expect(readFileSync(vitestConfigPath, 'utf8')).toContain('@openverify/config/vitest');
    });
  });

  // Phase 9 decision 62: the 14-day rule is configuration, not a convention. An explicit
  // minimumReleaseAge makes pnpm strict (a young pick fails), and every install re-checks the
  // locked entries, so an exclusion, a loose mode or a trusted lockfile would each reopen it.
  it('holds every dependency to a 14-day release age, with no way around it', () => {
    const workspace = readFileSync(path.join(repoRoot, 'pnpm-workspace.yaml'), 'utf8');

    expect(workspace).toMatch(/^minimumReleaseAge: 20160$/m);
    expect(workspace).not.toMatch(/^\s*minimumReleaseAgeExclude:/m);
    expect(workspace).not.toMatch(/^\s*minimumReleaseAgeStrict:\s*false\b/m);
    expect(workspace).not.toMatch(/^\s*trustLockfile:\s*true\b/m);
  });

  // Phase 7 R011: from Phase 5 on, the catalog's comments promise exact pins, each at least 14 days
  // old when adopted, so a range there (jsdom's ^29.1.1 was one) could move without a review.
  it('pins every catalog entry exactly from the first "exact pins" comment on', () => {
    const workspace = readFileSync(path.join(repoRoot, 'pnpm-workspace.yaml'), 'utf8');
    // The catalog block runs from `catalog:` to the next top-level key.
    // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
    const [catalog = ''] = /\ncatalog:\n(?:[ #].*\n|\n)*/.exec(workspace) ?? [];
    const pinned = catalog.slice(catalog.indexOf('exact pins'));
    const entries = [...pinned.matchAll(/^ {2}('?[@\w./-]+'?): (\S+)$/gm)].map(
      ([, name, spec]) => ({
        name,
        spec,
      }),
    );

    expect(entries.length).toBeGreaterThan(20);
    expect(entries.filter(({ spec }) => !/^\d+\.\d+\.\d+$/.test(spec ?? ''))).toEqual([]);
  });

  // CI starts from a clean checkout with no `dist/`, so an integration config that does not
  // resolve workspace packages to their sources fails there while passing locally.
  const withIntegrationConfig = projects.filter(({ dir }) =>
    existsSync(path.join(dir, 'vitest.integration.config.ts')),
  );

  it('finds the integration test configs', () => {
    expect(withIntegrationConfig.length).toBeGreaterThan(0);
  });

  describe.each(withIntegrationConfig)('$manifest.name integration config', ({ dir }) => {
    it('resolves workspace packages to their sources, so no prior build is needed', () => {
      const config = readFileSync(path.join(dir, 'vitest.integration.config.ts'), 'utf8');

      expect(config).toContain('SOURCE_CONDITION');
    });

    // `pnpm test:integration` runs the db and api suites at once, and each test file starts its
    // own Postgres: with Vitest's default workers that was 22 containers migrating at once on 12
    // CPUs, and tests that take 10 s passed their 30 s limit (after Workflow 6B).
    it('caps its workers as the unit configs do, and gives each test a minute', () => {
      const config = readFileSync(path.join(dir, 'vitest.integration.config.ts'), 'utf8');

      expect(config).toContain('maxWorkers: TEST_MAX_WORKERS');
      expect(config).toContain('testTimeout: 60_000');
    });
  });
});
