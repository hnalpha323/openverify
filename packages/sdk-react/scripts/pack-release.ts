/**
 * The web SDK packages' pack step (plan C266.1, C266.4, C266.5, C285.1): packs `@openverify/js`,
 * `@openverify/node` and `@openverify/react` from their built `dist/` with `pnpm pack`, never
 * publishing anything (publication is the owner's, Q4).
 *
 *   node packages/sdk-react/scripts/pack-release.ts --out <dir> [--version <x.y.z>] <package dir>...
 *
 * Run it after `pnpm turbo run build --filter=@openverify/js --filter=@openverify/node
 * --filter=@openverify/react` (which builds every workspace package they need).
 *
 * - The workspace manifests stay `private: true` with the workspace-only source condition; the
 *   packed manifest is written here: the release version, exports without the source condition,
 *   no `private`, scripts or dev dependencies, `files: ["dist"]`, `@openverify/js` pinned to the
 *   release, and `publishConfig.provenance`.
 * - A private workspace package a publishable one runs on (`@openverify/node` on
 *   `@openverify/contracts`, which runs on `@openverify/core` and `@openverify/flow-spec`) is
 *   vendored: only the built modules the package's exports reach are copied, under
 *   `dist/vendor/<folder>/`, with their specifiers rewritten; their published dependencies become
 *   the packed package's own.
 * - Source maps are left out (they point at sources the tarball does not hold), and the tarball is
 *   read back: anything but `package.json`, `README.md`, `LICENSE` and `dist/**\/*.{js,d.ts}` is
 *   refused.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire, isBuiltin } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import type * as TypeScript from 'typescript';

/** The packages the release packs; every other workspace package is private. */
export const PUBLISHABLE_PACKAGES: readonly string[] = [
  '@openverify/js',
  '@openverify/node',
  '@openverify/react',
];

/** The workspace-only export condition, which points at sources (`@openverify/config`). */
export const SOURCE_CONDITION = '@openverify/source';

export type Manifest = Readonly<Record<string, unknown>>;

export class PackRefusedError extends Error {
  readonly problems: readonly string[];

  constructor(name: string, problems: readonly string[]) {
    super(`${name} cannot be packed:\n- ${problems.join('\n- ')}`);
    this.name = 'PackRefusedError';
    this.problems = problems;
  }
}

/** A private workspace package copied into the packed one. */
export interface VendoredPackage {
  readonly name: string;
  readonly folder: string;
  readonly manifest: Manifest;
  readonly distDir: string;
}

export interface ManifestPlan {
  readonly version: string;
  readonly vendored: readonly VendoredPackage[];
}

export interface StageInput {
  readonly manifest: Manifest;
  readonly distDir: string;
  readonly vendored: readonly VendoredPackage[];
  readonly stagingDist: string;
}

export interface TarEntry {
  readonly path: string;
  readonly bytes: number;
  readonly content: Buffer;
}

export interface PackOptions {
  readonly packageDir: string;
  readonly outDir: string;
  readonly version?: string;
  readonly distOf?: (name: string, packageDir: string) => string;
  readonly pnpm?: string;
}

export interface PackResult {
  readonly name: string;
  readonly version: string;
  readonly tarball: string;
  readonly bytes: number;
  readonly unpackedBytes: number;
  readonly sha256: string;
  readonly files: readonly { readonly path: string; readonly bytes: number }[];
  readonly manifest: Manifest;
}

const ts = createRequire(import.meta.url)('typescript') as typeof TypeScript;

const RELEASE_VERSION = /^\d+\.\d+\.\d+$/;
const PRE_RELEASE_VERSION = /^\d+\.\d+\.\d+-[0-9A-Za-z.-]+$/;
const KEPT_FIELDS = ['unpkg', 'jsdelivr', 'keywords', 'homepage', 'repository', 'bugs', 'engines'];
const ALLOWED_TOP_LEVEL = /^package\/(?:package\.json|README\.md|LICENSE)$/;
const MODULE_SUFFIX = /\.(?:js|d\.ts)$/;
const TEST_LIKE = /(?:^|[./-])(?:test|spec)[.-]|test-(?:support|fixtures)|(?:^|\/)\.env/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const recordOf = (value: unknown): Readonly<Record<string, unknown>> =>
  isRecord(value) ? value : {};

const readJson = (path: string): Manifest => JSON.parse(readFileSync(path, 'utf8')) as Manifest;

export function withoutSourceCondition(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(withoutSourceCondition);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== SOURCE_CONDITION)
        .map(([key, member]) => [key, withoutSourceCondition(member)]),
    );
  }
  return value;
}

export function namesSourceCondition(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(namesSourceCondition);
  }
  if (isRecord(value)) {
    return Object.entries(value).some(
      ([key, member]) => key === SOURCE_CONDITION || namesSourceCondition(member),
    );
  }
  return false;
}

export function packageNameOf(specifier: string): string {
  if (specifier.startsWith('node:')) {
    return specifier;
  }
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier);
}

/** Every string target of an export map, the source condition's left out, first seen first. */
export function exportTargets(exportsField: unknown): string[] {
  const targets: string[] = [];
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      if (!targets.includes(value)) {
        targets.push(value);
      }
    } else if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (isRecord(value)) {
      for (const [key, member] of Object.entries(value)) {
        if (key !== SOURCE_CONDITION) {
          visit(member);
        }
      }
    }
  };
  visit(exportsField);
  return targets;
}

/** The export map as subpath -> entry (a bare string or conditions map is the "." entry). */
function subpathsOf(exportsField: unknown): [string, unknown][] {
  if (isRecord(exportsField) && Object.keys(exportsField).every((key) => key.startsWith('.'))) {
    return Object.entries(exportsField);
  }
  return [['.', exportsField]];
}

export function packedManifest(source: Manifest, plan: ManifestPlan): Manifest {
  const problems: string[] = [];
  const name = String(source.name);
  if (!PUBLISHABLE_PACKAGES.includes(name)) {
    problems.push(
      `${name} is not one of the publishable packages (${PUBLISHABLE_PACKAGES.join(', ')})`,
    );
  }
  if (!RELEASE_VERSION.test(plan.version) && !PRE_RELEASE_VERSION.test(plan.version)) {
    problems.push(`version "${plan.version}" is not a release version (x.y.z)`);
  }
  if (source.license !== 'Apache-2.0') {
    problems.push(
      `license must be "Apache-2.0" (the repository licence), not "${String(source.license)}"`,
    );
  }
  if (source.sideEffects !== false) {
    problems.push('sideEffects must be false');
  }
  if (recordOf(source.publishConfig).provenance !== true) {
    problems.push('publishConfig.provenance must be true');
  }
  if (source.exports === undefined) {
    problems.push('exports is missing');
  } else {
    for (const [subpath, entry] of subpathsOf(source.exports)) {
      if (isRecord(entry) && !exportTargets(entry).some((target) => target.endsWith('.d.ts'))) {
        problems.push(`export "${subpath}" has no types`);
      }
      for (const target of exportTargets(entry)) {
        if (!target.startsWith('./dist/')) {
          problems.push(`export "${subpath}" points outside dist/ (${target})`);
        }
      }
    }
  }

  const vendoredNames = new Set(plan.vendored.map(({ name: vendored }) => vendored));
  const wanted = new Map<string, string[]>();
  const want = (dependency: string, range: string): void => {
    const ranges = wanted.get(dependency) ?? [];
    if (!ranges.includes(range)) {
      ranges.push(range);
    }
    wanted.set(dependency, ranges);
  };
  const dependenciesOf = (manifest: Manifest): void => {
    for (const [dependency, value] of Object.entries(recordOf(manifest.dependencies))) {
      const range = String(value);
      if (vendoredNames.has(dependency)) {
        continue;
      }
      if (range.startsWith('workspace:')) {
        if (PUBLISHABLE_PACKAGES.includes(dependency)) {
          want(dependency, plan.version);
        } else {
          problems.push(
            `dependency ${dependency} is a private workspace package that is not vendored`,
          );
        }
        continue;
      }
      if (range.startsWith('catalog:')) {
        problems.push(
          `dependency ${dependency} uses "${range}", which a packed manifest cannot carry`,
        );
      }
      want(dependency, range);
    }
  };
  dependenciesOf(source);
  plan.vendored.forEach(({ manifest }) => {
    dependenciesOf(manifest);
  });
  for (const [dependency, ranges] of wanted) {
    if (ranges.length > 1) {
      problems.push(`dependency ${dependency} is wanted as "${ranges.join('" and as "')}"`);
    }
  }
  if (problems.length > 0) {
    throw new PackRefusedError(name, problems);
  }

  const packed: Record<string, unknown> = { name, version: plan.version };
  for (const field of ['description', 'license', 'type']) {
    if (source[field] !== undefined) {
      packed[field] = source[field];
    }
  }
  packed.exports = withoutSourceCondition(source.exports);
  for (const field of KEPT_FIELDS) {
    if (source[field] !== undefined) {
      packed[field] = source[field];
    }
  }
  packed.sideEffects = false;
  packed.files = ['dist'];
  if (wanted.size > 0) {
    packed.dependencies = Object.fromEntries(
      [...wanted.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([dependency, ranges]) => [dependency, ranges[0]]),
    );
  }
  for (const field of ['peerDependencies', 'peerDependenciesMeta']) {
    if (source[field] !== undefined) {
      packed[field] = source[field];
    }
  }
  packed.publishConfig = source.publishConfig;
  return packed;
}

interface SpecifierAt {
  readonly specifier: string;
  readonly start: number;
  readonly end: number;
}

/** The module specifiers of a module or declaration file, with where each one's text is. */
function specifiersAt(code: string): SpecifierAt[] {
  return ts
    .preProcessFile(code, true, true)
    .importedFiles.map(({ fileName, pos }) => ({
      specifier: fileName,
      start: pos + 1,
      end: pos + 1 + fileName.length,
    }))
    .filter(({ specifier, start, end }) => code.slice(start, end) === specifier);
}

export function specifiersOf(code: string): string[] {
  return specifiersAt(code).map(({ specifier }) => specifier);
}

export function rewriteSpecifiers(
  code: string,
  rewrite: (specifier: string) => string | undefined,
): string {
  let result = code;
  for (const { specifier, start, end } of specifiersAt(code).reverse()) {
    const replacement = rewrite(specifier);
    if (replacement !== undefined) {
      result = `${result.slice(0, start)}${replacement}${result.slice(end)}`;
    }
  }
  return result;
}

export function withoutSourceMapComment(code: string): string {
  return code.replace(/^\/\/# sourceMappingURL=[^\n]*(?:\n|$)/gm, '');
}

/** One package whose built modules are staged: the package itself or a vendored one. */
interface StagedPackage {
  readonly name: string;
  readonly root: string;
  readonly prefix: string;
  readonly exports: unknown;
}

const isFile = (path: string): boolean => existsSync(path) && statSync(path).isFile();

/** The first target under the conditions a declaration file or a module resolves. */
function conditionTarget(entry: unknown, kind: 'types' | 'module'): string | undefined {
  if (typeof entry === 'string') {
    return kind === 'types' && entry.endsWith('.js') ? entry.replace(/\.js$/, '.d.ts') : entry;
  }
  if (!isRecord(entry)) {
    return undefined;
  }
  for (const [key, member] of Object.entries(entry)) {
    if (key === SOURCE_CONDITION || (kind === 'module' && key === 'types')) {
      continue;
    }
    if (kind === 'types' && key === 'types' && typeof member === 'string') {
      return member;
    }
    const found = conditionTarget(member, kind);
    if (found !== undefined && (kind === 'module' || found.endsWith('.d.ts'))) {
      return found;
    }
  }
  return undefined;
}

/** A specifier relative to `fromDir` for a staged path, in the `.js` form for a declaration. */
function relativeSpecifier(fromDir: string, stagedPath: string): string {
  const target = stagedPath.replace(/\.d\.ts$/, '.js');
  const relativePath = posix.relative(fromDir, target);
  return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
}

export function stageModules(input: StageInput): string[] {
  const problems: string[] = [];
  const self: StagedPackage = {
    name: String(input.manifest.name),
    root: input.distDir,
    prefix: '',
    exports: input.manifest.exports,
  };
  const vendored = new Map<string, StagedPackage>(
    input.vendored.map(({ name, folder, manifest, distDir }) => [
      name,
      { name, root: distDir, prefix: `vendor/${folder}/`, exports: manifest.exports },
    ]),
  );
  const staged = new Set<string>();
  const queue: { readonly owner: StagedPackage; readonly path: string }[] = [];
  const enqueue = (owner: StagedPackage, path: string): string => {
    const stagedPath = `${owner.prefix}${path}`;
    if (!staged.has(stagedPath)) {
      staged.add(stagedPath);
      queue.push({ owner, path });
    }
    return stagedPath;
  };

  for (const target of exportTargets(self.exports)) {
    const path = target.replace(/^\.\/dist\//, '');
    if (isFile(join(self.root, path))) {
      enqueue(self, path);
    } else {
      problems.push(`export target ${target} was not built`);
    }
  }

  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const { owner, path } = next;
    const kind = path.endsWith('.d.ts') ? 'types' : 'module';
    const label = owner === self ? `dist/${path}` : `${owner.name} dist/${path}`;
    const stagedPath = `${owner.prefix}${path}`;
    const stagedDir = posix.dirname(stagedPath);
    const code = withoutSourceMapComment(readFileSync(join(owner.root, path), 'utf8'));
    const rewritten = rewriteSpecifiers(code, (specifier) => {
      if (specifier.startsWith('./') || specifier.startsWith('../')) {
        const base = posix.normalize(posix.join(posix.dirname(path), specifier));
        const candidates =
          kind === 'types'
            ? [
                ...(base.endsWith('.js') ? [base.replace(/\.js$/, '.d.ts')] : []),
                `${base}.d.ts`,
                `${base}/index.d.ts`,
              ]
            : [...(/\.(?:m?js|json)$/.test(base) ? [base] : []), `${base}.js`, `${base}/index.js`];
        const found = candidates.find(
          (candidate) => !candidate.startsWith('..') && isFile(join(owner.root, candidate)),
        );
        if (found === undefined) {
          problems.push(`${label} imports ${specifier}, which the build did not write`);
          return undefined;
        }
        return relativeSpecifier(stagedDir, enqueue(owner, found));
      }
      const target = vendored.get(packageNameOf(specifier));
      if (target === undefined) {
        return undefined;
      }
      const subpath = `.${specifier.slice(target.name.length)}`;
      const entry = subpathsOf(target.exports).find(([key]) => key === subpath)?.[1];
      const resolved = entry === undefined ? undefined : conditionTarget(entry, kind);
      if (resolved === undefined) {
        problems.push(`${label} imports ${specifier}, which ${target.name} does not export`);
        return undefined;
      }
      const targetPath = resolved.replace(/^\.\/dist\//, '');
      if (!isFile(join(target.root, targetPath))) {
        problems.push(`${label} imports ${specifier}, whose ${resolved} was not built`);
        return undefined;
      }
      return relativeSpecifier(stagedDir, enqueue(target, targetPath));
    });
    const destination = join(input.stagingDist, stagedPath);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, rewritten);
  }

  if (problems.length > 0) {
    throw new PackRefusedError(self.name, problems);
  }
  return [...staged].sort();
}

/** Every file under `dir`, as paths relative to it with forward slashes. */
function filesUnder(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesUnder(join(dir, entry.name), `${prefix}${entry.name}/`)
      : [`${prefix}${entry.name}`],
  );
}

export function undeclaredSpecifiers(stagingDist: string, manifest: Manifest): string[] {
  const declared = new Set([
    String(manifest.name),
    ...Object.keys(recordOf(manifest.dependencies)),
    ...Object.keys(recordOf(manifest.peerDependencies)),
  ]);
  const found = new Set<string>();
  for (const path of filesUnder(stagingDist).filter((file) => /\.(?:js|d\.ts)$/.test(file))) {
    for (const specifier of specifiersOf(readFileSync(join(stagingDist, path), 'utf8'))) {
      if (specifier.startsWith('.') || isBuiltin(specifier)) {
        continue;
      }
      if (!declared.has(packageNameOf(specifier))) {
        found.add(`${path}: ${specifier}`);
      }
    }
  }
  return [...found].sort();
}

/** A built module under `package/dist/`, with no empty, `.` or `..` segment. */
const isBuiltModule = (path: string): boolean =>
  path.startsWith('package/dist/') &&
  MODULE_SUFFIX.test(path) &&
  path
    .slice('package/dist/'.length)
    .split('/')
    .every((segment) => segment !== '' && segment !== '.' && segment !== '..');

export function refusedPaths(paths: readonly string[]): string[] {
  return paths.filter(
    (path) =>
      !(ALLOWED_TOP_LEVEL.test(path) || isBuiltModule(path)) || TEST_LIKE.test(basename(path)),
  );
}

const textOf = (bytes: Buffer): string => {
  const end = bytes.indexOf(0);
  return bytes.subarray(0, end === -1 ? bytes.length : end).toString('utf8');
};

/** The `path` record of a pax extended header, if it has one. */
function paxPathOf(body: Buffer): string | undefined {
  let path: string | undefined;
  let offset = 0;
  while (offset < body.length) {
    const space = body.indexOf(0x20, offset);
    const length = Number(body.subarray(offset, space).toString('utf8'));
    if (space === -1 || !Number.isInteger(length) || length <= 0) {
      break;
    }
    const record = body.subarray(space + 1, offset + length - 1).toString('utf8');
    const equals = record.indexOf('=');
    if (record.slice(0, equals) === 'path') {
      path = record.slice(equals + 1);
    }
    offset += length;
  }
  return path;
}

export function readTarball(gzipped: Buffer): TarEntry[] {
  const data = gunzipSync(gzipped);
  const entries: TarEntry[] = [];
  let pendingPath: string | undefined;
  let offset = 0;
  for (;;) {
    if (offset + 512 > data.length) {
      throw new Error('the tarball is truncated');
    }
    const header = data.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      return entries;
    }
    const name = textOf(header.subarray(0, 100));
    const size = Number.parseInt(textOf(header.subarray(124, 136)).trim() || '0', 8);
    const type = String.fromCharCode(header[156] ?? 0);
    const prefix = textOf(header.subarray(345, 500));
    const start = offset + 512;
    if (start + size > data.length) {
      throw new Error('the tarball is truncated');
    }
    const body = data.subarray(start, start + size);
    if (type === 'x') {
      pendingPath = paxPathOf(body);
    } else {
      if (type === '0' || type === '\0') {
        const path = pendingPath ?? (prefix === '' ? name : `${prefix}/${name}`);
        entries.push({ path, bytes: size, content: Buffer.from(body) });
      }
      pendingPath = undefined;
    }
    offset = start + Math.ceil(size / 512) * 512;
  }
}

export function workspacePackages(repoRoot: string): Map<string, string> {
  const lines = readFileSync(join(repoRoot, 'pnpm-workspace.yaml'), 'utf8').split('\n');
  const patterns: string[] = [];
  let inPackages = false;
  for (const line of lines) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
    } else if (inPackages && /^\S/.test(line)) {
      inPackages = false;
    } else if (inPackages) {
      const match = /^\s+-\s+['"]?([^'"#\s]+)['"]?\s*$/.exec(line);
      if (match?.[1] !== undefined) {
        patterns.push(match[1]);
      }
    }
  }
  const packages = new Map<string, string>();
  const add = (dir: string): void => {
    const manifestPath = join(dir, 'package.json');
    if (isFile(manifestPath)) {
      packages.set(String(readJson(manifestPath).name), dir);
    }
  };
  for (const pattern of patterns) {
    if (pattern.endsWith('/*')) {
      const parent = join(repoRoot, pattern.slice(0, -2));
      for (const entry of existsSync(parent) ? readdirSync(parent, { withFileTypes: true }) : []) {
        if (entry.isDirectory()) {
          add(join(parent, entry.name));
        }
      }
    } else {
      add(join(repoRoot, pattern));
    }
  }
  return packages;
}

export function repositoryRootOf(dir: string): string {
  for (let current = resolve(dir); ; current = dirname(current)) {
    if (isFile(join(current, 'pnpm-workspace.yaml'))) {
      return current;
    }
    if (dirname(current) === current) {
      throw new Error(`no pnpm-workspace.yaml above ${dir}`);
    }
  }
}

export function vendoredClosure(
  manifest: Manifest,
  packages: ReadonlyMap<string, string>,
  distOf: (name: string, packageDir: string) => string,
): VendoredPackage[] {
  const found = new Map<string, VendoredPackage>();
  const visit = (from: Manifest): void => {
    for (const dependency of Object.keys(recordOf(from.dependencies))) {
      const dir = packages.get(dependency);
      if (
        dir === undefined ||
        PUBLISHABLE_PACKAGES.includes(dependency) ||
        dependency === from.name ||
        found.has(dependency)
      ) {
        continue;
      }
      const vendoredManifest = readJson(join(dir, 'package.json'));
      found.set(dependency, {
        name: dependency,
        folder: basename(dir),
        manifest: vendoredManifest,
        distDir: distOf(dependency, dir),
      });
      visit(vendoredManifest);
    }
  };
  visit(manifest);
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The tarball name `pnpm pack` writes: the scope's `@` dropped and its `/` made a `-`. */
const tarballNameOf = (name: string, version: string): string =>
  `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`;

export function packRelease(options: PackOptions): PackResult {
  const packageDir = resolve(options.packageDir);
  const outDir = resolve(options.outDir);
  const manifest = readJson(join(packageDir, 'package.json'));
  const name = String(manifest.name);
  const repoRoot = repositoryRootOf(packageDir);
  const distOf = options.distOf ?? ((_name: string, dir: string) => join(dir, 'dist'));
  const vendored = vendoredClosure(manifest, workspacePackages(repoRoot), distOf);
  const version = options.version ?? String(manifest.version);
  const packed = packedManifest(manifest, { version, vendored });

  const readme = join(packageDir, 'README.md');
  const licence = [join(packageDir, 'LICENSE'), join(repoRoot, 'LICENSE')].find(isFile);
  const missing = [
    ...(isFile(readme) ? [] : ['README.md is missing']),
    ...(licence === undefined
      ? ['LICENSE is missing (neither the package nor the repository root has one)']
      : []),
  ];
  if (missing.length > 0 || licence === undefined) {
    throw new PackRefusedError(name, missing);
  }

  const staging = mkdtempSync(join(tmpdir(), 'openverify-pack-'));
  try {
    writeFileSync(join(staging, 'package.json'), `${JSON.stringify(packed, null, 2)}\n`);
    copyFileSync(readme, join(staging, 'README.md'));
    copyFileSync(licence, join(staging, 'LICENSE'));
    const stagingDist = join(staging, 'dist');
    stageModules({ manifest, distDir: distOf(name, packageDir), vendored, stagingDist });
    const undeclared = undeclaredSpecifiers(stagingDist, packed);
    if (undeclared.length > 0) {
      throw new PackRefusedError(
        name,
        undeclared.map((found) => `${found} is imported but is not a dependency`),
      );
    }

    mkdirSync(outDir, { recursive: true });
    const tarball = join(outDir, tarballNameOf(name, version));
    rmSync(tarball, { force: true });
    const run = spawnSync(options.pnpm ?? 'pnpm', ['pack', '--pack-destination', outDir], {
      cwd: staging,
      encoding: 'utf8',
    });
    if (run.status !== 0 || !isFile(tarball)) {
      throw new Error(
        `pnpm pack did not write ${tarball} (exit ${String(run.status)}): ${run.stderr}`,
      );
    }
    const bytes = readFileSync(tarball);
    const entries = readTarball(bytes);
    const refused = refusedPaths(entries.map(({ path }) => path));
    if (refused.length > 0) {
      rmSync(tarball, { force: true });
      throw new PackRefusedError(
        name,
        refused.map((path) => `the tarball holds ${path}, which a release must not`),
      );
    }
    const files = entries
      .map(({ path, bytes: size }) => ({ path, bytes: size }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const packedJson = entries.find(({ path }) => path === 'package/package.json');
    return {
      name,
      version,
      tarball,
      bytes: bytes.length,
      unpackedBytes: files.reduce((sum, file) => sum + file.bytes, 0),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      files,
      manifest:
        packedJson === undefined
          ? {}
          : (JSON.parse(packedJson.content.toString('utf8')) as Manifest),
    };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

const USAGE = 'usage: pack-release.ts --out <dir> [--version <x.y.z>] <package dir>...';

export function main(
  argv: readonly string[],
  write: (line: string) => void = () => undefined,
  writeError: (line: string) => void = () => undefined,
): number {
  let outDir: string | undefined;
  let version: string | undefined;
  const packageDirs: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? '';
    if (argument === '--out' || argument === '--version') {
      const value = argv[index + 1];
      if (value === undefined) {
        writeError(USAGE);
        return 2;
      }
      if (argument === '--out') {
        outDir = value;
      } else {
        version = value;
      }
      index += 1;
    } else if (argument.startsWith('--')) {
      writeError(USAGE);
      return 2;
    } else {
      packageDirs.push(argument);
    }
  }
  if (outDir === undefined || packageDirs.length === 0) {
    writeError(USAGE);
    return 2;
  }
  for (const packageDir of packageDirs) {
    try {
      const result = packRelease({
        packageDir,
        outDir,
        ...(version === undefined ? {} : { version }),
      });
      write(
        `${result.name}@${result.version} ${result.tarball} ${String(result.bytes)} bytes sha256 ${result.sha256}`,
      );
      write(
        `  unpacked ${String(result.unpackedBytes)} bytes in ${String(result.files.length)} files`,
      );
      for (const file of result.files) {
        write(`  ${file.path}`);
      }
    } catch (error) {
      writeError(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }
  return 0;
}

const invokedAs = process.argv[1];
if (invokedAs !== undefined && import.meta.url === pathToFileURL(resolve(invokedAs)).href) {
  process.exitCode = main(
    process.argv.slice(2),
    (line) => process.stdout.write(`${line}\n`),
    (line) => process.stderr.write(`${line}\n`),
  );
}
