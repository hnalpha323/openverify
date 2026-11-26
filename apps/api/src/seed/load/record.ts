/**
 * C268.3 (Workflow 11D load-harness): the seed record `seed:load` writes for the load harness
 * (`load/scenarios/seed.py` reads it, schema `openverify/load-seed@1`): the API keys of each
 * scenario's pool with the environment each belongs to, the console users (email, password, TOTP
 * secret, organisation, the documentation address each signs in from), the ids each scenario reads
 * or acts on, single references (a template, a connection, a list) and the steps and parts already
 * done. It holds secrets, so it lives only in a mode-0600 file under `/tmp` (`--secrets-file`),
 * created exclusively and replaced atomically, never printed, logged or committed.
 */
import { dirname, isAbsolute, join } from 'node:path';
import type { LoadScale } from './counts.js';

/**
 * The file operations the record needs, passed in by `scripts/seed-load.ts` (node:fs/promises), so
 * no production module of `src/` imports the file system (C260.1's reviewed list).
 */
export interface LoadSeedFiles {
  lstat(path: string): Promise<{ isFile(): boolean; mode: number; uid: number }>;
  realpath(path: string): Promise<string>;
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  /** Creates `path` exclusively (`wx`, no symlink followed) at `mode` and writes `text` to it. */
  createExclusive(path: string, text: string, mode: number): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /** A new private (0700) directory under the system temporary directory. */
  makeTemporaryDirectory(prefix: string): Promise<string>;
  /** Writes `chunks` to a new file at `mode`, one chunk at a time. */
  writeChunks(path: string, chunks: Iterable<string>, mode: number): Promise<void>;
  removeDirectory(path: string): Promise<void>;
}

export const LOAD_SEED_SCHEMA = 'openverify/load-seed@1';

export interface LoadSeedKey {
  token: string;
  environment: string;
}

export interface LoadSeedUser {
  email: string;
  password: string;
  'totp-secret': string;
  organisation: string;
  address: string;
}

export interface LoadSeedRecord {
  schema: typeof LOAD_SEED_SCHEMA;
  scale: LoadScale;
  /** Environment label (`load-a sandbox`) to id. */
  environments: Record<string, string>;
  /** Organisation label (`load-a`) to id. */
  organisations: Record<string, string>;
  keys: Record<string, LoadSeedKey[]>;
  users: LoadSeedUser[];
  ids: Record<string, string[]>;
  refs: Record<string, string>;
  /** `<step>` or `<step>:<part>` once done, so a repeated call skips it. */
  done: string[];
}

/** The record file is unusable: the message names the rule, never a value. */
export class LoadSeedRecordError extends Error {
  override name = 'LoadSeedRecordError';
}

export function emptyRecord(scale: LoadScale): LoadSeedRecord {
  return {
    schema: LOAD_SEED_SCHEMA,
    scale,
    environments: {},
    organisations: {},
    keys: {},
    users: [],
    ids: {},
    refs: {},
    done: [],
  };
}

/** A secrets file is an absolute path under `/tmp` (its directory resolved, no symlink tricks). */
export async function assertSecretsPath(files: LoadSeedFiles, path: string): Promise<void> {
  if (!isAbsolute(path)) {
    throw new LoadSeedRecordError('--secrets-file must be an absolute path under /tmp');
  }
  const directory = await files.realpath(dirname(path)).catch(() => {
    throw new LoadSeedRecordError('--secrets-file must be in an existing directory under /tmp');
  });
  if (directory !== '/tmp' && !directory.startsWith('/tmp/')) {
    throw new LoadSeedRecordError('--secrets-file must be under /tmp');
  }
}

/** The record at `path`, or `null` when there is none yet. Refuses a file others may read. */
export async function readRecord(
  files: LoadSeedFiles,
  path: string,
): Promise<LoadSeedRecord | null> {
  await assertSecretsPath(files, path);
  const facts = await files.lstat(path).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  });
  if (facts === null) {
    return null;
  }
  if (!facts.isFile()) {
    throw new LoadSeedRecordError('--secrets-file must be a regular file');
  }
  if ((facts.mode & 0o077) !== 0) {
    throw new LoadSeedRecordError('--secrets-file must be mode 0600: it holds the seed secrets');
  }
  if (typeof process.getuid === 'function' && facts.uid !== process.getuid()) {
    throw new LoadSeedRecordError('--secrets-file must belong to the user running seed:load');
  }
  const parsed = JSON.parse(await files.readFile(path, 'utf8')) as Partial<LoadSeedRecord>;
  if (parsed.schema !== LOAD_SEED_SCHEMA) {
    throw new LoadSeedRecordError(`--secrets-file does not hold a ${LOAD_SEED_SCHEMA} record`);
  }
  return parsed as LoadSeedRecord;
}

/**
 * Writes the record: a new file is created exclusively at mode 0600; an existing one is replaced
 * by a mode-0600 sibling renamed over it, so a reader never sees half a record.
 */
export async function writeRecord(
  files: LoadSeedFiles,
  path: string,
  record: LoadSeedRecord,
): Promise<void> {
  await assertSecretsPath(files, path);
  const sibling = join(dirname(path), `.${String(process.pid)}-${String(Date.now())}.seed.tmp`);
  await files.createExclusive(sibling, `${JSON.stringify(record)}\n`, 0o600);
  await files.rename(sibling, path);
}

/** Appends `values` to the record's id pool `name`. */
export function addIds(record: LoadSeedRecord, name: string, values: readonly string[]): void {
  record.ids[name] = [...(record.ids[name] ?? []), ...values];
}

/** Appends `keys` to the record's key pool `name`. */
export function addKeys(record: LoadSeedRecord, name: string, keys: readonly LoadSeedKey[]): void {
  record.keys[name] = [...(record.keys[name] ?? []), ...keys];
}

/** The environment id of a label, or a failure naming the step that creates it. */
export function environmentOf(record: LoadSeedRecord, label: string): string {
  const id = record.environments[label];
  if (id === undefined) {
    throw new LoadSeedRecordError(
      `the record has no environment ${label}: run --step organisations first`,
    );
  }
  return id;
}
