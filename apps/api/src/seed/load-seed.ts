/**
 * C268.3 (Workflow 11D load-harness; decision 14 before 11D; Stage 1a amendments 10 and 16): the
 * load seed behind `pnpm --filter @openverify/api seed:load`, a development tool (never compiled into
 * an image) that fills the load stack's database `openverify_load` for `load/`'s scenarios:
 *
 *   seed:load --scale <small|reference>
 *     --step <organisations|principals|accounts|inquiries|lists|transactions|graph|connect|watchlists|verify>
 *     [--part <n>] [--secrets-file <path>] [--json]
 *
 * Steps run in that order, each resumable: a step (or a step's part) already in the record is
 * skipped. The large steps run in parts of at most 50,000 rows (`--part 1` ... `n`; `--part 0`
 * plans them), so each call fits ten minutes. It refuses production mode and any database not
 * named `openverify_load`, runs as the migration role (`migrationRoleEnv`), and writes every
 * generated secret (API keys, the console users' password and TOTP secrets) only to the record at
 * `--secrets-file`, a mode-0600 file under `/tmp`. Every value is synthetic: emails at
 * example.com, client addresses of the documentation ranges, the generators' names. The load
 * organisations keep the shipped `require-mfa` default (on), and every console user is enrolled
 * in TOTP (the method's item 2).
 */
import {
  APP_MODES,
  defaultAppMode,
  parseNetworkSourceLists,
  parseWatchlistSourcesDisabled,
} from '../config.js';
import {
  KEK_ENV,
  KEK_PREVIOUS_ENV,
  KeyringError,
  keyringFromEnv,
  parseBlindIndexKey,
  type Db,
  type Keyring,
} from '@openverify/db';
import { safeUrl } from '@openverify/contracts';
import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import type { Clock, IdGenerator } from '../ports.js';
import { LOAD_SCALES, LOAD_STEPS, type LoadScale, type LoadStep } from './load/counts.js';
import {
  emptyRecord,
  readRecord,
  writeRecord,
  type LoadSeedFiles,
  type LoadSeedRecord,
} from './load/record.js';
import { runLoadStep, type LoadStepContext, type LoadStepResult } from './load/steps.js';

/** The only database seed:load writes to (Stage 1a amendment 9). */
export const LOAD_DATABASE = 'openverify_load';
/** Where the record goes unless `--secrets-file` names another file under `/tmp`. */
export const DEFAULT_SECRETS_FILE = '/tmp/openverify-load/seed.json';
const USAGE =
  'usage: seed:load --scale <small|reference> --step <step> [--part <n>] [--secrets-file <path>] [--json]';

export interface LoadSeedArgs {
  scale: LoadScale;
  step: LoadStep;
  /** `undefined`: the whole step (a step with parts runs them all only at the small scale). */
  part: number | undefined;
  secretsFile: string;
  json: boolean;
  /** The watchlist tables' seed (`--table-seed`, hex); a fixed default keeps reruns identical. */
  tableSeed: string;
}

/** The command line is not valid; the message says what to fix. */
export class LoadSeedUsageError extends Error {
  override name = 'LoadSeedUsageError';
}

/** The environment refuses the seed: production mode, another database, a missing setting. */
export class LoadSeedRefusedError extends Error {
  override name = 'LoadSeedRefusedError';
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`seed:load refused:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.issues = issues;
  }
}

/** The default `--table-seed`: fixed, so the load stack's tables are the same on every seed. */
export const DEFAULT_TABLE_SEED = 'openverify-load-phase11';

export function parseLoadSeedArgs(argv: readonly string[]): LoadSeedArgs {
  const values = new Map<string, string>();
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === '--json') {
      json = true;
      continue;
    }
    const equals = arg.indexOf('=');
    const name = equals === -1 ? arg : arg.slice(0, equals);
    const inline = equals === -1 ? undefined : arg.slice(equals + 1);
    if (!['--scale', '--step', '--part', '--secrets-file', '--table-seed'].includes(name)) {
      throw new LoadSeedUsageError(`Unknown argument ${arg}. ${USAGE}`);
    }
    const value = inline ?? argv[(i += 1)];
    if (value === undefined || value === '') {
      throw new LoadSeedUsageError(`${name} needs a value. ${USAGE}`);
    }
    values.set(name, value);
  }
  const scale = values.get('--scale');
  if (!(LOAD_SCALES as readonly string[]).includes(scale ?? '')) {
    throw new LoadSeedUsageError(`--scale is one of ${LOAD_SCALES.join(', ')}. ${USAGE}`);
  }
  const step = values.get('--step');
  if (!(LOAD_STEPS as readonly string[]).includes(step ?? '')) {
    throw new LoadSeedUsageError(`--step is one of ${LOAD_STEPS.join(', ')}. ${USAGE}`);
  }
  const partText = values.get('--part');
  const part = partText === undefined ? undefined : Number(partText);
  if (part !== undefined && (!Number.isInteger(part) || part < 0 || part > 1000)) {
    throw new LoadSeedUsageError(`--part is a whole number from 0. ${USAGE}`);
  }
  const tableSeed = values.get('--table-seed') ?? DEFAULT_TABLE_SEED;
  if (!/^[A-Za-z0-9-]{1,64}$/u.test(tableSeed)) {
    throw new LoadSeedUsageError('--table-seed is 1 to 64 letters, digits or dashes.');
  }
  return {
    scale: scale as LoadScale,
    step: step as LoadStep,
    part,
    secretsFile: values.get('--secrets-file') ?? DEFAULT_SECRETS_FILE,
    json,
    tableSeed,
  };
}

export interface LoadSeedSettings {
  databaseUrl: string;
  pepper: Uint8Array;
  blindIndexKey: Uint8Array;
  keyring: Keyring;
  watchlistSourcesDisabled: readonly string[];
}

const MIN_PEPPER_LENGTH = 32;

/** The database name of a postgres:// URL, or `null`. */
export function databaseNameOf(url: string): string | null {
  const parsed = safeUrl(url);
  if (parsed === null || (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:')) {
    return null;
  }
  return decodeURIComponent(parsed.pathname.replace(/^\//u, '')) || null;
}

/**
 * Reads what seed:load needs from the environment `migrationRoleEnv` resolved (the migration
 * role's `DATABASE_URL`). Messages name variables, never their values.
 * @throws {LoadSeedRefusedError} in production mode, for a database not named `openverify_load`, or
 * for a missing or invalid setting.
 */
export function loadSeedSettingsFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): LoadSeedSettings {
  const issues: string[] = [];
  const mode = env.OPENVERIFY_MODE?.trim() ?? '';
  if (mode === '' && defaultAppMode(env.NODE_ENV) === 'production') {
    issues.push('NODE_ENV: seed:load does not run in production mode (OPENVERIFY_MODE is not set)');
  } else if (mode === 'production') {
    issues.push('OPENVERIFY_MODE: seed:load does not run in production mode');
  } else if (mode !== '' && !(APP_MODES as readonly string[]).includes(mode)) {
    issues.push(`OPENVERIFY_MODE: must be one of ${APP_MODES.join(', ')}`);
  }
  const databaseUrl = env.DATABASE_URL?.trim() ?? '';
  const name = databaseNameOf(databaseUrl);
  if (databaseUrl === '') {
    issues.push('DATABASE_URL (or OPENVERIFY_MIGRATION_DATABASE_URL): is required');
  } else if (name === null) {
    issues.push('DATABASE_URL: must be a postgres:// URL');
  } else if (name !== LOAD_DATABASE) {
    issues.push(`DATABASE_URL: seed:load writes only to a database named ${LOAD_DATABASE}`);
  }
  const pepper = env.OPENVERIFY_API_KEY_PEPPER?.trim() ?? '';
  if (pepper.length < MIN_PEPPER_LENGTH) {
    issues.push(
      `OPENVERIFY_API_KEY_PEPPER: must be at least ${String(MIN_PEPPER_LENGTH)} characters`,
    );
  }
  let blindIndexKey: Uint8Array = new Uint8Array();
  try {
    blindIndexKey = parseBlindIndexKey(env.OPENVERIFY_BLIND_INDEX_KEY);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : 'OPENVERIFY_BLIND_INDEX_KEY: is invalid');
  }
  let keyring: Keyring | undefined;
  try {
    keyring = keyringFromEnv({
      [KEK_ENV]: env[KEK_ENV],
      [KEK_PREVIOUS_ENV]: env[KEK_PREVIOUS_ENV],
    });
  } catch (error) {
    if (!(error instanceof KeyringError)) {
      throw error;
    }
    issues.push(error.message);
  }
  const sources = parseWatchlistSourcesDisabled(env);
  issues.push(...sources.issues);
  issues.push(...parseNetworkSourceLists(env).issues);
  if (issues.length > 0 || keyring === undefined) {
    throw new LoadSeedRefusedError(issues);
  }
  return {
    databaseUrl,
    pepper: new TextEncoder().encode(pepper),
    blindIndexKey,
    keyring,
    watchlistSourcesDisabled: sources.value,
  };
}

/**
 * The database's own answer: seed:load refuses a connection whose current database is not
 * `openverify_load`, whatever the URL said (a pooler or a service file could map it elsewhere).
 */
export async function assertLoadDatabase(db: Db): Promise<void> {
  const result: unknown = await db.execute(sql`select current_database() as name`);
  const { rows } = result as { rows: { name: string }[] };
  if (rows[0]?.name !== LOAD_DATABASE) {
    throw new LoadSeedRefusedError([
      `the connected database is not ${LOAD_DATABASE}: seed:load writes to no other`,
    ]);
  }
}

export interface LoadSeedOptions {
  db: Db;
  /** The pool under `db`: the watchlist sync opens its own session on it. */
  pool: Pool;
  settings: LoadSeedSettings;
  args: LoadSeedArgs;
  files: LoadSeedFiles;
  ids: IdGenerator;
  clock: Clock;
  /** The repository root (the watchlist tables read its data files). */
  repositoryRoot: string;
  /** Progress lines (stderr), counts and ids only. */
  out: (line: string) => void;
}

export interface LoadSeedRun {
  step: LoadStep;
  part: number | undefined;
  skipped: boolean;
  result: LoadStepResult;
}

/** Runs one step (or one part of one), reading and writing the record. */
export async function runLoadSeed(options: LoadSeedOptions): Promise<LoadSeedRun> {
  const { args, files } = options;
  await assertLoadDatabase(options.db);
  const record: LoadSeedRecord =
    (await readRecord(files, args.secretsFile)) ?? emptyRecord(args.scale);
  if (record.scale !== args.scale) {
    throw new LoadSeedUsageError(
      `the record was seeded at --scale ${record.scale}; start a new load stack for another scale`,
    );
  }
  const marker = args.part === undefined ? args.step : `${args.step}:${String(args.part)}`;
  if (record.done.includes(marker) || record.done.includes(args.step)) {
    return { step: args.step, part: args.part, skipped: true, result: { counts: {}, parts: 0 } };
  }
  const context: LoadStepContext = { ...options, record };
  const result = await runLoadStep(context, args.step, args.part);
  if (result.complete !== false) {
    record.done.push(marker);
  }
  await writeRecord(files, args.secretsFile, record);
  return { step: args.step, part: args.part, skipped: false, result };
}

/** The run as one terminal line or JSON: counts and ids only, never a secret. */
export function formatLoadSeedRun(run: LoadSeedRun, json: boolean): string {
  const summary = {
    step: run.step,
    part: run.part ?? null,
    skipped: run.skipped,
    parts: run.result.parts,
    counts: run.result.counts,
  };
  if (json) {
    return `${JSON.stringify(summary)}\n`;
  }
  const counts = Object.entries(run.result.counts)
    .map(([name, count]) => `${name} ${String(count)}`)
    .join(', ');
  return run.skipped
    ? `seed:load ${run.step}${run.part === undefined ? '' : ` part ${String(run.part)}`}: already done, skipped\n`
    : `seed:load ${run.step}${run.part === undefined ? '' : ` part ${String(run.part)}`}: ${counts || 'nothing to do'}${run.result.parts > 1 ? ` (${String(run.result.parts)} parts)` : ''}\n`;
}
