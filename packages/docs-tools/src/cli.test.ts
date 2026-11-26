import { describe, expect, it } from 'vitest';
import type { AreaEntryPoints } from './areas.js';
import {
  EXIT_FAILED,
  EXIT_NOT_BUILT,
  EXIT_OK,
  EXIT_USAGE,
  main,
  runCli,
  type CliDeps,
} from './cli.js';
import type { ReleaseCheckOptions, ReleaseCheckResult } from './release/index.js';
import { createMemoryRepository } from './repository.js';
import { DOCS_AREAS, type CheckFinding, type DocsArea, type RenderResult } from './types.js';

interface Recorded {
  readonly deps: CliDeps;
  readonly written: Map<string, string>;
  readonly out: string[];
  readonly err: string[];
  readonly checked: ReleaseCheckOptions[];
}

const built = (area: DocsArea): RenderResult => ({
  area,
  status: 'built',
  files: [
    { path: `docs/${area}/b.md`, content: 'b\n' },
    { path: `docs/${area}/a.md`, content: 'a\n' },
  ],
});

function record(
  overrides: {
    areas?: Partial<Record<DocsArea, AreaEntryPoints>>;
    findings?: CheckFinding[];
    built?: boolean;
  } = {},
): Recorded {
  const written = new Map<string, string>();
  const out: string[] = [];
  const err: string[] = [];
  const checked: ReleaseCheckOptions[] = [];
  const deps: CliDeps = {
    repo: createMemoryRepository({}),
    write: (path, content) => written.set(path, content),
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    ...(overrides.areas === undefined ? {} : { areas: overrides.areas }),
    ...(overrides.findings === undefined
      ? {}
      : {
          releaseCheck: (_repo, options): ReleaseCheckResult => {
            checked.push(options);
            return {
              name: 'release:check',
              mode: options.tag ? 'tag' : 'default',
              status: overrides.built === false ? 'not-built' : 'built',
              findings: overrides.findings ?? [],
            };
          },
        }),
  };
  return { deps, written, out, err, checked };
}

const error: CheckFinding = {
  rule: 'evidence',
  path: 'docs/release/checklist.md',
  line: 3,
  message: 'missing',
  severity: 'error',
};
const owner: CheckFinding = {
  rule: 'owner',
  path: 'docs/PROGRESS.md',
  message: 'Q1 pending',
  severity: 'owner',
};

describe('the docs-tools CLI', () => {
  it('refuses an unknown command, a missing area and an unknown area with usage', () => {
    for (const argv of [
      [],
      ['publish'],
      ['render'],
      ['render', 'everything'],
      ['release-check', '--force'],
    ]) {
      const run = record();
      expect(runCli(argv, run.deps)).toBe(EXIT_USAGE);
      expect(run.err.join('\n')).toContain('usage: docs-tools');
      expect(run.written.size).toBe(0);
    }
  });

  it('writes nothing for an area its owner has not built, and says whose it is', () => {
    const run = record({
      areas: {
        catalog: {
          render: () => ({ area: 'catalog', status: 'not-built', files: [] }),
          check: () => [],
        },
      },
    });

    expect(runCli(['render', 'catalog'], run.deps)).toBe(EXIT_NOT_BUILT);
    expect(run.written.size).toBe(0);
    expect(run.err).toEqual(['catalog: not built yet (docs-catalog)']);
  });

  it('writes a built area through the injected writer, sorted by path, and counts it', () => {
    const run = record({
      areas: { security: { render: () => built('security'), check: () => [] } },
    });

    expect(runCli(['render', 'security'], run.deps)).toBe(EXIT_OK);
    expect([...run.written.keys()]).toEqual(['docs/security/a.md', 'docs/security/b.md']);
    expect(run.out).toEqual(['security: 2 files written']);
  });

  it('renders every area for all, and answers not built while one is a stub', () => {
    // Every other area is injected as a stub, so the test holds while the real areas get built.
    const stubs = Object.fromEntries(
      DOCS_AREAS.map((area): [DocsArea, AreaEntryPoints] => [
        area,
        { render: () => ({ area, status: 'not-built', files: [] }), check: () => [] },
      ]),
    );
    const run = record({
      areas: { ...stubs, security: { render: () => built('security'), check: () => [] } },
    });

    expect(runCli(['render', 'all'], run.deps)).toBe(EXIT_NOT_BUILT);
    expect(run.written.size).toBe(2);
    expect(run.err).toHaveLength(5);
  });

  it('refuses a render that returns another area or a path that leaves the repository', () => {
    const wrongArea = record({
      areas: { records: { render: () => built('security'), check: () => [] } },
    });
    expect(runCli(['render', 'records'], wrongArea.deps)).toBe(EXIT_FAILED);
    expect(wrongArea.written.size).toBe(0);

    const escaping = record({
      areas: {
        records: {
          render: () => ({
            area: 'records',
            status: 'built',
            files: [{ path: '../x.md', content: '' }],
          }),
          check: () => [],
        },
      },
    });
    expect(runCli(['render', 'records'], escaping.deps)).toBe(EXIT_FAILED);
    expect(escaping.written.size).toBe(0);
    expect(escaping.err.join('\n')).toContain('../x.md');
  });

  it('runs release:check in the default mode and passes --tag through', () => {
    const run = record({ findings: [] });

    expect(runCli(['release-check'], run.deps)).toBe(EXIT_OK);
    expect(runCli(['release-check', '--tag'], run.deps)).toBe(EXIT_OK);
    expect(run.checked).toEqual([{ tag: false }, { tag: true }]);
    expect(run.out).toContain('release:check (default): 0 errors, 0 owner items');
  });

  it('fails release:check on an error in both modes, and on an owner item only with --tag', () => {
    const failing = record({ findings: [error, owner] });
    expect(runCli(['release-check'], failing.deps)).toBe(EXIT_FAILED);
    expect(failing.err).toContain('error docs/release/checklist.md:3 evidence: missing');

    const ownerOnly = record({ findings: [owner] });
    expect(runCli(['release-check'], ownerOnly.deps)).toBe(EXIT_OK);
    expect(ownerOnly.out).toContain('owner docs/PROGRESS.md owner: Q1 pending');
    expect(runCli(['release-check', '--tag'], ownerOnly.deps)).toBe(EXIT_FAILED);
  });

  it('answers not built for release:check while docs-release has not filled it', () => {
    const stubbed = record({ findings: [], built: false });
    expect(runCli(['release-check'], stubbed.deps)).toBe(EXIT_NOT_BUILT);

    // docs-release built the real check (Workflow 11E): over an empty tree it runs and fails.
    const real = record();
    expect(runCli(['release-check'], real.deps)).toBe(EXIT_FAILED);
    expect(real.err).toContain(
      'error docs/release/checklist.md checklist-missing: docs/release/checklist.md does not exist (C284.1)',
    );
  });

  it('writes a stub for each missing docs-tree path, never over an existing file', () => {
    const run = record();
    const present = {
      ...run.deps,
      repo: createMemoryRepository({ 'docs/security/README.md': 'written' }),
    };

    expect(runCli(['stubs'], present)).toBe(EXIT_OK);
    expect(run.written.has('docs/security/README.md')).toBe(false);
    expect(run.written.get('docs/security/logging.md')).toContain(
      'Draft: written in Workflow 11E by docs-records',
    );
    expect(run.out.at(-1)).toMatch(/^stubs: \d+ written$/);
    expect(runCli(['stubs', 'extra'], run.deps)).toBe(EXIT_USAGE);
  });

  it('writes the route table through the injected collector for routes, and nothing else', () => {
    const { deps, written, out } = record();
    const roots: string[] = [];
    const withRoutes: CliDeps = {
      ...deps,
      routes: (root) => {
        roots.push(root);
        return { path: 'docs/api/route-table.json', content: '{}\n' };
      },
    };
    expect(runCli(['routes'], withRoutes)).toBe(EXIT_OK);
    expect(roots).toEqual([deps.repo.root]);
    expect([...written.entries()]).toEqual([['docs/api/route-table.json', '{}\n']]);
    expect(out).toEqual(['routes: 1 files written']);
    expect(runCli(['routes', 'extra'], withRoutes)).toBe(EXIT_USAGE);
  });

  it('main answers usage without touching the tree', () => {
    const lines: string[] = [];
    expect(main(['--help'], { err: (line) => lines.push(line) })).toBe(EXIT_USAGE);
    expect(lines.join('\n')).toContain('usage: docs-tools');
  });
});
