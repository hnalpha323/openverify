/**
 * C277.2 (review F10; Workflow 11B Stage 1b common): every variable a process's sources name is in
 * `CONFIG_REGISTRY`, with the processes that read it, and the registry names nothing that no
 * source reads. The scan covers every process's own sources (the API and worker, their operator
 * scripts, the console, the flow server and app, vision, the code runner) and the library packages
 * they import; tests, test support, generated output and the client SDKs (the customer's code)
 * are left out.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CONFIG_PROCESSES,
  CONFIG_REGISTRY,
  isPatternEntry,
  type ConfigProcess,
  type ConfigVariable,
} from './config-registry.js';
import { CONFIG_SECRETS } from './config.js';

const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');

/** A source tree and the processes whose reads it holds (`null`: a library any process imports). */
interface Tree {
  readonly path: string;
  readonly processes: readonly ConfigProcess[] | null;
}

const TREES: readonly Tree[] = [
  { path: 'apps/api/src', processes: ['api', 'worker', 'migrate'] },
  { path: 'apps/api/scripts', processes: ['api', 'worker', 'migrate'] },
  { path: 'apps/dashboard/src', processes: ['dashboard'] },
  { path: 'apps/dashboard/next.config.ts', processes: ['dashboard'] },
  { path: 'apps/flow/server.ts', processes: ['flow'] },
  { path: 'apps/flow/src', processes: ['flow'] },
  { path: 'services/vision/src', processes: ['vision'] },
  { path: 'packages/workflow-engine/bin', processes: ['code-runner'] },
  ...[
    'checks',
    'contracts',
    'core',
    'db',
    'signals',
    'watchlist',
    'workflow-engine',
    'flow-spec',
  ].map((name) => ({ path: `packages/${name}/src`, processes: null })),
];

const REGISTRY_FILE = join(REPO, 'apps/api/src/config-registry.ts');
const SOURCE = /\.(?:ts|tsx|mts|mjs|js|py)$/;
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.next',
  'test-support',
  'testing',
  '__pycache__',
]);
const TEST_FILE =
  /(?:\.test\.tsx?|\.spec\.tsx?|\.d\.ts|(?:^|\/)testing\.ts|(?:^|\/)test_[^/]+\.py)$/;

function* filesOf(path: string): Generator<string> {
  const stat = statSync(path);
  if (stat.isFile()) {
    yield path;
    return;
  }
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        yield* filesOf(join(path, entry.name));
      }
    } else if (
      SOURCE.test(entry.name) &&
      !TEST_FILE.test(entry.name) &&
      // The registry names every variable; it reads none.
      join(path, entry.name) !== REGISTRY_FILE
    ) {
      yield join(path, entry.name);
    }
  }
}

const NAME = /OPENVERIFY_[A-Z0-9_]+/g;
/**
 * A read, as opposed to a mention in a comment or a sentence: the name after `env.` or
 * `process.env.`, or a whole quoted string (`'NAME'`, `"NAME"`, `env['NAME']`, a `*_ENV` constant),
 * or a name a source composes from (a prefix ending in `_`, or `NAME_${...}`).
 */
const READ =
  /(?:\benv\.(OPENVERIFY_[A-Z0-9_]+))|(?:['"](OPENVERIFY_[A-Z0-9_]+)['"])|(?:[`'"](OPENVERIFY_[A-Z0-9_]+_)(?:\$\{|['"`]))/g;

interface Scan {
  /** Every name the tree's sources mention, with one file that mentions it. */
  readonly names: Map<string, string>;
  /** The names the tree's sources read, by the forms of {@link READ}. */
  readonly reads: Map<string, string>;
}

function scan(tree: Tree): Scan {
  const names = new Map<string, string>();
  const reads = new Map<string, string>();
  for (const file of filesOf(join(REPO, tree.path))) {
    const text = readFileSync(file, 'utf8');
    const where = relative(REPO, file);
    for (const match of text.matchAll(NAME)) {
      if (!names.has(match[0])) {
        names.set(match[0], where);
      }
    }
    for (const match of text.matchAll(READ)) {
      const name = match[1] ?? match[2] ?? match[3];
      if (name !== undefined && !reads.has(name)) {
        reads.set(name, where);
      }
    }
  }
  return { names, reads };
}

const SCANS = TREES.map((tree) => ({ tree, ...scan(tree) }));
const EXACT = new Map(
  CONFIG_REGISTRY.filter((entry) => !isPatternEntry(entry)).map((entry) => [entry.name, entry]),
);
const PATTERNS = CONFIG_REGISTRY.filter(isPatternEntry);

/**
 * The entries a scanned name stands for: the exact entry, the entry whose `_FILE` form it is, the
 * pattern entries it starts with, or (for a prefix a source composes from, ending in `_` or cut
 * short by a placeholder) every entry it starts.
 */
function entriesFor(name: string): ConfigVariable[] {
  const exact = EXACT.get(name);
  if (exact !== undefined) {
    return [exact];
  }
  if (name.endsWith('_FILE')) {
    const secret = EXACT.get(name.slice(0, -'_FILE'.length));
    if (secret?.fileForm === true) {
      return [secret];
    }
  }
  const patterns = PATTERNS.filter((entry) => name.startsWith(entry.prefix ?? '\0'));
  if (patterns.length > 0) {
    return patterns;
  }
  return name.endsWith('_') ? CONFIG_REGISTRY.filter((entry) => entry.name.startsWith(name)) : [];
}

describe('the configuration registry (C277.2)', () => {
  it('registers every variable a process reads', () => {
    const unregistered = SCANS.flatMap(({ names }) =>
      [...names]
        .filter(([name]) => entriesFor(name).length === 0)
        .map(([name, file]) => `${name} (${file})`),
    );
    expect(unregistered).toEqual([]);
  });

  it('names, for each variable, the process whose sources read it', () => {
    const missing = SCANS.flatMap(({ tree, reads }) => {
      if (tree.processes === null) {
        return [];
      }
      const readers = tree.processes;
      // A mention in a comment or in words shown to a user is not a read by that process.
      return [...reads]
        .filter(([name]) =>
          entriesFor(name).every((entry) => !entry.processes.some((p) => readers.includes(p))),
        )
        .map(([name]) => `${name} (${tree.path}: ${readers.join(' or ')})`);
    });
    expect(missing).toEqual([]);
  });

  it('finds the reads of each process (positive controls of the scan)', () => {
    const readsOf = (path: string) => SCANS.find(({ tree }) => tree.path === path)?.reads;
    expect(readsOf('apps/dashboard/src')?.has('OPENVERIFY_API_URL')).toBe(true);
    expect(readsOf('apps/flow/server.ts')?.has('OPENVERIFY_FLOW_SERVER_TOKEN')).toBe(true);
    expect(readsOf('services/vision/src')?.has('OPENVERIFY_VISION_')).toBe(true);
    expect(readsOf('packages/workflow-engine/bin')?.has('OPENVERIFY_CODE_RUNNER_SOCKET')).toBe(
      true,
    );
    expect(readsOf('apps/api/src')?.has('OPENVERIFY_CONNECT_ENABLED')).toBe(true);
  });

  it('names nothing that no source reads', () => {
    const mentioned = new Set(SCANS.flatMap(({ names }) => [...names.keys()]));
    const prefixes = [...mentioned].filter((name) => name.endsWith('_'));
    const stale = [...EXACT.keys()].filter(
      (name) =>
        name.startsWith('OPENVERIFY_') &&
        !mentioned.has(name) &&
        !prefixes.some((prefix) => name.startsWith(prefix)),
    );
    expect(stale).toEqual([]);
  });

  it('holds each name once, in name order, each with a description and a process', () => {
    const names = CONFIG_REGISTRY.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual([...names].sort());
    for (const entry of CONFIG_REGISTRY) {
      expect(entry.description.length, entry.name).toBeGreaterThan(20);
      expect(entry.processes.length, entry.name).toBeGreaterThan(0);
      expect(
        entry.processes.every((p) => CONFIG_PROCESSES.includes(p)),
        entry.name,
      ).toBe(true);
    }
  });

  it('gives every secret the API, the worker or migrate read its _FILE form, and nothing else (C249.2)', () => {
    const typescript = (entry: ConfigVariable) =>
      entry.processes.some((p) => p === 'api' || p === 'worker' || p === 'migrate');
    for (const entry of CONFIG_REGISTRY) {
      expect(entry.fileForm, entry.name).toBe(entry.secret && typescript(entry));
    }
  });

  it('marks every secret config.ts refuses as a placeholder a secret', () => {
    const notSecret = CONFIG_SECRETS.filter((name) => EXACT.get(name)?.secret !== true);
    expect(notSecret).toEqual([]);
  });

  it('holds the store credentials and the keys the database package reads as secrets', () => {
    for (const name of [
      'DATABASE_URL',
      'REDIS_URL',
      'S3_SECRET_ACCESS_KEY',
      'OPENVERIFY_KEK',
      'OPENVERIFY_KEK_PREVIOUS',
      'OPENVERIFY_BLIND_INDEX_KEY',
      'OPENVERIFY_SMTP_URL',
    ]) {
      expect(EXACT.get(name)?.secret, name).toBe(true);
    }
  });

  it('has pattern entries for the names composed at run time', () => {
    expect(PATTERNS.map((entry) => [entry.name, entry.prefix, entry.secret])).toEqual(
      expect.arrayContaining([
        ['OPENVERIFY_PROVIDER_{KIND}_{MODE}', 'OPENVERIFY_PROVIDER_', false],
        ['OPENVERIFY_SEED_{ROLE}_EMAIL', 'OPENVERIFY_SEED_', false],
        ['OPENVERIFY_SEED_{ROLE}_PASSWORD', 'OPENVERIFY_SEED_', true],
      ]),
    );
    for (const entry of PATTERNS) {
      expect(entry.name.startsWith(entry.prefix ?? '\0'), entry.name).toBe(true);
      expect(entry.name, entry.name).toMatch(/\{[A-Z]+\}/);
    }
  });

  // Stage 1a amendment 25: the variables 11B adds, each with its processes and secret flag.
  it.each([
    ['OPENVERIFY_CONSOLE_IDLE_TIMEOUT_SECONDS', ['api'], false, '1800'],
    ['OPENVERIFY_CONSOLE_ABSOLUTE_TIMEOUT_SECONDS', ['api'], false, '43200'],
    ['OPENVERIFY_API_KEY_PEPPER_PREVIOUS', ['api', 'worker'], true, null],
    ['OPENVERIFY_SSO_PRIVATE_ISSUERS', ['api'], false, null],
    ['OPENVERIFY_POSTGRES_CA_FILE', ['api', 'worker', 'migrate'], false, null],
    ['OPENVERIFY_REDIS_CA_FILE', ['api', 'worker', 'migrate'], false, null],
    ['OPENVERIFY_S3_CA_FILE', ['api', 'worker'], false, null],
    ['OPENVERIFY_VISION_CA_FILE', ['api', 'worker'], false, null],
    ['OPENVERIFY_MIGRATION_DATABASE_URL', ['migrate'], true, null],
    ['OPENVERIFY_MIGRATE_LOCK_TIMEOUT_SECONDS', ['migrate'], false, '600'],
    ['OPENVERIFY_WORKER_HEARTBEAT_FILE', ['worker'], false, '/tmp/openverify-worker-heartbeat'],
    ['OPENVERIFY_INTERNAL_LISTEN', ['api'], false, null],
    ['OPENVERIFY_QUEUE_IN_FLIGHT_CAP_MAX', ['api', 'worker'], false, '50'],
    // Q10 granted (2026-11-21; Workflow 11G records-11g): the documented default is true.
    ['OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED', ['api', 'worker'], false, 'true'],
    ['OPENVERIFY_HSTS_MAX_AGE', ['api', 'flow', 'dashboard'], false, '0'],
  ] as const)('registers %s (Stage 1a amendment 25)', (name, processes, secret, fallback) => {
    const entry = EXACT.get(name);
    expect(entry?.processes).toEqual(processes);
    expect(entry?.secret).toBe(secret);
    expect(entry?.default).toBe(fallback);
  });

  it("registers Workflow 7A's variables with the processes the scan finds", () => {
    expect(EXACT.get('OPENVERIFY_NETWORK_REFRESH')?.processes).toEqual(['worker']);
    expect(EXACT.get('OPENVERIFY_IP_REPUTATION_MMDB_PATH')?.secret).toBe(false);
    for (const name of [
      'OPENVERIFY_NETWORK_SOURCES_DISABLED',
      'OPENVERIFY_NETWORK_SOURCES_ENABLED',
      'OPENVERIFY_HANDOFF_SENDS_PER_HOUR',
      'OPENVERIFY_IP_REPUTATION_MMDB_PATH',
    ]) {
      expect(EXACT.has(name), name).toBe(true);
    }
    expect(entriesFor('OPENVERIFY_PROVIDER_IP_REPUTATION_SANDBOX').map((e) => e.name)).toEqual([
      'OPENVERIFY_PROVIDER_{KIND}_{MODE}',
    ]);
  });
});
