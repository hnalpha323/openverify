/**
 * C268.3 (Workflow 11D load-harness): seed:load's arguments, its refusals (production mode, another
 * database), its counts at both scales, its record (a mode-0600 file under /tmp, replaced
 * atomically) and the generators whose values the load scenarios mirror. The database steps run in
 * `load-seed.integration.test.ts`. Every value is synthetic.
 */
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SECRETS_FILE,
  DEFAULT_TABLE_SEED,
  LOAD_DATABASE,
  LoadSeedRefusedError,
  LoadSeedUsageError,
  databaseNameOf,
  formatLoadSeedRun,
  loadSeedSettingsFromEnv,
  parseLoadSeedArgs,
} from './load-seed.js';
import { KEY_POOLS, countsFor, partsOf, scaled, LOAD_ORGANISATIONS } from './load/counts.js';
import { itemAttributes, transactionFields, LOAD_COUNTRIES } from './load/lists.js';
import {
  LOAD_SEED_SCHEMA,
  LoadSeedRecordError,
  addIds,
  addKeys,
  emptyRecord,
  environmentOf,
  readRecord,
  writeRecord,
} from './load/record.js';
import { nodeFiles } from './load/files.test-support.js';
import { inquiryPools, loadTemplate, sliceOfPools, userAddress } from './load/steps.js';
import {
  allowsMassRemoval,
  normalisedImport,
  watchlistPartOf,
  watchlistParts,
  loadWatchlistManifest,
  LOAD_WATCHLIST_SOURCE,
} from './load/watchlists.js';

const KEK = randomBytes(32).toString('base64');
const goodEnv = (overrides: Record<string, string | undefined> = {}) => ({
  OPENVERIFY_MODE: 'development',
  DATABASE_URL: `postgres://openverify:synthetic-password@127.0.0.1:25432/${LOAD_DATABASE}`,
  OPENVERIFY_API_KEY_PEPPER: 'synthetic-pepper-of-at-least-thirty-two-chars',
  OPENVERIFY_BLIND_INDEX_KEY: randomBytes(32).toString('base64'),
  OPENVERIFY_KEK: KEK,
  ...overrides,
});

describe('seed:load arguments', () => {
  it('reads the scale, the step, the part and the secrets file', () => {
    expect(parseLoadSeedArgs(['--scale', 'small', '--step', 'organisations'])).toEqual({
      scale: 'small',
      step: 'organisations',
      part: undefined,
      secretsFile: DEFAULT_SECRETS_FILE,
      json: false,
      tableSeed: DEFAULT_TABLE_SEED,
    });
    expect(
      parseLoadSeedArgs([
        '--scale=reference',
        '--step=inquiries',
        '--part',
        '3',
        '--secrets-file',
        '/tmp/x/seed.json',
        '--json',
        '--table-seed',
        'abc123',
      ]),
    ).toMatchObject({
      scale: 'reference',
      step: 'inquiries',
      part: 3,
      json: true,
      tableSeed: 'abc123',
    });
  });

  it.each([
    [['--scale', 'huge', '--step', 'verify'], /--scale is one of small, reference/],
    [['--scale', 'small', '--step', 'nothing'], /--step is one of/],
    [['--scale', 'small', '--step', 'verify', '--part', '-1'], /--part is a whole number/],
    [['--scale', 'small', '--step', 'verify', '--part', '1.5'], /--part is a whole number/],
    [['--scale', 'small', '--step', 'verify', '--force'], /Unknown argument --force/],
    [['--scale'], /--scale needs a value/],
    [['--scale', 'small', '--step', 'verify', '--table-seed', 'not/ok'], /--table-seed/],
  ])('refuses %j', (argv, message) => {
    expect(() => parseLoadSeedArgs(argv)).toThrow(LoadSeedUsageError);
    expect(() => parseLoadSeedArgs(argv)).toThrow(message);
  });
});

describe('seed:load refuses production and any other database (C268.3)', () => {
  it('accepts the load stack development settings', () => {
    const settings = loadSeedSettingsFromEnv(goodEnv());
    expect(settings.databaseUrl).toContain(LOAD_DATABASE);
    expect(settings.blindIndexKey).toHaveLength(32);
    expect(settings.pepper.length).toBeGreaterThanOrEqual(32);
  });

  it.each([
    [
      { OPENVERIFY_MODE: 'production' },
      'OPENVERIFY_MODE: seed:load does not run in production mode',
    ],
    [
      { OPENVERIFY_MODE: undefined, NODE_ENV: 'production' },
      'NODE_ENV: seed:load does not run in production mode',
    ],
    [{ OPENVERIFY_MODE: 'staging' }, 'OPENVERIFY_MODE: must be one of'],
    [
      { DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/openverify' },
      `writes only to a database named ${LOAD_DATABASE}`,
    ],
    [
      { DATABASE_URL: 'mysql://u:p@127.0.0.1/openverify_load' },
      'DATABASE_URL: must be a postgres:// URL',
    ],
    [
      { DATABASE_URL: undefined },
      'DATABASE_URL (or OPENVERIFY_MIGRATION_DATABASE_URL): is required',
    ],
    [
      { OPENVERIFY_API_KEY_PEPPER: 'short' },
      'OPENVERIFY_API_KEY_PEPPER: must be at least 32 characters',
    ],
    [{ OPENVERIFY_BLIND_INDEX_KEY: 'not-base64' }, 'OPENVERIFY_BLIND_INDEX_KEY'],
    [{ OPENVERIFY_KEK: undefined }, 'OPENVERIFY_KEK'],
  ])('refuses %j', (overrides, issue) => {
    let error: unknown;
    try {
      loadSeedSettingsFromEnv(goodEnv(overrides));
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(LoadSeedRefusedError);
    expect((error as LoadSeedRefusedError).issues.join('\n')).toContain(issue);
    // A refusal names variables, never their values.
    expect((error as Error).message).not.toContain('synthetic-password');
  });

  it('reads a database name from a URL', () => {
    expect(databaseNameOf('postgresql://h/openverify_load?sslmode=disable')).toBe(
      'openverify_load',
    );
    expect(databaseNameOf('postgres://h/')).toBeNull();
    expect(databaseNameOf('not a url')).toBeNull();
  });
});

describe('the counts (Stage 1a amendment 10)', () => {
  it('holds the method spread table at the reference scale', () => {
    const counts = countsFor('reference');
    expect(counts.users).toBe(4000);
    expect(counts.flowInquiries).toBe(40_000);
    expect(counts.listItems.name).toBe(100_000);
    expect(counts.transactions).toBe(200_000);
    expect(Object.fromEntries(KEY_POOLS.map((pool) => [pool.pool, pool.count]))).toMatchObject({
      'api-reads': 160,
      'api-writes': 80,
      flow: 16,
      'connect-destination': 20,
      'lists-match': 40,
      graph: 16,
      'transactions-search': 160,
    });
    expect(LOAD_ORGANISATIONS).toHaveLength(18);
  });

  it('divides every count by 100 at the small scale, at least 2', () => {
    const counts = countsFor('small');
    expect(counts.users).toBe(40);
    expect(counts.accounts).toBe(200);
    expect(counts.exportAccounts).toBe(2);
    expect(counts.listItems.country).toBe(2);
    expect(scaled(1, 'small')).toBe(2);
    expect(scaled(160, 'small')).toBe(2);
    expect(scaled(160, 'reference')).toBe(160);
  });

  it('splits a large step into parts of at most 50,000 rows', () => {
    expect(partsOf(1)).toBe(1);
    expect(partsOf(50_000)).toBe(1);
    expect(partsOf(200_000)).toBe(4);
  });
});

describe('the record (a mode-0600 file under /tmp)', () => {
  const made: string[] = [];
  afterEach(async () => {
    await Promise.all(made.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });
  const directory = async () => {
    const path = await mkdtemp(join('/tmp', 'openverify-load-seed-test-'));
    made.push(path);
    return path;
  };

  it('is written at mode 0600, replaced atomically and read back', async () => {
    const path = join(await directory(), 'seed.json');
    expect(await readRecord(nodeFiles, path)).toBeNull();
    const record = emptyRecord('small');
    addKeys(record, 'api-reads', [
      { token: 'ov_sandbox_synthetic', environment: 'load-a sandbox' },
    ]);
    addIds(record, 'accounts', ['acc_a']);
    addIds(record, 'accounts', ['acc_b']);
    await writeRecord(nodeFiles, path, record);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    record.done.push('organisations');
    await writeRecord(nodeFiles, path, record);
    const back = await readRecord(nodeFiles, path);
    expect(back).toMatchObject({
      schema: LOAD_SEED_SCHEMA,
      scale: 'small',
      done: ['organisations'],
    });
    expect(back?.ids.accounts).toEqual(['acc_a', 'acc_b']);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it('refuses a file others may read, another schema, a path outside /tmp or a relative one', async () => {
    const path = join(await directory(), 'seed.json');
    await writeFile(path, JSON.stringify(emptyRecord('small')), { mode: 0o644 });
    await expect(readRecord(nodeFiles, path)).rejects.toThrow('mode 0600');
    const other = join(await directory(), 'other.json');
    await writeFile(other, '{"schema":"something-else"}', { mode: 0o600 });
    await expect(readRecord(nodeFiles, other)).rejects.toThrow(
      'does not hold a openverify/load-seed@1',
    );
    await expect(readRecord(nodeFiles, join(process.cwd(), 'seed.json'))).rejects.toThrow(
      LoadSeedRecordError,
    );
    await expect(readRecord(nodeFiles, 'relative/seed.json')).rejects.toThrow(
      'absolute path under /tmp',
    );
    await expect(
      readRecord(nodeFiles, '/tmp/no-such-directory-of-the-load/seed.json'),
    ).rejects.toThrow('existing directory under /tmp');
    const folder = join(await directory(), 'folder.json');
    await mkdir(folder);
    await expect(readRecord(nodeFiles, folder)).rejects.toThrow('regular file');
  });

  it('names the step to run first for a missing environment', () => {
    expect(() => environmentOf(emptyRecord('small'), 'load-a sandbox')).toThrow(
      '--step organisations',
    );
  });
});

describe('the run summary prints counts, never a secret', () => {
  it('formats a run as a line or JSON', () => {
    const run = {
      step: 'principals' as const,
      part: undefined,
      skipped: false,
      result: { counts: { keys: 32 }, parts: 1 },
    };
    expect(formatLoadSeedRun(run, false)).toBe('seed:load principals: keys 32\n');
    expect(JSON.parse(formatLoadSeedRun(run, true))).toEqual({
      step: 'principals',
      part: null,
      skipped: false,
      parts: 1,
      counts: { keys: 32 },
    });
    expect(formatLoadSeedRun({ ...run, part: 2, skipped: true }, false)).toBe(
      'seed:load principals part 2: already done, skipped\n',
    );
    expect(formatLoadSeedRun({ ...run, result: { counts: {}, parts: 4 } }, false)).toBe(
      'seed:load principals: nothing to do (4 parts)\n',
    );
  });
});

describe('the generators the scenarios mirror (load/scenarios/)', () => {
  it('writes synthetic list values only', () => {
    expect(itemAttributes('email-address', 7)).toEqual({ value: 'listed-7@example.com' });
    expect(itemAttributes('phone-number', 12_345)).toEqual({ value: '+61491572345' });
    expect(itemAttributes('name', 1000)).toEqual({
      'name-first': 'Loadfirst3',
      'name-last': 'Loadlast1000',
    });
    expect(itemAttributes('ip-address', 255)).toEqual({ value: '2001:db8:4d00::ff' });
    expect(itemAttributes('country', 21)).toEqual({ 'country-code': LOAD_COUNTRIES[1] });
    expect(() => itemAttributes('face', 1)).toThrow('writes no face list');
  });

  it('writes the transaction fields load/scenarios/transactions_write.py searches for', () => {
    expect(transactionFields(50_001)).toEqual({
      payer_email: 'payer-1@example.com',
      card_fingerprint: 'fp00000000010001',
      merchant_id: 'merchant-1',
    });
  });

  it('gives each console user one documentation address', () => {
    expect(userAddress(0)).toBe('2001:db8:4c00::1');
    expect(userAddress(3999)).toBe('2001:db8:4c00::fa0');
  });

  it('shows Play Integrity notice in the load template consent', async () => {
    const template = await loadTemplate();
    const consent = template.flow.steps.find((step) => step.type === 'consent');
    expect(consent?.type === 'consent' && consent.textKeys).toContain('notice.play-integrity');
  });

  it('splits the inquiry pools into parts', () => {
    const record = emptyRecord('small');
    addIds(record, 'accounts', ['acc_1']);
    addIds(record, 'export-accounts:load-s05 sandbox', ['acc_x', 'acc_y']);
    const pools = inquiryPools(record, 'small');
    expect(pools.map((pool) => [pool.name, pool.count]).slice(0, 6)).toEqual([
      ['settled-inquiries', 500],
      ['review-inquiries', 600],
      ['write-inquiries', 100],
      ['flow-inquiries', 400],
      ['verification-inquiries', 60],
      ['connect-source-inquiries', 2],
    ]);
    expect(pools.find((pool) => pool.name === 'export-inquiries:load-s05 sandbox')?.count).toBe(4);
    expect(
      sliceOfPools(pools, 450, 1150).map((slice) => [slice.pool.name, slice.from, slice.to]),
    ).toEqual([
      ['settled-inquiries', 450, 500],
      ['review-inquiries', 0, 600],
      ['write-inquiries', 0, 50],
    ]);
  });

  it('plans the watchlist tables: 100,000 names, then the 2,000,000-name table in 8 parts', () => {
    expect(watchlistParts('small')).toBe(1);
    expect(watchlistParts('reference')).toBe(9);
    expect(watchlistPartOf(1)).toEqual({ table: '100k', names: 100_000 });
    expect(watchlistPartOf(2)).toEqual({ table: '2m', names: 250_000 });
    expect(watchlistPartOf(9)).toEqual({ table: '2m', names: 2_000_000 });
    const source = loadWatchlistManifest().sources.find(
      (entry) => entry.id === LOAD_WATCHLIST_SOURCE,
    );
    expect(source?.max_bytes).toEqual({ compressed: 2 ** 31, inflated: 2 ** 31 });
  });

  it('lets only part 2 remove the 100,000-name table, the switch to the 2,000,000-name one', () => {
    expect(allowsMassRemoval(2)).toBe(true);
    for (const part of [1, 3, 4, 5, 6, 7, 8, 9]) {
      expect(allowsMassRemoval(part)).toBe(false);
    }
  });

  it('writes a normalised import as chunks of one JSON document', () => {
    const records = [{ entry_id: 'BS-1' }, { entry_id: 'BS-2' }] as never[];
    const text = [
      ...normalisedImport('openverify-sandbox', '2026-10-01T00:00:00.000Z', records),
    ].join('');
    expect(JSON.parse(text)).toEqual({
      source: 'openverify-sandbox',
      published_at: '2026-10-01T00:00:00.000Z',
      entries: [{ entry_id: 'BS-1' }, { entry_id: 'BS-2' }],
    });
    expect(JSON.parse([...normalisedImport('s', 'p', [])].join(''))).toEqual({
      source: 's',
      published_at: 'p',
      entries: [],
    });
  });
});
