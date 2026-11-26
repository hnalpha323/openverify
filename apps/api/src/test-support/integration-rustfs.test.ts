/**
 * K8-37 (Workflow 8D review): every Testcontainers RustFS of the repository starts through
 * `startIntegrationRustfs`, which waits for a real S3 answer and starts a fresh container after a
 * failed start, as `startIntegrationPostgres` does for Postgres (K7B-13).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  INTEGRATION_RUSTFS_READY_TIMEOUT_MS,
  INTEGRATION_RUSTFS_RETRIES,
  INTEGRATION_RUSTFS_STARTUP_TIMEOUT_MS,
  RUSTFS_PORT,
  RUSTFS_TEST_IMAGE,
  defineRustfsContainer,
  listBuckets,
} from './integration-rustfs.js';

/** The repository's root, from this file (`apps/api/src/test-support`). */
const REPO_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
  '..',
  '..',
  '..',
);

/** Built, so this file does not hold it literally and does not find itself. */
const RUSTFS_IMAGE_PREFIX = ['rustfs', 'rustfs:'].join('/');

/** Every source file under `dir` a test or a script can start a container from. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return ['node_modules', 'dist', 'coverage', '.next'].includes(entry.name)
        ? []
        : sourceFiles(full);
    }
    return /\.(?:ts|tsx|mjs|js)$/.test(entry.name) ? [full] : [];
  });
}

const isDirectory = (dir: string) => {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
};

/** Every source file under `apps/*` and `packages/*` (`src`, `scripts`), and `e2e`'s. */
function repositorySources(): string[] {
  const packages = ['apps', 'packages'].flatMap((top) =>
    readdirSync(path.join(REPO_ROOT, top), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) =>
        ['src', 'scripts'].map((sub) => path.join(REPO_ROOT, top, entry.name, sub)),
      ),
  );
  return [...packages, path.join(REPO_ROOT, 'e2e')].filter(isDirectory).flatMap(sourceFiles);
}

describe('the one RustFS starter (K8-37)', () => {
  it('names the RustFS image in one source file, the starter every integration test uses', () => {
    const naming = repositorySources()
      .filter((file) => readFileSync(file, 'utf8').includes(RUSTFS_IMAGE_PREFIX))
      .map((file) => path.relative(REPO_ROOT, file));

    expect(naming).toEqual(['apps/api/src/test-support/integration-rustfs.ts']);
  });
});

describe('defineRustfsContainer (K8-37)', () => {
  /** The container's create options and startup timeout, which Testcontainers keeps protected. */
  const settings = (container: unknown) =>
    container as {
      createOpts: { Image: string; Env?: string[] };
      exposedPorts: unknown[];
      startupTimeoutMs?: number;
    };

  it('defines the pinned image with the caller’s keys, the S3 port and Testcontainers’ own 60 s wait', async () => {
    const container = settings(
      await defineRustfsContainer({
        accessKeyId: 'synthetic-starter-key',
        secretAccessKey: 'synthetic-starter-secret',
      }),
    );

    expect(container.createOpts.Image).toBe(RUSTFS_TEST_IMAGE);
    // C258.1 (Phase 11, Workflow 11C): the tag CLAUDE.md names, with the plan's digest.
    expect(RUSTFS_TEST_IMAGE).toBe(
      `${RUSTFS_IMAGE_PREFIX}1.0.3@sha256:9ca9559533b537d10482fe923288b676ad08f92a7069d9a17327fbae3cab688b`,
    );
    expect(container.createOpts.Env).toEqual(
      expect.arrayContaining([
        'RUSTFS_ACCESS_KEY=synthetic-starter-key',
        'RUSTFS_SECRET_KEY=synthetic-starter-secret',
        `RUSTFS_ADDRESS=:${String(RUSTFS_PORT)}`,
      ]),
    );
    expect(container.exposedPorts).toEqual([RUSTFS_PORT]);
    expect(container.startupTimeoutMs).toBe(INTEGRATION_RUSTFS_STARTUP_TIMEOUT_MS);
    expect([
      INTEGRATION_RUSTFS_STARTUP_TIMEOUT_MS,
      INTEGRATION_RUSTFS_READY_TIMEOUT_MS,
      INTEGRATION_RUSTFS_RETRIES,
    ]).toEqual([60_000, 60_000, 2]);
  });
});

describe('listBuckets (K8-37)', () => {
  it('rejects when nothing answers on the port', async () => {
    await expect(
      listBuckets('http://127.0.0.1:1', {
        accessKeyId: 'synthetic-starter-key',
        secretAccessKey: 'synthetic-starter-secret',
      }),
    ).rejects.toThrow();
  });
});
