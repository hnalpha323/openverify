// @vitest-environment node
/**
 * The release pack tool (C266.1, C266.4, C266.5, C285.1) on synthetic workspaces in temporary
 * directories: the packed manifest, the vendored closure of private workspace packages, the staged
 * module graph with its rewritten specifiers, the refused paths, the tarball reader and the CLI.
 * `pack-real.test.ts` packs the three real packages.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PUBLISHABLE_PACKAGES,
  PackRefusedError,
  SOURCE_CONDITION,
  exportTargets,
  main,
  namesSourceCondition,
  packRelease,
  packageNameOf,
  packedManifest,
  readTarball,
  refusedPaths,
  repositoryRootOf,
  rewriteSpecifiers,
  specifiersOf,
  stageModules,
  undeclaredSpecifiers,
  vendoredClosure,
  withoutSourceCondition,
  withoutSourceMapComment,
  workspacePackages,
  type Manifest,
} from './pack-release.js';

const exportsOf = (base: string): Record<string, unknown> => ({
  '.': {
    [SOURCE_CONDITION]: `./src/${base}.ts`,
    types: `./dist/${base}.d.ts`,
    default: `./dist/${base}.js`,
  },
});

/** A publishable manifest as the workspace keeps it. */
const publishable = (overrides: Record<string, unknown> = {}): Manifest => ({
  name: '@openverify/node',
  version: '0.0.0',
  private: true,
  description: 'A synthetic client',
  license: 'Apache-2.0',
  type: 'module',
  exports: exportsOf('index'),
  sideEffects: false,
  files: ['dist'],
  engines: { node: '>=22.18.0' },
  publishConfig: { access: 'public', provenance: true },
  scripts: { build: 'tsc' },
  devDependencies: { vitest: 'catalog:' },
  dependencies: { zod: '^4.6.7' },
  ...overrides,
});

const problemsOf = (run: () => unknown): readonly string[] => {
  try {
    run();
  } catch (error) {
    if (error instanceof PackRefusedError) {
      return error.problems;
    }
    throw error;
  }
  throw new Error('expected a PackRefusedError');
};

let root: string;

const write = (path: string, content: string): void => {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
};
const writeJson = (path: string, value: unknown): void => {
  write(path, `${JSON.stringify(value, null, 2)}\n`);
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'openverify-pack-test-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('the source condition', () => {
  it('is removed at every depth and nothing else is', () => {
    const exportsField = {
      '.': { [SOURCE_CONDITION]: './src/index.ts', types: './dist/index.d.ts', default: './x.js' },
      './sub': { node: { [SOURCE_CONDITION]: './src/sub.ts', default: './dist/sub.js' } },
      './iife': './dist/iife.js',
    };
    const result = withoutSourceCondition(exportsField);
    expect(result).toEqual({
      '.': { types: './dist/index.d.ts', default: './x.js' },
      './sub': { node: { default: './dist/sub.js' } },
      './iife': './dist/iife.js',
    });
    expect(namesSourceCondition(exportsField)).toBe(true);
    expect(namesSourceCondition(result)).toBe(false);
    expect(namesSourceCondition(['a', { b: 1 }])).toBe(false);
    expect(withoutSourceCondition(['a', 1])).toEqual(['a', 1]);
  });

  it('lists every export target but the source condition', () => {
    expect(
      exportTargets({
        '.': {
          [SOURCE_CONDITION]: './src/index.ts',
          types: './dist/a.d.ts',
          default: './dist/a.js',
        },
        './iife.js': './dist/iife.js',
      }),
    ).toEqual(['./dist/a.d.ts', './dist/a.js', './dist/iife.js']);
    expect(exportTargets('./dist/one.js')).toEqual(['./dist/one.js']);
    expect(exportTargets(undefined)).toEqual([]);
  });
});

describe('packageNameOf', () => {
  it.each([
    ['@openverify/contracts', '@openverify/contracts'],
    ['@openverify/contracts/origin-pattern', '@openverify/contracts'],
    ['react/jsx-runtime', 'react'],
    ['zod', 'zod'],
    ['node:crypto', 'node:crypto'],
  ])('%s is %s', (specifier, name) => {
    expect(packageNameOf(specifier)).toBe(name);
  });
});

describe('packedManifest', () => {
  it('keeps the publish fields, drops private, scripts and dev dependencies, and sets the version', () => {
    const packed = packedManifest(publishable(), { version: '1.2.3', vendored: [] });
    expect(packed).toEqual({
      name: '@openverify/node',
      version: '1.2.3',
      description: 'A synthetic client',
      license: 'Apache-2.0',
      type: 'module',
      exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
      sideEffects: false,
      files: ['dist'],
      engines: { node: '>=22.18.0' },
      dependencies: { zod: '^4.6.7' },
      publishConfig: { access: 'public', provenance: true },
    });
    expect(namesSourceCondition(packed)).toBe(false);
  });

  it('pins a publishable workspace dependency to the release version and keeps peers', () => {
    const packed = packedManifest(
      publishable({
        name: '@openverify/react',
        dependencies: { '@openverify/js': 'workspace:*' },
        peerDependencies: { react: '^19.0.0' },
        unpkg: './dist/x.js',
      }),
      { version: '0.1.0', vendored: [] },
    );
    expect(packed.dependencies).toEqual({ '@openverify/js': '0.1.0' });
    expect(packed.peerDependencies).toEqual({ react: '^19.0.0' });
    expect(packed.unpkg).toBe('./dist/x.js');
  });

  it('replaces a vendored package by its own published dependencies', () => {
    const packed = packedManifest(
      publishable({ dependencies: { '@openverify/contracts': 'workspace:*', zod: '^4.6.7' } }),
      {
        version: '0.1.0',
        vendored: [
          {
            name: '@openverify/contracts',
            folder: 'contracts',
            distDir: '/nowhere',
            manifest: { dependencies: { '@openverify/core': 'workspace:*', zod: '^4.6.7' } },
          },
          {
            name: '@openverify/core',
            folder: 'core',
            distDir: '/nowhere',
            manifest: { dependencies: { 'tiny-extra': '1.0.0' } },
          },
        ],
      },
    );
    expect(packed.dependencies).toEqual({ 'tiny-extra': '1.0.0', zod: '^4.6.7' });
  });

  it('refuses what a release must not carry, naming each problem', () => {
    const problems = problemsOf(() =>
      packedManifest(
        publishable({
          name: '@openverify/api',
          license: 'MIT',
          sideEffects: true,
          publishConfig: { access: 'public' },
          exports: { '.': { default: './dist/index.js' }, './other': './lib/other.js' },
          dependencies: {
            '@openverify/db': 'workspace:*',
            '@openverify/contracts': 'workspace:*',
            zod: 'catalog:',
          },
        }),
        {
          version: 'next',
          vendored: [
            {
              name: '@openverify/contracts',
              folder: 'contracts',
              distDir: '/nowhere',
              manifest: { dependencies: { zod: '^3.0.0' } },
            },
          ],
        },
      ),
    );
    expect(problems).toEqual([
      '@openverify/api is not one of the publishable packages (@openverify/js, @openverify/node, @openverify/react)',
      'version "next" is not a release version (x.y.z)',
      'license must be "Apache-2.0" (the repository licence), not "MIT"',
      'sideEffects must be false',
      'publishConfig.provenance must be true',
      'export "." has no types',
      'export "./other" points outside dist/ (./lib/other.js)',
      'dependency @openverify/db is a private workspace package that is not vendored',
      'dependency zod uses "catalog:", which a packed manifest cannot carry',
      'dependency zod is wanted as "catalog:" and as "^3.0.0"',
    ]);
  });

  it('needs exports at all', () => {
    expect(
      problemsOf(() =>
        packedManifest(publishable({ exports: undefined }), { version: '1.0.0', vendored: [] }),
      ),
    ).toEqual(['exports is missing']);
  });
});

describe('specifiers', () => {
  const code = [
    "/** Example: import { x } from 'not-a-real-import'; */",
    "import { a } from './a.js';",
    "export * from '@openverify/contracts';",
    'export { b } from "./b";',
    "import 'side-effect';",
    "const c = await import('./c.js');",
    "type D = import('@openverify/core').D;",
    '//# sourceMappingURL=index.js.map',
    '',
  ].join('\n');

  it('finds every import, export and dynamic import, never one inside a comment', () => {
    expect(specifiersOf(code)).toEqual([
      './a.js',
      '@openverify/contracts',
      './b',
      'side-effect',
      './c.js',
      '@openverify/core',
    ]);
  });

  it('rewrites the specifiers it is asked to, keeping the quotes and the rest', () => {
    const rewritten = rewriteSpecifiers(code, (specifier) =>
      specifier.startsWith('@openverify/') ? `./vendor/${specifier.slice(12)}/index.js` : undefined,
    );
    expect(rewritten).toContain("export * from './vendor/contracts/index.js';");
    expect(rewritten).toContain("type D = import('./vendor/core/index.js').D;");
    expect(rewritten).toContain('export { b } from "./b";');
    expect(rewritten).toContain("from 'not-a-real-import'");
  });

  it('drops the source map comment and nothing else', () => {
    expect(withoutSourceMapComment('a;\n//# sourceMappingURL=a.js.map\n')).toBe('a;\n');
    expect(withoutSourceMapComment('a;\n//# sourceMappingURL=a.js.map')).toBe('a;\n');
    expect(withoutSourceMapComment('const url = "x";\n')).toBe('const url = "x";\n');
  });
});

describe('refusedPaths', () => {
  it('allows only the manifest, the README, the licence and built modules under dist/', () => {
    expect(
      refusedPaths([
        'package/package.json',
        'package/README.md',
        'package/LICENSE',
        'package/dist/index.js',
        'package/dist/index.d.ts',
        'package/dist/vendor/contracts/index.js',
        'package/dist/index.js.map',
        'package/dist/index.d.ts.map',
        'package/dist/a.test.js',
        'package/dist/test-support.js',
        'package/dist/.env',
        'package/.env.production',
        'package/src/index.ts',
        'package/dist/index.ts',
        'package/tsconfig.tsbuildinfo',
      ]),
    ).toEqual([
      'package/dist/index.js.map',
      'package/dist/index.d.ts.map',
      'package/dist/a.test.js',
      'package/dist/test-support.js',
      'package/dist/.env',
      'package/.env.production',
      'package/src/index.ts',
      'package/dist/index.ts',
      'package/tsconfig.tsbuildinfo',
    ]);
  });
});

/** One pax extended-header record: its length counts its own digits. */
function paxRecord(key: string, value: string): string {
  const body = ` ${key}=${value}\n`;
  let length = body.length + 1;
  while (String(length).length + body.length !== length) {
    length = String(length).length + body.length;
  }
  return `${String(length)}${body}`;
}

/** A ustar archive of the given files, gzipped, as npm and pnpm write one. */
function tarOf(files: Readonly<Record<string, string>>, longName?: string): Buffer {
  const blocks: Buffer[] = [];
  const entry = (name: string, body: Buffer, type: string, prefix = ''): void => {
    const header = Buffer.alloc(512);
    header.write(name, 0, 100);
    header.write('0000644\0', 100);
    header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124);
    header.write(type, 156);
    header.write('ustar\0', 257);
    header.write(prefix, 345, 155);
    blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  };
  entry('package/', Buffer.alloc(0), '5');
  for (const [name, content] of Object.entries(files)) {
    entry(name, Buffer.from(content), '0');
  }
  if (longName !== undefined) {
    entry('PaxHeader', Buffer.from(paxRecord('path', longName)), 'x');
    entry('short-name', Buffer.from('long'), '0');
    entry('d', Buffer.from('prefixed'), '0', 'package/dist/deep');
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

describe('readTarball', () => {
  it('lists the regular files with their sizes and contents', () => {
    const entries = readTarball(
      tarOf({ 'package/package.json': '{}', 'package/dist/a.js': 'x'.repeat(700) }),
    );
    expect(entries.map(({ path, bytes }) => ({ path, bytes }))).toEqual([
      { path: 'package/package.json', bytes: 2 },
      { path: 'package/dist/a.js', bytes: 700 },
    ]);
    expect(entries[1]?.content.toString()).toBe('x'.repeat(700));
  });

  it('reads a pax path and a ustar prefix', () => {
    const longName = `package/dist/${'n'.repeat(120)}.js`;
    const paths = readTarball(tarOf({}, longName)).map(({ path }) => path);
    expect(paths).toEqual([longName, 'package/dist/deep/d']);
  });

  it('refuses a truncated archive', () => {
    const whole = tarOf({ 'package/a.js': 'x'.repeat(2000) });
    const truncated = gzipSync(gunzipSync(whole).subarray(0, 900));
    expect(() => readTarball(truncated)).toThrow(/truncated/);
  });
});

/** A synthetic workspace: a publishable package over two private ones and one published one. */
function syntheticWorkspace(): { readonly nodeDir: string } {
  write(
    'pnpm-workspace.yaml',
    'packages:\n  - apps/*\n  - packages/*\n\ncatalog:\n  zod: ^4.6.7\n',
  );
  writeJson('apps/site/package.json', { name: '@openverify/site', private: true });
  write('packages/no-manifest/.keep', '');
  writeJson(
    'packages/node/package.json',
    publishable({
      dependencies: {
        '@openverify/contracts': 'workspace:*',
        '@openverify/js': 'workspace:*',
        zod: '^4.6.7',
      },
    }),
  );
  write(
    'packages/node/README.md',
    '# @openverify/node\n\nA client; the server decides every step.\n',
  );
  write(
    'packages/node/dist/index.js',
    "/** import { x } from '@openverify/node'; */\nexport * from './client';\nexport { embed } from '@openverify/js';\n//# sourceMappingURL=index.js.map\n",
  );
  write('packages/node/dist/index.js.map', '{"sources":["/home/someone/src/index.ts"]}');
  write(
    'packages/node/dist/index.d.ts',
    "export * from './client.js';\n//# sourceMappingURL=index.d.ts.map\n",
  );
  write(
    'packages/node/dist/client.js',
    "import { schema } from '@openverify/contracts';\nimport { pattern } from '@openverify/contracts/origin-pattern';\nimport { z } from 'zod';\nimport { createHash } from 'node:crypto';\nexport const client = [schema, pattern, z, createHash];\n",
  );
  write(
    'packages/node/dist/client.d.ts',
    "import type { Schema } from '@openverify/contracts';\nexport declare const client: Schema[];\n",
  );
  write('packages/node/dist/unreached.test.js', 'never shipped');
  writeJson('packages/contracts/package.json', {
    name: '@openverify/contracts',
    version: '0.0.0',
    private: true,
    exports: {
      '.': {
        [SOURCE_CONDITION]: './src/index.ts',
        types: './dist/index.d.ts',
        default: './dist/index.js',
      },
      './origin-pattern': {
        [SOURCE_CONDITION]: './src/origin-pattern.ts',
        types: './dist/origin-pattern.d.ts',
        default: './dist/origin-pattern.js',
      },
    },
    dependencies: { '@openverify/core': 'workspace:*', zod: '^4.6.7' },
  });
  write(
    'packages/contracts/dist/index.js',
    "import { core } from '@openverify/core';\nexport { nested } from './nested';\nexport const schema = core;\n",
  );
  write(
    'packages/contracts/dist/index.d.ts',
    "export type Schema = import('@openverify/core').Core;\n",
  );
  write('packages/contracts/dist/nested/index.js', 'export const nested = 1;\n');
  write('packages/contracts/dist/origin-pattern.js', 'export const pattern = /x/;\n');
  write('packages/contracts/dist/origin-pattern.d.ts', 'export declare const pattern: RegExp;\n');
  write('packages/contracts/dist/test-fixtures.js', 'never reached');
  writeJson('packages/core/package.json', {
    name: '@openverify/core',
    version: '0.0.0',
    private: true,
    exports: exportsOf('index'),
    dependencies: { zod: '^4.6.7' },
  });
  write('packages/core/dist/index.js', "export const core = 'core';\n");
  write('packages/core/dist/index.d.ts', 'export type Core = string;\n');
  writeJson('packages/js/package.json', {
    name: '@openverify/js',
    version: '0.0.0',
    private: true,
  });
  return { nodeDir: join(root, 'packages/node') };
}

describe('the workspace', () => {
  it('finds the repository root above a package and refuses a directory outside one', () => {
    const { nodeDir } = syntheticWorkspace();
    expect(repositoryRootOf(join(nodeDir, 'dist'))).toBe(root);
    expect(() => repositoryRootOf(tmpdir())).toThrow(/pnpm-workspace\.yaml/);
  });

  it('maps every workspace package name to its directory', () => {
    syntheticWorkspace();
    expect([...workspacePackages(root).entries()].sort()).toEqual([
      ['@openverify/contracts', join(root, 'packages/contracts')],
      ['@openverify/core', join(root, 'packages/core')],
      ['@openverify/js', join(root, 'packages/js')],
      ['@openverify/node', join(root, 'packages/node')],
      ['@openverify/site', join(root, 'apps/site')],
    ]);
  });

  it('vendors the private closure and never a publishable package', () => {
    const { nodeDir } = syntheticWorkspace();
    const manifest = JSON.parse(readFileSync(join(nodeDir, 'package.json'), 'utf8')) as Manifest;
    const closure = vendoredClosure(manifest, workspacePackages(root), (name, dir) => {
      expect(name.startsWith('@openverify/')).toBe(true);
      return join(dir, 'dist');
    });
    expect(closure.map(({ name, folder, distDir }) => ({ name, folder, distDir }))).toEqual([
      {
        name: '@openverify/contracts',
        folder: 'contracts',
        distDir: join(root, 'packages/contracts/dist'),
      },
      { name: '@openverify/core', folder: 'core', distDir: join(root, 'packages/core/dist') },
    ]);
  });
});

describe('stageModules and undeclaredSpecifiers', () => {
  it('copies only the reachable modules, rewrites vendored and extensionless specifiers, and drops maps', () => {
    const { nodeDir } = syntheticWorkspace();
    const manifest = JSON.parse(readFileSync(join(nodeDir, 'package.json'), 'utf8')) as Manifest;
    const vendored = vendoredClosure(manifest, workspacePackages(root), (_name, dir) =>
      join(dir, 'dist'),
    );
    const stagingDist = join(root, 'staging/dist');
    const staged = stageModules({
      manifest,
      distDir: join(nodeDir, 'dist'),
      vendored,
      stagingDist,
    });
    expect(staged).toEqual([
      'client.d.ts',
      'client.js',
      'index.d.ts',
      'index.js',
      'vendor/contracts/index.d.ts',
      'vendor/contracts/index.js',
      'vendor/contracts/nested/index.js',
      'vendor/contracts/origin-pattern.js',
      'vendor/core/index.d.ts',
      'vendor/core/index.js',
    ]);
    const read = (path: string): string => readFileSync(join(stagingDist, path), 'utf8');
    expect(read('index.js')).toContain("export * from './client.js';");
    expect(read('index.js')).not.toContain('sourceMappingURL');
    expect(read('client.js')).toContain("from './vendor/contracts/index.js'");
    expect(read('client.js')).toContain("from './vendor/contracts/origin-pattern.js'");
    expect(read('client.d.ts')).toContain("from './vendor/contracts/index.js'");
    expect(read('vendor/contracts/index.js')).toContain("from '../core/index.js'");
    expect(read('vendor/contracts/index.js')).toContain("from './nested/index.js'");
    expect(read('vendor/contracts/index.d.ts')).toContain("import('../core/index.js')");
    expect(existsSync(join(stagingDist, 'unreached.test.js'))).toBe(false);

    const packed = packedManifest(manifest, { version: '1.0.0', vendored });
    expect(undeclaredSpecifiers(stagingDist, packed)).toEqual([]);
    expect(undeclaredSpecifiers(stagingDist, { ...packed, dependencies: {} })).toEqual([
      'client.js: zod',
      'index.js: @openverify/js',
    ]);
  });

  it('refuses a module an export names that the build did not write, and an unresolvable import', () => {
    const { nodeDir } = syntheticWorkspace();
    const manifest = JSON.parse(readFileSync(join(nodeDir, 'package.json'), 'utf8')) as Manifest;
    rmSync(join(nodeDir, 'dist/client.js'));
    write('packages/node/dist/index.d.ts', "export * from './missing';\n");
    const problems = problemsOf(() =>
      stageModules({
        manifest,
        distDir: join(nodeDir, 'dist'),
        vendored: [],
        stagingDist: join(root, 's'),
      }),
    );
    expect(problems).toEqual([
      'dist/index.d.ts imports ./missing, which the build did not write',
      'dist/index.js imports ./client, which the build did not write',
    ]);
    expect(
      problemsOf(() =>
        stageModules({
          manifest: {
            ...manifest,
            exports: { '.': { types: './dist/none.d.ts', default: './dist/none.js' } },
          },
          distDir: join(nodeDir, 'dist'),
          vendored: [],
          stagingDist: join(root, 't'),
        }),
      ),
    ).toEqual([
      'export target ./dist/none.d.ts was not built',
      'export target ./dist/none.js was not built',
    ]);
  });

  it('refuses a vendored subpath its package does not export', () => {
    const { nodeDir } = syntheticWorkspace();
    const manifest = JSON.parse(readFileSync(join(nodeDir, 'package.json'), 'utf8')) as Manifest;
    write(
      'packages/node/dist/client.js',
      "import { x } from '@openverify/contracts/private';\nexport const client = x;\n",
    );
    const vendored = vendoredClosure(manifest, workspacePackages(root), (_name, dir) =>
      join(dir, 'dist'),
    );
    expect(
      problemsOf(() =>
        stageModules({
          manifest,
          distDir: join(nodeDir, 'dist'),
          vendored,
          stagingDist: join(root, 's'),
        }),
      ),
    ).toEqual([
      'dist/client.js imports @openverify/contracts/private, which @openverify/contracts does not export',
    ]);
  });
});

describe('packRelease and the CLI', () => {
  it('packs the staged package with pnpm and lists what the tarball holds', () => {
    const { nodeDir } = syntheticWorkspace();
    write('LICENSE', 'Apache License\nVersion 2.0, synthetic copy\n');
    const outDir = join(root, 'out');
    const result = packRelease({ packageDir: nodeDir, outDir, version: '0.1.0' });
    expect(result.name).toBe('@openverify/node');
    expect(result.version).toBe('0.1.0');
    expect(result.tarball).toBe(join(outDir, 'openverify-node-0.1.0.tgz'));
    expect(result.files.map(({ path }) => path)).toEqual([
      'package/LICENSE',
      'package/README.md',
      'package/dist/client.d.ts',
      'package/dist/client.js',
      'package/dist/index.d.ts',
      'package/dist/index.js',
      'package/dist/vendor/contracts/index.d.ts',
      'package/dist/vendor/contracts/index.js',
      'package/dist/vendor/contracts/nested/index.js',
      'package/dist/vendor/contracts/origin-pattern.js',
      'package/dist/vendor/core/index.d.ts',
      'package/dist/vendor/core/index.js',
      'package/package.json',
    ]);
    expect(result.bytes).toBe(readFileSync(result.tarball).length);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.unpackedBytes).toBe(result.files.reduce((sum, { bytes }) => sum + bytes, 0));
    expect(result.manifest.private).toBeUndefined();
    expect(result.manifest.dependencies).toEqual({ '@openverify/js': '0.1.0', zod: '^4.6.7' });
    expect(namesSourceCondition(result.manifest)).toBe(false);
  });

  it('refuses a package with no README and a package that is not publishable', () => {
    const { nodeDir } = syntheticWorkspace();
    rmSync(join(nodeDir, 'README.md'));
    expect(
      problemsOf(() => packRelease({ packageDir: nodeDir, outDir: join(root, 'out') })),
    ).toEqual([
      'README.md is missing',
      'LICENSE is missing (neither the package nor the repository root has one)',
    ]);
    expect(
      problemsOf(() =>
        packRelease({ packageDir: join(root, 'packages/core'), outDir: join(root, 'out') }),
      ),
    ).toContain(
      '@openverify/core is not one of the publishable packages (@openverify/js, @openverify/node, @openverify/react)',
    );
  });

  it('refuses a tarball pnpm wrote with a file a release must not hold', () => {
    const { nodeDir } = syntheticWorkspace();
    write('LICENSE', 'synthetic');
    const fakePnpm = join(root, 'fake-pnpm.mjs');
    write(
      'fake-pnpm.mjs',
      `#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs';\nimport { join } from 'node:path';\n` +
        `const out = process.argv[process.argv.indexOf('--pack-destination') + 1];\n` +
        `writeFileSync(join(out, 'openverify-node-0.0.0.tgz'), Buffer.from(${JSON.stringify(
          tarOf({ 'package/package.json': '{}', 'package/.env': 'X=change-me' }).toString('base64'),
        )}, 'base64'));\n`,
    );
    chmodSync(fakePnpm, 0o755);
    expect(
      problemsOf(() =>
        packRelease({ packageDir: nodeDir, outDir: join(root, 'out'), pnpm: fakePnpm }),
      ),
    ).toEqual(['the tarball holds package/.env, which a release must not']);
  });

  it('prints each tarball with its digest and file list, and answers 1 or 2 when it cannot', () => {
    const { nodeDir } = syntheticWorkspace();
    write('LICENSE', 'synthetic');
    const lines: string[] = [];
    const errors: string[] = [];
    expect(
      main(
        ['--out', join(root, 'out'), '--version', '2.0.0', nodeDir],
        (l) => lines.push(l),
        (l) => errors.push(l),
      ),
    ).toBe(0);
    expect(lines[0]).toMatch(
      /^@openverify\/node@2\.0\.0 .*openverify-node-2\.0\.0\.tgz \d+ bytes sha256 [0-9a-f]{64}$/,
    );
    expect(lines).toContain('  package/dist/vendor/core/index.js');
    expect(errors).toEqual([]);

    expect(
      main(
        ['--out', join(root, 'out'), join(root, 'packages/core')],
        () => undefined,
        (l) => errors.push(l),
      ),
    ).toBe(1);
    expect(errors.join('\n')).toContain('@openverify/core cannot be packed');
    expect(
      main(
        [nodeDir],
        () => undefined,
        (l) => errors.push(l),
      ),
    ).toBe(2);
    expect(
      main(
        ['--out'],
        () => undefined,
        (l) => errors.push(l),
      ),
    ).toBe(2);
    expect(
      main(
        ['--out', 'x', '--bogus', nodeDir],
        () => undefined,
        (l) => errors.push(l),
      ),
    ).toBe(2);
    expect(errors.at(-1)).toMatch(/^usage: /);
  });

  it('names the three publishable packages', () => {
    expect(PUBLISHABLE_PACKAGES).toEqual([
      '@openverify/js',
      '@openverify/node',
      '@openverify/react',
    ]);
  });
});
