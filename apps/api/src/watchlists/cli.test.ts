/**
 * C76.2, C78.3, C80.1: the command lines of `watchlists:sync`, `watchlists:rekey` and `pep:sync`
 * over PGlite, with the committed synthetic sandbox list and a synthetic Wikidata answer document
 * (fictional `Q-test-` items). No list client is given, so a download fails without touching the
 * network.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getWatchlistSourceStates, updateEnvironmentSettings } from '@openverify/db';
import {
  createTestDatabase,
  createTestTenant,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { PEP_IMPORT_FORMAT, keysVersion, variantGroupsFrom } from '@openverify/watchlist';
import { FIXTURES_DIRECTORY } from '@openverify/watchlist/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WatchlistSettings } from '../config.js';
import {
  WatchlistCliUsageError,
  parsePepSyncArgs,
  parseWatchlistsRekeyArgs,
  parseWatchlistsSyncArgs,
  runPepSync,
  runWatchlistsRekey,
  runWatchlistsSync,
  watchlistCliExitCode,
  type WatchlistCliRuntime,
  type WatchlistsSyncArgs,
} from './cli.js';
import type { MatcherData } from './matcher-data.js';
import { sharedWatchlistSession } from './sync.js';

let database: TestDatabase;
let files: string;
const NOW = new Date('2026-10-27T12:00:00.000Z');
const matcher = (sha: string): MatcherData => ({
  status: 'loaded',
  groups: variantGroupsFrom([], sha),
  keysVersion: keysVersion(sha),
});
const SETTINGS: WatchlistSettings = {
  sourcesDisabled: [],
  refresh: false,
  removedRetentionDays: 90,
  euFsfToken: null,
  wikidataUserAgent: null,
  wikidataSparqlUrl: 'https://query.wikidata.org/sparql',
  pep: {
    openTenureMaxYears: 20,
    includeRelatives: false,
    retentionMonths: 12,
    headRetentionMonths: 60,
  },
};
const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };
let lines: string[] = [];

function runtime(overrides: Partial<WatchlistCliRuntime> = {}): WatchlistCliRuntime {
  return {
    db: database.db,
    connect: sharedWatchlistSession(database.db),
    clock: { now: () => NOW },
    logger: silent,
    settings: SETTINGS,
    matcherData: () => matcher('a'.repeat(64)),
    out: (line) => lines.push(line),
    ...overrides,
  };
}

const SYNC_DEFAULTS: WatchlistsSyncArgs = {
  source: null,
  importPath: null,
  allowMassRemoval: false,
  acceptOlderPublication: false,
  allowNormalised: false,
  json: false,
};
const sandboxFile = fileURLToPath(new URL('openverify-sandbox.json', FIXTURES_DIRECTORY));

beforeAll(async () => {
  database = await createTestDatabase();
  files = await mkdtemp(join(tmpdir(), 'openverify-cli-test-'));
}, 60_000);

afterAll(async () => {
  await database.close();
  await rm(files, { recursive: true, force: true });
});

describe('parseWatchlistsSyncArgs', () => {
  it('syncs every enabled source by default', () => {
    expect(parseWatchlistsSyncArgs([])).toEqual(SYNC_DEFAULTS);
  });

  it('reads --source, --import, the three overrides and --json, with = or a separate value', () => {
    expect(
      parseWatchlistsSyncArgs([
        '--import',
        'list.json',
        '--source=openverify-sandbox',
        '--allow-mass-removal',
        '--accept-older-publication',
        '--allow-normalised',
        '--json',
      ]),
    ).toEqual({
      source: 'openverify-sandbox',
      importPath: 'list.json',
      allowMassRemoval: true,
      acceptOlderPublication: true,
      allowNormalised: true,
      json: true,
    });
  });

  it('refuses --import without --source, an unknown flag, a missing value and a malformed id', () => {
    expect(() => parseWatchlistsSyncArgs(['--import', 'list.json'])).toThrow(
      /--import needs --source/,
    );
    expect(() => parseWatchlistsSyncArgs(['--force'])).toThrow(WatchlistCliUsageError);
    expect(() => parseWatchlistsSyncArgs(['--force'])).toThrow(/Unknown argument --force/);
    expect(() => parseWatchlistsSyncArgs(['--source'])).toThrow(/--source needs a value/);
    expect(() => parseWatchlistsSyncArgs(['--source', 'UK List'])).toThrow(/manifest source id/);
  });
});

describe('parseWatchlistsRekeyArgs and parsePepSyncArgs', () => {
  it('re-keys every source or one, and refuses an import', () => {
    expect(parseWatchlistsRekeyArgs([])).toEqual({ source: null, json: false });
    expect(parseWatchlistsRekeyArgs(['--source', 'ofac-sdn', '--json'])).toEqual({
      source: 'ofac-sdn',
      json: true,
    });
    expect(() => parseWatchlistsRekeyArgs(['--import', 'x'])).toThrow(/Unknown argument --import/);
  });

  it('syncs wikidata-pep live or from an --import, and refuses --source', () => {
    expect(parsePepSyncArgs([])).toEqual({ importPath: null, json: false });
    expect(parsePepSyncArgs(['--import=answers.json', '--json'])).toEqual({
      importPath: 'answers.json',
      json: true,
    });
    expect(() => parsePepSyncArgs(['--source', 'ofac-sdn'])).toThrow(/Unknown argument --source/);
  });
});

describe('runWatchlistsSync (C76.2, C76.5)', () => {
  it('reconciles the sources first, imports the sandbox list and prints counts, never a name', async () => {
    await database.db.execute(sql`truncate watchlist_sources cascade`);
    lines = [];

    const results = await runWatchlistsSync(
      { ...SYNC_DEFAULTS, source: 'openverify-sandbox', importPath: sandboxFile },
      runtime(),
    );

    expect(results.map((result) => result.outcome)).toEqual(['applied']);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^openverify-sandbox: applied \(sync \d+\), entries 69, added 69, changed 0, removed 0, re-screen pending$/,
    );
    expect(lines.join('\n')).not.toMatch(/Avery|Quillfeather|Sandbox Sanctioned/);
    expect(watchlistCliExitCode(results)).toBe(0);
  });

  it('prints one JSON line a source with --json, and an unchanged file exits 0', async () => {
    lines = [];

    const results = await runWatchlistsSync(
      { ...SYNC_DEFAULTS, source: 'openverify-sandbox', importPath: sandboxFile, json: true },
      runtime(),
    );

    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      sourceId: 'openverify-sandbox',
      outcome: 'unchanged',
      entryCount: 0,
    });
    expect(watchlistCliExitCode(results)).toBe(0);
  });

  it('syncs every enabled source that downloads, and exits 1 when one could not sync', async () => {
    lines = [];

    const results = await runWatchlistsSync(SYNC_DEFAULTS, runtime());

    expect(results.map((result) => [result.sourceId, result.outcome, result.errorCode])).toEqual([
      ['ofac-sdn', 'error', 'download_failed'],
      ['ofac-consolidated', 'error', 'download_failed'],
      ['eu-fsf', 'error', 'source_not_configured'],
      ['uk-sanctions-list', 'error', 'download_failed'],
      ['wikidata-pep', 'error', 'source_not_configured'],
    ]);
    expect(lines[2]).toBe(
      'eu-fsf: error (sync ' +
        String(results[2]?.syncId) +
        '), entries 0, added 0, changed 0, removed 0, code source_not_configured',
    );
    expect(watchlistCliExitCode(results)).toBe(1);
  });

  it('refuses a source the manifest does not name, and an import-only source without --import', async () => {
    await expect(
      runWatchlistsSync({ ...SYNC_DEFAULTS, source: 'ofsi-consolidated' }, runtime()),
    ).rejects.toThrow(/not a source of watchlists\/sources.json/);
    await expect(
      runWatchlistsSync({ ...SYNC_DEFAULTS, source: 'openverify-sandbox' }, runtime()),
    ).rejects.toThrow(WatchlistCliUsageError);
  });
});

describe('runWatchlistsRekey (C78.3)', () => {
  it('re-keys every source that holds keys with this matcher version', async () => {
    lines = [];
    const other = matcher('b'.repeat(64));

    const results = await runWatchlistsRekey(
      { source: null, json: false },
      runtime({ matcherData: () => other }),
    );

    expect(results.map((result) => [result.sourceId, result.outcome])).toEqual([
      ['openverify-sandbox', 'rekeyed'],
    ]);
    expect(lines[0]).toMatch(/^openverify-sandbox: rekeyed \(sync \d+\), entries 69$/);
    const [state] = await getWatchlistSourceStates(database.db, ['openverify-sandbox']);
    expect(state?.keysVersion).toBe(keysVersion('b'.repeat(64)));
    expect(watchlistCliExitCode(results)).toBe(0);
  });

  it('is refused without the matcher data, and exits 1', async () => {
    lines = [];

    const results = await runWatchlistsRekey(
      { source: 'openverify-sandbox', json: true },
      runtime({ matcherData: () => ({ status: 'missing' }) }),
    );

    expect(results[0]?.outcome).toBe('refused_matcher_data');
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({ outcome: 'refused_matcher_data' });
    expect(watchlistCliExitCode(results)).toBe(1);
    await expect(runWatchlistsRekey({ source: 'nowhere', json: false }, runtime())).rejects.toThrow(
      WatchlistCliUsageError,
    );
  });
});

describe('runPepSync (C80.1)', () => {
  const entity = (qid: string) => ({ type: 'uri', value: `http://www.wikidata.org/entity/${qid}` });
  const literal = (value: string, lang?: string) => ({
    type: 'literal',
    value,
    ...(lang === undefined ? {} : { 'xml:lang': lang }),
  });
  const time = (date: string) => ({
    type: 'literal',
    value: `${date}T00:00:00Z`,
    datatype: 'http://www.w3.org/2001/XMLSchema#dateTime',
  });
  const results = (bindings: unknown[]) => ({ head: { vars: [] }, results: { bindings } });
  const precision = {
    type: 'literal',
    value: '11',
    datatype: 'http://www.w3.org/2001/XMLSchema#integer',
  };

  it('imports a recorded answer document into wikidata-pep without a User-Agent', async () => {
    const path = join(files, 'answers.json');
    await writeFile(
      path,
      JSON.stringify({
        format: PEP_IMPORT_FORMAT,
        positions: {
          Q2285706: results([
            {
              statement: { type: 'uri', value: 'http://www.wikidata.org/entity/statement/s-1' },
              person: entity('Q-test-1001'),
              position: entity('Q-test-2001'),
              positionLabel: literal('Prime Minister of Synthetica', 'en'),
              start: time('2023-05-01'),
              startPrecision: precision,
              jurisdiction: literal('GB'),
            },
          ]),
        },
        persons: results([
          {
            person: entity('Q-test-1001'),
            fact: literal('label'),
            value: literal('Marlowe Testerton', 'en'),
          },
        ]),
      }),
    );
    lines = [];

    const synced = await runPepSync({ importPath: path, json: false }, runtime());

    expect(synced.map((result) => [result.sourceId, result.outcome])).toEqual([
      ['wikidata-pep', 'applied'],
    ]);
    expect(lines[0]).toMatch(/^wikidata-pep: applied/);
    expect(lines.join('\n')).not.toMatch(/Marlowe|Testerton/);
  });

  it('does not query the service without the operator’s User-Agent', async () => {
    const synced = await runPepSync({ importPath: null, json: false }, runtime());

    expect(synced[0]).toMatchObject({ outcome: 'error', errorCode: 'source_not_configured' });
    expect(watchlistCliExitCode(synced)).toBe(1);
  });
});

describe('watchlistCliExitCode', () => {
  it('is 0 for nothing to do and 1 for a busy source', () => {
    expect(watchlistCliExitCode([])).toBe(0);
    expect(
      watchlistCliExitCode([{ sourceId: 'ofac-sdn', outcome: 'busy', syncId: 1, entries: 0 }]),
    ).toBe(1);
  });
});

describe('the CLI reconcile and the UN opt-in (C254.1, Q10 granted; KP11-31)', () => {
  it('keeps un-sc enabled for an environment that opted in, only while the install allows it', async () => {
    const { environment } = await createTestTenant(database.db);
    await updateEnvironmentSettings(database.db, environment.id, {
      'watchlist-un-opt-in': {
        'source-id': 'un-sc',
        'terms-url': 'https://www.un.org/en/about-us/terms-of-use',
        'accepted-at': NOW.toISOString(),
        'accepted-by': testId('usr'),
      },
    });
    const sync = () =>
      runWatchlistsSync(
        { ...SYNC_DEFAULTS, source: 'openverify-sandbox', importPath: sandboxFile },
        runtime({ settings: { ...SETTINGS, unOptInAllowed: allowed } }),
      );
    let allowed = true;
    try {
      lines = [];
      await sync();
      expect((await getWatchlistSourceStates(database.db, ['un-sc']))[0]?.enabled).toBe(true);
      allowed = false;
      await sync();
      expect((await getWatchlistSourceStates(database.db, ['un-sc']))[0]?.enabled).toBe(false);
    } finally {
      await updateEnvironmentSettings(database.db, environment.id, { 'watchlist-un-opt-in': null });
    }
  });
});
