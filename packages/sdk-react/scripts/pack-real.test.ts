// @vitest-environment node
/**
 * C266.1, C266.4, C266.5 and the area's item 6: each publishable package is built fresh into a
 * temporary directory (never the shared `dist/`), packed by the release tool with pnpm, and its
 * tarball holds only the built modules under `dist/`, the README, the licence and `package.json`:
 * no source, test, source map, `.env` or absolute path, and a manifest with no workspace-only
 * source condition and no `private` flag. The Node client's tarball also runs: its vendored
 * private packages resolve, with only its declared dependency installed beside it.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SOURCE_CONDITION,
  namesSourceCondition,
  packRelease,
  readTarball,
  refusedPaths,
  type PackResult,
} from './pack-release.js';
import { buildWithVite, emitTypeScript } from './test-build.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
const dirOf = (folder: string): string => join(repoRoot, 'packages', folder);
const VERSION = '0.1.0';
/**
 * Each hook below builds a package for real (TypeScript's emit in a child process, or Vite), which is
 * the point of this file. Alone the whole file takes about 27 s and the contracts' emit about 14 s, but
 * in the all-packages run (`pnpm turbo run test`, every suite at once, load about 20 on 12 cores) the
 * contracts' hook passed the shared 60 s guard (validate-full of 4758c01d5, 2026-11-16; the file took
 * 214 s). So a build hook gets its own bound, like the API's heavy hooks (120-180 s); a hang still fails.
 */
const BUILD_HOOK_TIMEOUT_MS = 240_000;

let work: string;
const dists = new Map<string, string>();
const distOf = (name: string, packageDir: string): string =>
  dists.get(name) ?? join(packageDir, 'dist-not-built-by-this-test');

/** Builds one workspace package into the test's directory and records where. */
function emitInto(name: string, folder: string): void {
  const out = join(work, 'dist', folder);
  emitTypeScript(dirOf(folder), out);
  dists.set(name, out);
}

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'openverify-pack-real-'));
});
afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

/** What every packed tarball must and must not hold. */
function expectReleaseShape(result: PackResult): void {
  const entries = readTarball(readFileSync(result.tarball));
  const paths = entries.map(({ path }) => path);
  expect(refusedPaths(paths)).toEqual([]);
  expect(paths).toEqual(
    expect.arrayContaining(['package/package.json', 'package/README.md', 'package/LICENSE']),
  );
  expect(
    paths.filter(
      (path) => !/^package\/(package\.json|README\.md|LICENSE|dist\/.+\.(js|d\.ts))$/.test(path),
    ),
  ).toEqual([]);
  for (const entry of entries) {
    const text = entry.content.toString('utf8');
    expect(text.includes(repoRoot), `${entry.path} holds an absolute path`).toBe(false);
    expect(text.includes('sourceMappingURL'), `${entry.path} names a source map`).toBe(false);
  }
  const manifest = JSON.parse(
    entries.find(({ path }) => path === 'package/package.json')?.content.toString('utf8') ?? '{}',
  ) as Record<string, unknown>;
  expect(manifest).toEqual(result.manifest);
  expect(manifest.private).toBeUndefined();
  expect(manifest.scripts).toBeUndefined();
  expect(manifest.devDependencies).toBeUndefined();
  expect(namesSourceCondition(manifest)).toBe(false);
  expect(JSON.stringify(manifest)).not.toContain(SOURCE_CONDITION);
  expect(JSON.stringify(manifest)).not.toContain('workspace:');
  expect(manifest).toMatchObject({
    version: VERSION,
    license: 'Apache-2.0',
    sideEffects: false,
    files: ['dist'],
    publishConfig: { access: 'public', provenance: true },
  });
  const readme =
    entries.find(({ path }) => path === 'package/README.md')?.content.toString('utf8') ?? '';
  expect(readme).toMatch(/the server decides/i);
  expect(readme).not.toMatch(/persona|certified|compliant/i);
}

describe('@openverify/js', () => {
  let result: PackResult;
  beforeAll(async () => {
    const out = join(work, 'dist', 'sdk-js');
    await buildWithVite(dirOf('sdk-js'), out);
    emitTypeScript(dirOf('sdk-js'), out);
    dists.set('@openverify/js', out);
    result = packRelease({
      packageDir: dirOf('sdk-js'),
      outDir: join(work, 'out'),
      version: VERSION,
      distOf,
    });
  }, BUILD_HOOK_TIMEOUT_MS);

  it('packs the ES module, the script-tag IIFE and the types, and nothing else', () => {
    expectReleaseShape(result);
    expect(result.files.map(({ path }) => path)).toEqual([
      'package/LICENSE',
      'package/README.md',
      'package/dist/embed.d.ts',
      'package/dist/frame-url.d.ts',
      'package/dist/index.d.ts',
      'package/dist/index.js',
      'package/dist/messages.d.ts',
      'package/dist/openverify.iife.js',
      'package/package.json',
    ]);
    expect(result.manifest.dependencies).toBeUndefined();
    const entries = readTarball(readFileSync(result.tarball));
    const types = entries
      .find(({ path }) => path === 'package/dist/index.d.ts')
      ?.content.toString();
    expect(types).toContain("from './messages.js'");
    const iife = entries
      .find(({ path }) => path === 'package/dist/openverify.iife.js')
      ?.content.toString();
    expect(iife).toMatch(/var OpenVerify\s*=/);
  });
});

describe('@openverify/react', () => {
  let result: PackResult;
  beforeAll(() => {
    emitInto('@openverify/react', 'sdk-react');
    result = packRelease({
      packageDir: dirOf('sdk-react'),
      outDir: join(work, 'out'),
      version: VERSION,
      distOf,
    });
  }, BUILD_HOOK_TIMEOUT_MS);

  it('packs the bindings with @openverify/js pinned to the release and React as a peer', () => {
    expectReleaseShape(result);
    expect(result.files.map(({ path }) => path)).toEqual([
      'package/LICENSE',
      'package/README.md',
      'package/dist/index.d.ts',
      'package/dist/index.js',
      'package/dist/open-verify-flow.d.ts',
      'package/dist/open-verify-flow.js',
      'package/dist/use-open-verify.d.ts',
      'package/dist/use-open-verify.js',
      'package/package.json',
    ]);
    expect(result.manifest.dependencies).toEqual({ '@openverify/js': VERSION });
    expect(result.manifest.peerDependencies).toEqual({ react: '^19.0.0' });
  });
});

describe('@openverify/node', () => {
  // One hook per build, each with its own bound (the contracts' declarations take the longest,
  // about 14 s alone).
  beforeAll(() => {
    emitInto('@openverify/core', 'core');
  }, BUILD_HOOK_TIMEOUT_MS);
  beforeAll(() => {
    emitInto('@openverify/flow-spec', 'flow-spec');
  }, BUILD_HOOK_TIMEOUT_MS);
  beforeAll(() => {
    emitInto('@openverify/contracts', 'contracts');
  }, BUILD_HOOK_TIMEOUT_MS);
  let result: PackResult;
  beforeAll(() => {
    emitInto('@openverify/node', 'node');
    result = packRelease({
      packageDir: dirOf('node'),
      outDir: join(work, 'out'),
      version: VERSION,
      distOf,
    });
  }, BUILD_HOOK_TIMEOUT_MS);

  it('vendors the private contracts it runs on and depends only on published packages', () => {
    expectReleaseShape(result);
    const paths = result.files.map(({ path }) => path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'package/dist/index.js',
        'package/dist/index.d.ts',
        'package/dist/vendor/contracts/index.js',
        'package/dist/vendor/core/index.js',
      ]),
    );
    expect(paths.filter((path) => /test-(fixtures|support)|golden|\.test\./.test(path))).toEqual(
      [],
    );
    expect(result.manifest.dependencies).toEqual({
      zod: expect.stringMatching(/^\^4\./) as unknown,
    });
  });

  it('runs from its unpacked tarball with only zod installed beside it', async () => {
    const modules = join(work, 'consumer', 'node_modules');
    const target = join(modules, '@openverify', 'node');
    for (const entry of readTarball(readFileSync(result.tarball))) {
      const file = join(target, entry.path.slice('package/'.length));
      mkdirSync(dirname(file), { recursive: true });
      await import('node:fs/promises').then(({ writeFile }) => writeFile(file, entry.content));
    }
    symlinkSync(realpathSync(join(dirOf('node'), 'node_modules', 'zod')), join(modules, 'zod'));
    const client = (await import(pathToFileURL(join(target, 'dist', 'index.js')).href)) as Record<
      string,
      unknown
    >;
    expect(client.PACKAGE_NAME).toBe('@openverify/node');
    expect(typeof client.verifyWebhookSignature).toBe('function');
    expect(typeof client.createClient).toBe('function');
  });
});
