/**
 * C257.1 (Phase 11, Workflow 11C, images-11c; review F27): the API image runs every operator command
 * from a compiled file, never through tsx. `apps/api/tsconfig.commands.json` compiles each command's
 * entry (`scripts/<name with ':' as '-'>.ts`) to `dist/commands/<the same name>.js`; the entries reach
 * the compiled `src/` through the package's `#src/*` import, whose default target is `dist/`, so the
 * compiled commands share the server's modules and their repository-root paths. `package.json` keeps
 * tsx for development, and this test fails when a script has no compiled counterpart and is not a
 * development tool named here with its reason.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const manifest = JSON.parse(read('package.json')) as {
  scripts: Record<string, string>;
  imports?: Record<string, unknown>;
};

/** Scripts that are not commands: the build, the checks and the development servers. */
const NOT_COMMANDS = [
  'build',
  'lint',
  'typecheck',
  'test',
  'test:integration',
  'dev:worker',
  'dev:server',
  'openapi:write',
];

/** Development tools, never compiled into the image, each with its reason (amendment 17). */
const DEVELOPMENT_TOOLS: Readonly<Record<string, string>> = {
  'graph:benchmark':
    'a benchmark over a synthetic 1,000,000-account graph; imports @openverify/db/testing',
  'analytics:benchmark': 'the analytics benchmark; starts its own Testcontainers Postgres',
  'workflow-docs:write': "the workflow reference's document generator, run in the repository",
  // Workflow 11D (decision 14 before 11D; C268.3): the load seed fills openverify_load with
  // @openverify/watchlist/testing's heavy-headed tables through the migration role, from the host.
  'seed:load':
    "the load seed: imports @openverify/watchlist/testing's heavy-headed tables and fills openverify_load",
  // KP11-71 (Workflow 11F; ASVS v5.0.0-15.2.3, threat row B7-T4): a benchmark that writes a scratch
  // organisation is development tooling, so the production image carries no compiled form of it.
  'face-scan:benchmark':
    'the C42.4 1:N scan benchmark: writes a scratch organisation, run on a throwaway database',
};

/**
 * Scripts with no script line: `workflow-benchmark.ts` imports @openverify/db/testing; Workflow
 * 11D's `lists-benchmark.ts` (the list calibrations, its own Testcontainers Postgres) and
 * `network-benchmark.ts` (the C93.2 lookup row and City Lite's verify, run by load/mmdb/).
 */
const UNLISTED_DEVELOPMENT_SCRIPTS = [
  'scripts/workflow-benchmark.ts',
  'scripts/lists-benchmark.ts',
  'scripts/network-benchmark.ts',
];

const TSX_PREFIX = 'tsx --conditions=@openverify/source --env-file-if-exists=../../.env ';

const fileOf = (command: string): string => command.replaceAll(':', '-');

const operatorCommands = Object.keys(manifest.scripts)
  .filter((name) => !NOT_COMMANDS.includes(name) && DEVELOPMENT_TOOLS[name] === undefined)
  .sort();

describe('the compiled operator commands (C257.1, review F27)', () => {
  it('knows every package script: a command, a development tool or a build or check script', () => {
    for (const name of operatorCommands) {
      expect(manifest.scripts[name], name).toMatch(/^tsx /);
    }
    expect(operatorCommands).toEqual(
      expect.arrayContaining([
        'db:migrate',
        'db:grant-runtime',
        'seed:dev',
        'retention:run',
        'kek:rewrap',
        'blind-index:rebuild',
        'face-index:rebuild',
        'user:reset-mfa',
        'user:allow-password',
        'api-keys:pepper-status',
        'watchlists:sync',
        'watchlists:rekey',
        'pep:sync',
        'trust-anchors:sync',
        'trust:sandbox-utopia',
        'org:create',
        'network:sync',
        'graph:reindex',
        // Workflow 11D (C270.1): the full key-frequency rebuild beside the sync's incremental one.
        'watchlists:rebuild-key-df',
      ]),
    );
    expect(operatorCommands).toHaveLength(19);
  });

  it.each(operatorCommands)(
    'runs %s in development with tsx over the entry it compiles',
    (name) => {
      const source = `scripts/${fileOf(name)}.ts`;
      expect(manifest.scripts[name]).toBe(`${TSX_PREFIX}${source}`);
      expect(existsSync(new URL(`../${source}`, import.meta.url)), source).toBe(true);
    },
  );

  it('compiles exactly the operator commands to dist/commands/, after the server build', () => {
    expect(existsSync(new URL('../tsconfig.commands.json', import.meta.url))).toBe(true);
    const config = JSON.parse(read('tsconfig.commands.json')) as {
      extends?: string;
      compilerOptions?: Record<string, unknown>;
      files?: string[];
      include?: string[];
    };
    expect(config.extends).toBe('./tsconfig.json');
    expect(config.compilerOptions).toMatchObject({
      noEmit: false,
      rootDir: 'scripts',
      outDir: 'dist/commands',
      customConditions: [],
    });
    expect(config.include).toEqual([]);
    expect(config.files).toEqual(operatorCommands.map((name) => `scripts/${fileOf(name)}.ts`));
    for (const tool of [
      ...Object.keys(DEVELOPMENT_TOOLS).map((name) => `scripts/${fileOf(name)}.ts`),
      ...UNLISTED_DEVELOPMENT_SCRIPTS,
    ]) {
      expect(config.files, tool).not.toContain(tool);
    }
    expect(manifest.scripts.build).toBe(
      'tsc -p tsconfig.build.json && tsc -p tsconfig.commands.json',
    );
  });

  it('reaches the compiled src/ through #src/*: its source in development, dist/ in the image', () => {
    expect(manifest.imports).toEqual({
      '#src/*': { '@openverify/source': './src/*.ts', default: './dist/*.js' },
    });
    for (const name of operatorCommands) {
      const text = read(`scripts/${fileOf(name)}.ts`);
      expect(text, name).not.toMatch(/from '\.\.\/src\//);
      expect(text, name).not.toMatch(/import\('\.\.\/src\//);
    }
  });

  it('keeps the load seed, a development tool, out of the compiled server (Workflow 11D review)', () => {
    // seed:load runs with tsx on the host (Stage 1a amendment 16); its modules under src/ would
    // otherwise compile into the API image as unreferenced code (Stage 2 amendments, load-harness 11).
    const build = JSON.parse(read('tsconfig.build.json')) as { exclude: string[] };
    expect(build.exclude).toEqual(
      expect.arrayContaining(['src/seed/load/**', 'src/seed/load-seed.ts']),
    );
  });

  it('leaves dist/commands/ to the commands: no module of src/ compiles there', () => {
    // A file at src/commands/<name>.ts would compile to dist/commands/<name>.js and collide with
    // the compiled command of the same name (org:create, db:grant-runtime and others).
    expect(existsSync(new URL('./commands', import.meta.url))).toBe(false);
  });
});
