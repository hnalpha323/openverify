/**
 * C268.3 (Workflow 11D load-harness): the load stack's watchlist tables, Phase 6's heavy-headed
 * tables from `@openverify/watchlist/testing` (never held-out), imported through the sync itself as
 * the sandbox source `openverify-sandbox`, which the seeded sandbox watchlist templates search:
 *
 * - part 1: the 100,000-name table (the sanctions profile, C78.7's), at both scales;
 * - parts 2 to 9 (the reference scale only): the 2,000,000-name table (the PEP profile), part k a
 *   full publication of (k - 1) / 8 of it, as the matcher benchmark imports it, so each call fits
 *   ten minutes. The table a sandbox screening meets is the last part imported: the calibration
 *   measures the 100,000-name rows before part 2.
 *
 * The normalised import file is written to a private directory under `/tmp` and removed after the
 * sync. The screening names (listed and unlisted subjects of the 100,000-name table) go to the
 * record for `screening-throughput` and the fairness scenario.
 */
import type { WatchlistRecord } from '@openverify/watchlist';
import {
  TABLE_PROFILES,
  heavyHeadedEntries,
  heavyHeadedPool,
  heavyHeadedSubjects,
  parseRigourPersonNames,
  RIGOUR_PERSON_NAMES_ENTRY,
  syntheticEntries,
} from '@openverify/watchlist/testing';
import { join } from 'node:path';
import type { WatchlistSettings } from '../../config.js';
import { loadMatcherData } from '../../watchlists/matcher-data.js';
import { watchlistManifest, type WatchlistManifest } from '../../watchlists/manifest.js';
import { poolWatchlistSessions } from '../../watchlists/sync-session.js';
import { syncWatchlistSource } from '../../watchlists/sync.js';
import { countsFor, WATCHLIST_TABLES, type LoadScale } from './counts.js';
import { addIds } from './record.js';
import type { LoadStepContext, LoadStepResult } from './steps.js';

/** The sandbox source the seeded sandbox templates search (C76.6, the benchmark's too). */
export const LOAD_WATCHLIST_SOURCE = 'openverify-sandbox';
/** The import's size cap for the load's tables (the committed one is a sandbox list's). */
const LOAD_CAP_BYTES = 2 ** 31;
const PUBLISHED_BASE = Date.parse('2026-10-01T00:00:00.000Z');

export const LOAD_WATCHLIST_SETTINGS: WatchlistSettings = {
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

/** The committed manifest with the load source's caps raised to hold the tables. */
export function loadWatchlistManifest(): WatchlistManifest {
  const committed = watchlistManifest();
  return {
    ...committed,
    sources: committed.sources.map((source) =>
      source.id === LOAD_WATCHLIST_SOURCE
        ? { ...source, max_bytes: { compressed: LOAD_CAP_BYTES, inflated: LOAD_CAP_BYTES } }
        : source,
    ),
  };
}

/** One part for the small scale, nine for the reference scale (1 + the 2,000,000-name table's 8). */
export function watchlistParts(scale: LoadScale): number {
  return scale === 'small'
    ? WATCHLIST_TABLES['100k'].parts
    : WATCHLIST_TABLES['100k'].parts + WATCHLIST_TABLES['2m'].parts;
}

/** The table and names of part `part` (1-based). */
export function watchlistPartOf(part: number): { table: '100k' | '2m'; names: number } {
  if (part === 1) {
    return { table: '100k', names: WATCHLIST_TABLES['100k'].names };
  }
  const { names, parts } = WATCHLIST_TABLES['2m'];
  return { table: '2m', names: Math.round((names * (part - 1)) / parts) };
}

/**
 * Whether part `part`'s sync may remove most of the source's entries (the sync's
 * `allowMassRemoval`): only part 2, the switch from the 100,000-name table to the 2,000,000-name
 * one, removes every entry of the table before it by design; every other part keeps the guard.
 */
export function allowsMassRemoval(part: number): boolean {
  return part === 2;
}

/** The normalised import file's text, chunk by chunk (C77.5), never the whole text at once. */
export function* normalisedImport(
  source: string,
  publishedAt: string,
  records: Iterable<WatchlistRecord>,
): Generator<string> {
  yield `{"source":${JSON.stringify(source)},"published_at":${JSON.stringify(publishedAt)},"entries":[`;
  let first = true;
  let chunk = '';
  for (const record of records) {
    chunk += `${first ? '' : ','}${JSON.stringify(record)}`;
    first = false;
    if (chunk.length >= 1 << 20) {
      yield chunk;
      chunk = '';
    }
  }
  yield `${chunk}]}\n`;
}

export async function seedWatchlistsStep(
  ctx: LoadStepContext,
  part: number,
  parts: number,
): Promise<LoadStepResult> {
  const { db, files, clock, record, args, repositoryRoot } = ctx;
  const manifest = JSON.parse(
    await files.readFile(join(repositoryRoot, 'data', 'manifest.json'), 'utf8'),
  ) as {
    data: { name: string; filename: string }[];
  };
  const entry = manifest.data.find((item) => item.name === RIGOUR_PERSON_NAMES_ENTRY);
  if (entry === undefined) {
    throw new Error(
      'data/manifest.json has no rigour_person_names entry (python3 scripts/fetch_data.py)',
    );
  }
  const groups = parseRigourPersonNames(
    await files.readFile(join(repositoryRoot, 'data', entry.filename), 'utf8'),
  );
  const pool = heavyHeadedPool(args.tableSeed, groups);
  const { table, names } = watchlistPartOf(part);
  const records =
    table === '100k'
      ? heavyHeadedEntries({ seed: args.tableSeed, pool, names })
      : syntheticEntries({
          seed: `${args.tableSeed}/2m`,
          pool,
          names,
          profile: TABLE_PROFILES.pep,
          idPrefix: 'BP-',
        });
  const directory = await files.makeTemporaryDirectory('openverify-load-watchlist-');
  const path = join(directory, `table-${String(part)}.json`);
  try {
    await files.writeChunks(
      path,
      normalisedImport(
        LOAD_WATCHLIST_SOURCE,
        new Date(PUBLISHED_BASE + part * 60_000).toISOString(),
        records,
      ),
      0o600,
    );
    const matcher = loadMatcherData();
    if (matcher.status !== 'loaded') {
      throw new Error(
        `the variant groups are ${matcher.status}: run pnpm --filter @openverify/watchlist build:variant-groups`,
      );
    }
    const sync = await syncWatchlistSource(
      {
        db,
        connect: poolWatchlistSessions(ctx.pool),
        clock,
        logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
        settings: LOAD_WATCHLIST_SETTINGS,
        matcherData: () => matcher,
        manifest: loadWatchlistManifest(),
      },
      {
        sourceId: LOAD_WATCHLIST_SOURCE,
        actor: 'cli',
        importPath: path,
        acceptOlderPublication: true,
        allowMassRemoval: allowsMassRemoval(part),
      },
    );
    if (sync.outcome !== 'applied' && sync.outcome !== 'unchanged') {
      throw new Error(`the watchlist table did not apply: ${sync.outcome}`);
    }
    if (part === 1 && (record.ids['screening-names']?.length ?? 0) === 0) {
      const table100k = [...heavyHeadedEntries({ seed: args.tableSeed, pool, names })];
      const wanted = countsFor(args.scale).screeningNames;
      const subjects = heavyHeadedSubjects({
        seed: args.tableSeed,
        pool,
        records: table100k,
        count: Math.ceil(wanted / 2),
      });
      addIds(
        record,
        'screening-names',
        subjects
          .map((subject) => {
            const first = subject.query['name-first'] ?? subject.query.term?.split(' ')[0] ?? '';
            const last =
              subject.query['name-last'] ?? subject.query.term?.split(' ').slice(1).join(' ') ?? '';
            return `${first}|${last}`;
          })
          .filter((name) => !name.startsWith('|') && !name.endsWith('|'))
          .slice(0, wanted),
      );
    }
    record.refs['watchlist-table'] =
      table === '100k' ? '100k' : `2m:${String(part - 1)}/${String(WATCHLIST_TABLES['2m'].parts)}`;
    return { counts: { names, entries: sync.entryCount }, parts };
  } finally {
    await files.removeDirectory(directory);
  }
}
