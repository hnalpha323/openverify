/**
 * C69.4, C76.3, C78, C79, C80 (Workflow 6A Stage 3, `api-reports`): what the four matching report
 * jobs share (`jobs/report-types/{watchlist,business-watchlist,crypto-address-watchlist,
 * politically-exposed-person}.ts`): the screenable sources of a run and the errors of the others,
 * their provenance, the variant groups, retrieval through `api-watchlists`' frozen reads, and the
 * served shapes of a match (`entity`, `list`, `components`).
 *
 * A selected source is screened only when the manifest knows it, it has a row, is enabled, was
 * applied and checked (a sync id and a SHA-256), is keyed by this worker's `keysVersion` (the
 * crypto normaliser's part of it for the crypto type, which needs no variant groups) and is
 * fresh: its last successful check is younger than the smaller of its `stale_after_hours` and the
 * template's `max-list-age-hours`; a sandbox-only source is never stale (V03) and never screened
 * for a production environment (P13). Any other source ends the run `errored` with
 * `list_unavailable`, `matcher_data_unavailable` or `list_stale` naming it, whatever the run found
 * on the others (C69.4, H01); an empty selection errors `list_unavailable` without a source. The
 * rules are those of `watchlists/freshness.ts` (`api-watchlists`), over the engine's lenient read
 * of the manifest.
 *
 * Nothing here logs: the subject's names and the list values only reach the sealed snapshot.
 */
import { WATCHLIST_OPT_IN_SOURCES } from '@openverify/contracts';
import { SCREENING_CONSTANTS, type ReportType } from '@openverify/core';
import {
  getEnvironment,
  type Db,
  type EnvironmentSettings,
  type WatchlistEntryRecord,
  type WatchlistReads,
  type WatchlistSourceState,
} from '@openverify/db';
import {
  canonicaliseCryptoAddress,
  CRYPTO_NORMALISER_VERSION,
  keysVersion,
  matcherVersion,
  queryNameKeys,
  queryNameReach,
  recordCryptoRows,
  resolveNameMatching,
  retrievalQuery,
  screenCandidates,
  screenCryptoAddress,
  screeningCoverage,
  screeningThresholds,
  type EntryMatch,
  type NameMatchingConfig,
  type ScreeningCandidate,
  type ScreeningOptions,
  type ScreeningSubject,
  type TokenScript,
  type VariantGroups,
  type WatchlistRecord,
} from '@openverify/watchlist';
import type { CryptoExposureProvider } from '../../ports.js';
import {
  watchlistSourceCatalog,
  type WatchlistSourceCatalog,
} from '../../services/reports/source-catalog.js';
import { currentWatchlistReads } from '../../services/reports/reports.js';
import { loadMatcherData } from '../../watchlists/matcher-data.js';
import { environmentMayScreenSource } from '../../watchlists/un-opt-in.js';
import type {
  FoundReportMatch,
  ReportRunContext,
  ReportRunError,
  ReportRunResult,
  ReportRunSource,
  RunOutcome,
} from '../report-types/job.js';
import { listEvidence } from '../report-types/record-evidence.js';

/** What the matching jobs read; tests replace any part. */
export interface ScreeningKit {
  /** `api-watchlists`' frozen reads (C78.3). */
  reads: () => WatchlistReads;
  /** C78.3 (F14): the filtered variant groups, or `null` when the file is missing or another. */
  groups: () => VariantGroups | null;
  /** The source manifest as the engine reads it (C76.1). */
  catalog: () => WatchlistSourceCatalog;
  /** C254.1 (Q10): an environment's settings, where its UN list opt-in is recorded. */
  environmentSettings: (db: Db, environmentId: string) => Promise<EnvironmentSettings>;
}

const DEFAULT_KIT: ScreeningKit = {
  environmentSettings: async (db, environmentId) =>
    (await getEnvironment(db, environmentId))?.settings ?? {},
  reads: currentWatchlistReads,
  groups: () => {
    const data = loadMatcherData();
    return data.status === 'loaded' ? data.groups : null;
  },
  catalog: watchlistSourceCatalog,
};

let kit: ScreeningKit = DEFAULT_KIT;

/** Replaces parts of the kit (tests); returns a function that restores the previous one. */
export function useScreeningKit(parts: Partial<ScreeningKit>): () => void {
  const previous = kit;
  kit = { ...kit, ...parts };
  return () => {
    kit = previous;
  };
}

/** The kit in force. */
export function screeningKit(): ScreeningKit {
  return kit;
}

const HOUR = 3_600_000;

/** C254.1: the sources that take an environment's opt-in (the UN list). */
const OPT_IN_SOURCES: ReadonlySet<string> = new Set(WATCHLIST_OPT_IN_SOURCES);

/** C78.3: the candidate cap; a search that reaches it is `truncated` (C78.5). */
const CANDIDATE_CAP = SCREENING_CONSTANTS['candidate-cap'].value;

/** Whether a source's stored keys are the ones this worker would compute (C78.3, V04). */
type KeysCheck = (storedKeysVersion: string | null) => boolean;

/** The name types compare the whole keys version (the groups' digest included). */
const namesKeyedBy =
  (groups: VariantGroups): KeysCheck =>
  (stored) =>
    stored === keysVersion(groups.sha256);

/** The crypto type reads only the canonical addresses, so only the crypto normaliser counts. */
const cryptoKeyed: KeysCheck = (stored) =>
  stored?.split(';').includes(CRYPTO_NORMALISER_VERSION) === true;

export interface ScreenableSources {
  /** The states of the sources the run screens. */
  screenable: WatchlistSourceState[];
  /** One error per selected source the run cannot screen (and one for an empty selection). */
  errors: ReportRunError[];
  /** The provenance of each screenable source. */
  sources: ReportRunSource[];
}

/** The selected source ids of a list type's resolved configuration. */
export function searchLists(config: Readonly<Record<string, unknown>>): string[] {
  const lists = config['search-lists'];
  return Array.isArray(lists) ? lists.filter((id): id is string => typeof id === 'string') : [];
}

/** C69.4, C76.3, C78.3: the sources a run screens, and an error for each it cannot. */
export async function screenableSources(
  ctx: ReportRunContext,
  sourceIds: readonly string[],
  keyed: KeysCheck,
): Promise<ScreenableSources> {
  if (sourceIds.length === 0) {
    return { screenable: [], errors: [{ code: 'list_unavailable' }], sources: [] };
  }
  const states = await kit.reads().getWatchlistSourceStates(ctx.deps.db, sourceIds);
  const catalog = kit.catalog();
  const maxAge = ctx.report.config['max-list-age-hours'];
  const now = ctx.deps.clock.now().getTime();
  const result: ScreenableSources = { screenable: [], errors: [], sources: [] };
  let settings: EnvironmentSettings | undefined;
  const environmentSettings = async (): Promise<EnvironmentSettings> => {
    settings ??= await kit.environmentSettings(ctx.deps.db, ctx.report.environmentId);
    return settings;
  };
  for (const sourceId of sourceIds) {
    const state = states.find((candidate) => candidate.id === sourceId);
    const described = catalog.get(sourceId);
    const sandboxOnly = state?.sandboxOnly === true || described?.sandboxOnly === true;
    if (
      described === undefined ||
      state === undefined ||
      !state.enabled ||
      state.lastAppliedAt === null ||
      state.lastCheckedAt === null ||
      state.lastSyncId === null ||
      state.lastSha256 === null ||
      (sandboxOnly && ctx.report.environmentKind !== 'sandbox')
    ) {
      result.errors.push({ code: 'list_unavailable', source: sourceId });
      continue;
    }
    // C254.1 (Q10 granted; KP11-31): an opt-in source (the UN list) only for an environment that
    // recorded its acceptance, while the install allows it, though its row is enabled install-wide.
    if (
      OPT_IN_SOURCES.has(sourceId) &&
      !environmentMayScreenSource(
        sourceId,
        await environmentSettings(),
        ctx.deps.watchlists.unOptInAllowed === true,
      )
    ) {
      result.errors.push({ code: 'list_unavailable', source: sourceId });
      continue;
    }
    if (!keyed(state.keysVersion)) {
      result.errors.push({ code: 'matcher_data_unavailable', source: sourceId });
      continue;
    }
    const checkedAt = state.lastCheckedAt;
    const limits = [described.staleAfterHours, typeof maxAge === 'number' ? maxAge : null].filter(
      (hours): hours is number => hours !== null,
    );
    if (!sandboxOnly && limits.some((hours) => now - checkedAt.getTime() > hours * HOUR)) {
      result.errors.push({ code: 'list_stale', source: sourceId });
      continue;
    }
    result.screenable.push(state);
    result.sources.push({
      sourceId,
      syncId: String(state.lastSyncId),
      publishedAt: state.lastPublishedAt ?? checkedAt,
      checkedAt,
      sha256: state.lastSha256,
      origin: state.lastOrigin ?? 'publisher',
      attribution: described.attribution,
    });
  }
  return result;
}

/** A partial date (`YYYY`, `YYYY-MM`, `YYYY-MM-DD`) in the served birthdate shape. */
export function servedBirthdate(value: string): Record<string, unknown> | null {
  // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(value);
  if (match === null) {
    return null;
  }
  const [, year, month, day] = match;
  return {
    day: day === undefined ? null : Number(day),
    month: month === undefined ? null : Number(month),
    year: Number(year),
    granularity: day !== undefined ? 'day' : month !== undefined ? 'month' : 'year',
  };
}

/** The record's birth dates, served. */
export function birthdatesOf(record: WatchlistRecord): Record<string, unknown>[] {
  return record.birth_dates.flatMap((date) => {
    const served = servedBirthdate(date.value);
    return served === null ? [] : [served];
  });
}

/** The record's country codes, each once. */
export function countriesOf(record: WatchlistRecord): string[] {
  return [
    ...new Set(
      record.countries.flatMap((country) => (country.code === null ? [] : [country.code])),
    ),
  ];
}

/** The list a match was found on, in the public `matched-lists` shape (T2). */
export function listOf(sourceId: string, type: ReportType): Record<string, unknown> {
  const described = kit.catalog().get(sourceId);
  const listType =
    described?.kind === 'pep' || type === 'politically-exposed-person' ? 'pep' : 'sanction';
  return {
    'source-id': sourceId,
    name: (described?.publisher ?? sourceId).slice(0, 200),
    url: described?.listUrl ?? null,
    'list-type': listType,
    'list-types': [listType],
    slug: sourceId,
    'flag-code': described?.flagCode ?? 'ZZ',
  };
}

/** C78.5: a match's components, as the review shows them. */
export function componentsOf(
  match: EntryMatch,
  thresholds: Readonly<Record<string, string | number | boolean>> | null,
): Record<string, unknown> {
  return {
    'subject-name': match.subjectName,
    'list-name': match.listName,
    'name-level': match.nameLevel,
    methods: [...match.methods],
    preset: typeof thresholds?.preset === 'string' ? thresholds.preset : null,
    'min-score': typeof thresholds?.['min-score'] === 'number' ? thresholds['min-score'] : null,
  };
}

/** A name capped to what the resource serves. */
export function servedName(name: string): string {
  return name.length > 300 ? name.slice(0, 300) : name;
}

/** The records a candidate's relations name (a PEP relative's linked holder), by source. */
export type LinkedRecords = (sourceId: string, entryId: string) => WatchlistRecord | undefined;

/** What one name screening needs from its type (C79.1, C79.2, C80.5). */
export interface NameScreening {
  type: Extract<ReportType, 'watchlist' | 'business-watchlist' | 'politically-exposed-person'>;
  subject: () => ScreeningSubject;
  options: Omit<ScreeningOptions, 'groups' | 'nameMatching'>;
  /** The entry kinds retrieval searches (the matcher filters them again, C78.4). */
  entryKinds: readonly ('individual' | 'entity' | 'vessel' | 'aircraft')[];
  /** C80.5: which candidates may be screened at all (PEP classes and relatives). */
  admit?: ((candidate: ScreeningCandidate, linked: LinkedRecords) => boolean) | undefined;
  /** The matched entry in the type's served shape, without `match-id` and `score`. */
  entity: (
    match: EntryMatch,
    candidate: ScreeningCandidate,
    linked: LinkedRecords,
  ) => Record<string, unknown>;
  notices: ReportRunResult['notices'];
  unavailableFields: ReportRunResult['unavailableFields'];
  /** The type's own sealed result members (`lists-searched`). */
  result?: Readonly<Record<string, unknown>> | undefined;
}

/** A run that screened nothing: its errors only. */
export function unscreened(
  errors: readonly ReportRunError[],
  extra: Partial<ReportRunResult> = {},
): RunOutcome {
  return {
    kind: 'completed',
    result: {
      errors,
      sources: [],
      coverage: null,
      result: {},
      unavailableFields: [],
      provider: null,
      thresholds: null,
      notices: [],
      matcherVersion: null,
      matches: [],
      ...extra,
    },
  };
}

/** The live candidates of a retrieval, loaded (removed entries are never matched). */
async function loadLive(
  ctx: ReportRunContext,
  wanted: readonly { sourceId: string; entryId: string }[],
): Promise<WatchlistEntryRecord[]> {
  if (wanted.length === 0) {
    return [];
  }
  const loaded = await kit.reads().loadEntries(ctx.deps.db, {
    environmentKind: ctx.report.environmentKind,
    entries: wanted,
  });
  return loaded.filter((entry) => entry.removedAt === null);
}

const keyOf = (sourceId: string, entryId: string) => `${sourceId}:${entryId}`;
const recordOf = (entry: WatchlistEntryRecord) => entry.data as unknown as WatchlistRecord;

/** C78.3: the candidates of every subject name, merged; `truncated` when any search was cut. */
async function retrieveNames(
  ctx: ReportRunContext,
  spec: NameScreening,
  subject: ScreeningSubject,
  groups: VariantGroups,
  sourceIds: readonly string[],
): Promise<{ candidates: { sourceId: string; entryId: string }[]; truncated: boolean }> {
  const reads = kit.reads();
  const query = retrievalQuery(subject, groups);
  const [first, ...others] = query.normalisedNames;
  const base = {
    environmentKind: ctx.report.environmentKind,
    sourceIds,
    cryptoAddresses: [],
    cap: CANDIDATE_CAP,
    entryKinds: spec.entryKinds,
    weakAliases: spec.options.screenWeakAliases,
  };
  // The keys and identifiers of every name in one search, with the first name's trigram and
  // weak-alias paths; each other name (`additional-names`) takes those paths on its own. With
  // other names, the first name's paths take a search of their own with its own keys, so an
  // other name's rare key never skips the first name's trigram fallback (R007).
  const firstNames = subject.names.filter((name) => name.normalised === first);
  const firstKeys = others.length === 0 ? query.keys : queryNameKeys(firstNames, groups);
  const firstReach = others.length === 0 ? query.reach : queryNameReach(firstNames, groups);
  // Owner decision 1 after 6B: each search by key carries the reach of its names, so a search that
  // cannot reach the list names holding two of their tokens says it was cut short.
  const searches = [
    ...(others.length === 0
      ? []
      : [
          {
            ...base,
            keys: query.keys,
            reach: query.reach,
            identifiers: subject.identifiers,
            normalisedName: null,
          },
        ]),
    {
      ...base,
      keys: firstKeys,
      reach: firstReach,
      identifiers: others.length === 0 ? subject.identifiers : [],
      normalisedName: first ?? null,
    },
    ...others.map((name) => ({
      ...base,
      keys: [],
      reach: [],
      identifiers: [],
      normalisedName: name,
    })),
  ];
  const found = new Map<string, { sourceId: string; entryId: string }>();
  let truncated = false;
  for (const search of searches) {
    const retrieved = await reads.retrieveCandidates(ctx.deps.db, {
      ...search,
      identifiers: search.identifiers.map(({ kind, value, country }) => ({ kind, value, country })),
    });
    truncated ||= retrieved.truncated;
    for (const { sourceId, entryId } of retrieved.candidates) {
      found.set(keyOf(sourceId, entryId), { sourceId, entryId });
    }
  }
  return { candidates: [...found.values()], truncated };
}

/** Changed entries read per page by a `list_update` run. */
const TRIGGER_PAGE = 1_000;

/**
 * Owner decision 13 after 6B (K6A-9): the scripts each source's live names are written in, from its
 * state, so a name in a script the source holds is not flagged `lossy_script` whatever this run
 * retrieved; a state without them (a hand-built one) falls back to `loaded`, the scripts of the
 * entries the run screened.
 */
function sourceScriptsOf(
  states: readonly WatchlistSourceState[],
  loaded: ReadonlyMap<string, ReadonlySet<TokenScript>>,
): Map<string, Set<TokenScript>> {
  const scripts = new Map([...loaded].map(([sourceId, held]) => [sourceId, new Set(held)]));
  for (const state of states) {
    if (state.scripts !== undefined) {
      scripts.set(state.id, new Set(state.scripts as readonly TokenScript[]));
    }
  }
  return scripts;
}

/** Adds the scripts each source's screened entries carry, so a name met in its own script is not flagged. */
function addScripts(
  scripts: Map<string, Set<TokenScript>>,
  entries: readonly WatchlistEntryRecord[],
): void {
  for (const entry of entries) {
    const held = scripts.get(entry.sourceId) ?? new Set<TokenScript>();
    for (const name of recordOf(entry).names) {
      held.add(name.script);
    }
    scripts.set(entry.sourceId, held);
  }
}

/** A match a run keeps, with what it persists of it. */
interface KeptMatch {
  readonly match: EntryMatch;
  readonly found: FoundReportMatch;
}

/** `screenCandidates`' order: the score, then the entry key. */
const byScoreThenKey = (left: KeptMatch, right: KeptMatch): number =>
  right.match.score !== left.match.score
    ? right.match.score - left.match.score
    : left.match.entryKey < right.match.entryKey
      ? -1
      : left.match.entryKey > right.match.entryKey
        ? 1
        : 0;

/** How a run screens one set of entries: the subject, its options and the type's shapes. */
interface EntryScreen {
  readonly ctx: ReportRunContext;
  readonly spec: NameScreening;
  readonly subject: ScreeningSubject;
  readonly options: ScreeningOptions;
  readonly thresholds: Readonly<Record<string, string | number | boolean>> | null;
}

/**
 * C78.4, C80.3: the matches the subject keeps among `entries`, with their persisted shape. The
 * holders the entries' relatives are linked to decide whether a relative is screened: they are
 * read from `known` (the records already loaded) or loaded by id, live ones only.
 */
async function screenEntries(
  screen: EntryScreen,
  entries: readonly WatchlistEntryRecord[],
  known: ReadonlyMap<string, WatchlistRecord>,
): Promise<KeptMatch[]> {
  const { ctx, spec, subject, options, thresholds } = screen;
  const candidates: ScreeningCandidate[] = entries.map((entry) => ({
    sourceId: entry.sourceId,
    record: recordOf(entry),
  }));
  const records = new Map(known);
  for (const candidate of candidates) {
    records.set(keyOf(candidate.sourceId, candidate.record.entry_id), candidate.record);
  }
  const wanted = candidates.flatMap((c) =>
    c.record.relations
      .filter((relation) => !records.has(keyOf(c.sourceId, relation.entity_id)))
      .map((relation) => ({ sourceId: c.sourceId, entryId: relation.entity_id })),
  );
  for (const holder of await loadLive(ctx, wanted)) {
    records.set(keyOf(holder.sourceId, holder.entryId), recordOf(holder));
  }
  const linked: LinkedRecords = (sourceId, entryId) => records.get(keyOf(sourceId, entryId));
  const admitted =
    spec.admit === undefined ? candidates : candidates.filter((c) => spec.admit?.(c, linked));
  const byKey = new Map(entries.map((entry) => [keyOf(entry.sourceId, entry.entryId), entry]));
  const byCandidate = new Map(admitted.map((c) => [keyOf(c.sourceId, c.record.entry_id), c]));
  return screenCandidates(subject, admitted, options).flatMap((match) => {
    const entry = byKey.get(match.entryKey);
    const candidate = byCandidate.get(match.entryKey);
    if (entry === undefined || candidate === undefined) {
      return [];
    }
    const found: FoundReportMatch = {
      sourceId: match.sourceId,
      entryKey: match.entryKey,
      contentHash: entry.contentHash,
      riskDataHash: entry.riskDataHash,
      matchedName: servedName(match.listName),
      score: Math.min(1, Math.max(0, match.score)),
      snapshot: {
        entity: spec.entity(match, candidate, linked),
        list: listOf(match.sourceId, spec.type),
        'match-types': [...match.matchTypes],
        qualifiers: [...match.qualifiers],
        components: componentsOf(match, thresholds),
      },
    };
    return [{ match, found }];
  });
}

/**
 * C78, C79, C80: screens the subject's names and identifiers against the screenable sources,
 * keeps what reaches the preset's minimum, and states the coverage; a search cut at its cap that
 * found nothing errors `result_truncated` (H12).
 *
 * A `list_update` run (owner decision 3 after 6B) also screens the live entries its trigger sync
 * added or changed on its screenable sources, beside retrieval, so whatever the re-screen found,
 * the run finds, a search cut at its cap included. Review C004 (owner decision 4 after 6C): it reads
 * them a page at a time and screens each page on its own, with the holders of the page's relatives,
 * so it holds one page of changed entries at most. The scorer scores each candidate on its own and
 * its pair memo lives for one call, so the matches kept page by page, merged in the scorer's order,
 * are the matches of the whole set at once; the coverage reads the scripts of every page.
 */
export async function screenNames(ctx: ReportRunContext, spec: NameScreening): Promise<RunOutcome> {
  const config = ctx.report.config;
  const groups = kit.groups();
  const base = { notices: spec.notices, unavailableFields: spec.unavailableFields };
  if (groups === null) {
    return unscreened([{ code: 'matcher_data_unavailable' }], base);
  }
  const nameMatching = resolveNameMatching(config['name-matching'] as NameMatchingConfig);
  const thresholds = screeningThresholds(nameMatching);
  const described = { ...base, thresholds, matcherVersion: matcherVersion(groups.sha256) };
  const selected = searchLists(config);
  const { screenable, errors, sources } = await screenableSources(
    ctx,
    selected,
    namesKeyedBy(groups),
  );
  const subject = spec.subject();
  if (subject.names.length === 0 && subject.identifiers.length === 0) {
    return unscreened([...errors, { code: 'insufficient_input' }], described);
  }
  if (screenable.length === 0) {
    return unscreened(errors, described);
  }
  const sourceIds = screenable.map((source) => source.id);
  const retrieved = await retrieveNames(ctx, spec, subject, groups, sourceIds);
  // A run keeps only the matches it creates, so the scorer may stop at the preset's minimum
  // (owner decision 1 after 6B, `keptOnly`).
  const screen: EntryScreen = {
    ctx,
    spec,
    subject,
    options: { ...spec.options, nameMatching, groups, keptOnly: true },
    thresholds,
  };
  const scripts = new Map<string, Set<TokenScript>>();
  const entries = await loadLive(ctx, retrieved.candidates);
  addScripts(scripts, entries);
  const retrievedRecords = new Map(
    entries.map((entry) => [keyOf(entry.sourceId, entry.entryId), recordOf(entry)]),
  );
  const kept = await screenEntries(screen, entries, retrievedRecords);
  const syncId = ctx.run.runType === 'list_update' ? ctx.run.triggerSyncId : null;
  let afterEntryId: string | undefined;
  while (syncId !== null) {
    const page = await kit.reads().loadEntries(ctx.deps.db, {
      environmentKind: ctx.report.environmentKind,
      entries: [],
      changedInSync: { syncId, afterEntryId, limit: TRIGGER_PAGE },
    });
    const changed = page.filter(
      (entry) =>
        entry.removedAt === null &&
        sourceIds.includes(entry.sourceId) &&
        !retrievedRecords.has(keyOf(entry.sourceId, entry.entryId)),
    );
    addScripts(scripts, changed);
    kept.push(...(await screenEntries(screen, changed, retrievedRecords)));
    if (page.length < TRIGGER_PAGE) {
      break;
    }
    afterEntryId = page.at(-1)?.entryId;
  }
  kept.sort(byScoreThenKey);
  const coverage = screeningCoverage(subject.names, {
    sourceIds,
    sourceScripts: sourceScriptsOf(screenable, scripts),
    truncated: retrieved.truncated,
  });
  const runErrors = [...errors];
  if (coverage.truncated && kept.length === 0) {
    runErrors.push({ code: 'result_truncated' });
  }
  return {
    kind: 'completed',
    result: {
      ...described,
      errors: runErrors,
      sources,
      coverage: { complete: coverage.complete, limits: [...coverage.limits] },
      result: { ...spec.result, 'coverage-detail': coverage.names },
      provider: null,
      matches: kept.map(({ found }) => found),
    },
  };
}

/** The served exposure block (C83), from the port's answer. */
function exposureBlock(rated: {
  categories: readonly string[];
  direct: number;
  indirect: number;
  hops?: number | undefined;
}) {
  // Owner decision 5 (a): the provider's distance when it states a whole number of hops, else
  // "at least one hop" (an indirect exposure is never zero hops away).
  const hops =
    rated.hops !== undefined && Number.isInteger(rated.hops) && rated.hops >= 1 ? rated.hops : 1;
  const exposures = rated.categories.flatMap((category) => [
    ...(rated.direct > 0 ? [{ category, share: rated.direct, hops: 0 }] : []),
    ...(rated.indirect > 0 ? [{ category, share: rated.indirect, hops }] : []),
  ]);
  return {
    'direct-sanctioned': rated.direct > 0 && rated.categories.includes('sanctioned_entity'),
    exposures,
    // Decision 20's rule for crypto too: no synthesised score.
    'risk-score': null,
  };
}

/** C83, F19: the optional exposure step, through the `cryptoExposure` port. */
async function exposureOf(
  provider: CryptoExposureProvider | undefined,
  request: { chainId: string; address: string },
): Promise<{
  exposure: Record<string, unknown> | null;
  unavailable: ReportRunResult['unavailableFields'];
  provider: ReportRunResult['provider'];
}> {
  if (provider === undefined) {
    return {
      exposure: null,
      unavailable: [{ field: 'exposure', reason: 'provider_not_configured' }],
      provider: null,
    };
  }
  const identity = { id: provider.id, sandbox: provider.sandbox };
  try {
    const answer = await provider.exposure(request);
    return answer.outcome === 'rated'
      ? { exposure: exposureBlock(answer), unavailable: [], provider: identity }
      : {
          exposure: null,
          unavailable: [{ field: 'exposure', reason: 'undetermined' }],
          provider: identity,
        };
  } catch {
    // The screening stands; only the exposure block is missing, and says why.
    return {
      exposure: null,
      unavailable: [{ field: 'exposure', reason: 'execution_error' }],
      provider: identity,
    };
  }
}

/** C79.3, C83: the crypto-address screening of `crypto-address-watchlist`. */
export async function screenCrypto(ctx: ReportRunContext): Promise<RunOutcome> {
  const query = ctx.report.query;
  const raw = typeof query['crypto-address'] === 'string' ? query['crypto-address'] : '';
  const chainId = typeof query['chain-id'] === 'string' ? query['chain-id'] : null;
  const address = canonicaliseCryptoAddress(raw, { chainId });
  const selected = searchLists(ctx.report.config);
  const { screenable, errors, sources } = await screenableSources(ctx, selected, cryptoKeyed);
  if (address === null) {
    return unscreened([...errors, { code: 'insufficient_input' }]);
  }
  let entries: WatchlistEntryRecord[] = [];
  let truncated = false;
  if (screenable.length > 0) {
    const retrieved = await kit.reads().retrieveCandidates(ctx.deps.db, {
      environmentKind: ctx.report.environmentKind,
      sourceIds: screenable.map((source) => source.id),
      keys: [],
      identifiers: [],
      cryptoAddresses: [address.canonical],
      normalisedName: null,
      cap: CANDIDATE_CAP,
    });
    truncated = retrieved.truncated;
    entries = await loadLive(ctx, retrieved.candidates);
  }
  const screened = screenCryptoAddress(
    { 'crypto-address': raw, 'chain-id': chainId },
    entries.map((entry) => ({ sourceId: entry.sourceId, record: recordOf(entry) })),
  );
  const byKey = new Map(entries.map((entry) => [keyOf(entry.sourceId, entry.entryId), entry]));
  const found: FoundReportMatch[] = screened.matches.flatMap((match) => {
    const entry = byKey.get(match.entryKey);
    if (entry === undefined) {
      return [];
    }
    const record = recordOf(entry);
    return [
      {
        sourceId: match.sourceId,
        entryKey: match.entryKey,
        contentHash: entry.contentHash,
        riskDataHash: entry.riskDataHash,
        matchedName: servedName(match.listName),
        score: 1,
        snapshot: {
          entity: {
            'entity-id': match.entryKey,
            name: servedName(match.listName),
            'alias-type': match.aliasType,
            'match-types': [...match.matchTypes],
            birthdates: birthdatesOf(record),
            'crypto-addresses': recordCryptoRows(record).map((row) => ({
              type: (row.ticker ?? 'unknown').slice(0, 20),
              address: row.raw,
              chain: row.chain,
            })),
            ...listEvidence(record),
          },
          list: listOf(match.sourceId, 'crypto-address-watchlist'),
          'match-types': [...match.matchTypes],
          qualifiers: [],
          components: componentsOf(match, null),
        },
      },
    ];
  });
  const limits = [...(truncated ? (['truncated'] as const) : []), ...screened.coverage.limits];
  const exposure = await exposureOf(ctx.providers.cryptoExposure, {
    chainId: address.chain,
    address: address.canonical,
  });
  return {
    kind: 'completed',
    result: {
      errors: [
        ...errors,
        ...(truncated && found.length === 0 ? [{ code: 'result_truncated' as const }] : []),
      ],
      sources,
      coverage: { complete: limits.length === 0, limits },
      result: { 'crypto-address-format': address.format, exposure: exposure.exposure },
      unavailableFields: exposure.unavailable,
      provider: exposure.provider,
      thresholds: null,
      notices: [],
      matcherVersion: null,
      matches: found,
      cryptoAddress: address.canonical,
    },
  };
}
