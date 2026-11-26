/**
 * C70.2, C70.3, C75: the report resource as each exit serves it. A report's own columns give the
 * shared attributes; its sealed result gives the type's non-match attributes; its match rows give
 * the review view (`matches`), the live matches in the type's shape (`matched-lists`, `result` or
 * `articles`) and the dismissed ones (`ignore-list`). Every attribute marked PII is masked
 * without `pii:view` (`PiiMask.attributes`), and a redacted report serves none of them.
 *
 * What a run seals in a match's snapshot (the framework, `jobs/reports/persist.ts`):
 * - `entry-key`, `content-hash`, `risk-data-hash`, `matched-name` and `evidence-input` (C75.3),
 *   which the framework writes;
 * - `entity`: the matched entry in the type's served shape without `match-id` (and without
 *   `score`, which the row holds), written by the type's job (`FoundReportMatch.snapshot.entity`);
 * - `list`: for the list types, the list it was found on (`source-id`, `name`, `url`,
 *   `list-type`, `list-types`, `slug`, `flag-code`);
 * - `match-types`, `qualifiers` and `components` (C78.5);
 * - `dismissal`: who dismissed it, why and when (C75.2), once dismissed.
 */
import {
  reportListProvenanceSchema,
  type ReportListProvenance,
  buildReportActionResource,
  buildReportResource,
  buildReportRunResource,
  REPORT_RESOURCE_SCHEMAS,
  type ReportActionResource,
  type ReportQuerySource,
  type ReportResource,
  type ReportRunResource,
  type ReportSourceRecord,
} from '@openverify/contracts';
import {
  REPORT_REGISTRY,
  REPORT_TYPES,
  type ReportCoverageLimit,
  type ReportErrorCode,
  type ReportRunNote,
  type ReportType,
} from '@openverify/core';
import type {
  ReportRunRow,
  StoredReport,
  StoredReportAction,
  StoredReportMatch,
} from '@openverify/db';
import { z } from 'zod';
import type { PiiMask } from '../../auth/pii.js';
import { customListMatchedLists } from '../lists/report-view.js';

/** Where each type with review serves its live matches. */
const LIVE_ATTRIBUTE: Partial<Record<ReportType, 'matched-lists' | 'result' | 'articles'>> = {
  watchlist: 'matched-lists',
  'business-watchlist': 'matched-lists',
  'crypto-address-watchlist': 'result',
  'politically-exposed-person': 'result',
  'adverse-media': 'articles',
  'business-adverse-media': 'articles',
  'custom-list': 'matched-lists',
};

/** The list types: their entities are grouped by the list they were found on. */
const GROUPED: ReadonlySet<ReportType> = new Set([
  'watchlist',
  'business-watchlist',
  'crypto-address-watchlist',
]);

/** Attributes the review view derives; a stored result never sets them. */
const DERIVED = new Set(['matches', 'ignore-list', 'matched-lists', 'articles', 'sanction-list']);

function attributesShape(schema: z.ZodType): Record<string, z.ZodType> {
  let current: unknown = schema;
  while (!(current instanceof z.ZodObject)) {
    const def = (current as { def: { in?: unknown; innerType?: unknown } }).def;
    current = def.in ?? def.innerType;
  }
  const shape: Record<string, z.ZodType> = current.shape;
  return shape;
}

/** Each type's own attribute names (the shared ones excluded). */
const TYPE_ATTRIBUTES: Readonly<Record<ReportType, readonly string[]>> = (() => {
  const shared = new Set(
    Object.keys(attributesShape(REPORT_RESOURCE_SCHEMAS[0].shape.attributes)).filter(
      (name) => !['matched-lists', 'ignore-list', 'matches'].includes(name),
    ),
  );
  return Object.fromEntries(
    REPORT_TYPES.map((type, index) => {
      const schema = REPORT_RESOURCE_SCHEMAS[index];
      const names =
        schema === undefined ? [] : Object.keys(attributesShape(schema.shape.attributes));
      return [type, names.filter((name) => !shared.has(name))];
    }),
  ) as Record<ReportType, string[]>;
})();

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** The provenance the framework stores (served shape), back as the builder's records. */
function sourceRecords(sources: readonly Record<string, unknown>[]): ReportSourceRecord[] {
  return sources.flatMap((source) => {
    const sourceId = text(source['source-id']);
    const publishedAt = text(source['published-at']);
    const checkedAt = text(source['checked-at']);
    if (sourceId === null || publishedAt === null || checkedAt === null) {
      return [];
    }
    return [
      {
        sourceId,
        syncId: text(source['sync-id']) ?? '',
        publishedAt: new Date(publishedAt),
        checkedAt: new Date(checkedAt),
        sha256: text(source.sha256) ?? '',
        origin: source.origin === 'import' ? 'import' : 'publisher',
        attribution: text(source.attribution) ?? sourceId,
      },
    ];
  });
}

/** C106.2: a custom-list run's stored provenance, which is not a watchlist source's. */
function listSourceRecords(sources: readonly Record<string, unknown>[]): ReportListProvenance[] {
  return reportListProvenanceSchema.array().parse(sources);
}

/** C75: one match row in the review view's shape; `null` once redacted. */
function reviewMatch(match: StoredReportMatch): Record<string, unknown> | null {
  const snapshot = match.snapshot;
  if (snapshot === null) {
    return null;
  }
  const components = record(snapshot.components);
  return {
    id: match.id,
    'entity-id': text(snapshot['entry-key']) ?? match.id,
    'source-id': match.sourceId,
    name: text(snapshot['matched-name']) ?? text(components['list-name']) ?? match.id,
    status: match.status,
    'review-status': match.reviewStatus,
    'risk-level': match.riskLevel,
    'notify-on-change': match.notifyOnChange,
    'present-in-last-run': match.presentInLastRun,
    score: match.score,
    'match-types': strings(snapshot['match-types']),
    qualifiers: strings(snapshot.qualifiers),
    'lapsed-from': match.lapsedFrom,
    'delisted-at': match.delistedAt?.toISOString() ?? null,
    'reviewed-at': match.reviewedAt?.toISOString() ?? null,
    'created-at': match.createdAt.toISOString(),
    'updated-at': match.updatedAt.toISOString(),
    'first-run': match.firstRunId,
    'last-run': match.lastRunId,
    components: {
      'subject-name': text(components['subject-name']),
      'list-name': text(components['list-name']),
      'name-level': text(components['name-level']),
      methods: strings(components.methods),
      preset: text(components.preset),
      'min-score': typeof components['min-score'] === 'number' ? components['min-score'] : null,
    },
  };
}

/** The matched entry in the type's shape, with its match id and current score. */
function entityOf(type: ReportType, match: StoredReportMatch): Record<string, unknown> {
  const entity: Record<string, unknown> = {
    ...record(match.snapshot?.entity),
    'match-id': match.id,
  };
  if (type !== 'crypto-address-watchlist') {
    entity.score = match.score;
  }
  return entity;
}

/** The list types' grouping: one list per source, each with its entities. */
function grouped(
  type: ReportType,
  matches: readonly StoredReportMatch[],
): Record<string, unknown>[] {
  const lists = new Map<
    string,
    Record<string, unknown> & { entities: Record<string, unknown>[] }
  >();
  for (const match of matches) {
    const list = record(match.snapshot?.list);
    const key = text(list['source-id']) ?? match.sourceId ?? '';
    const entity = entityOf(type, match);
    const existing = lists.get(key);
    if (existing === undefined) {
      lists.set(key, { ...list, entities: [entity] });
    } else {
      existing.entities.push(entity);
    }
  }
  return [...lists.values()].map((list) => {
    if (type === 'crypto-address-watchlist') {
      const rest: Record<string, unknown> = { ...list };
      delete rest['list-types'];
      delete rest['match-types'];
      return rest;
    }
    const matchTypes = new Set(list.entities.flatMap((entity) => strings(entity['match-types'])));
    return { ...list, 'match-types': [...matchTypes].sort() };
  });
}

/** C75.2: a dismissed match in the ignore list. */
function ignored(
  type: ReportType,
  match: StoredReportMatch,
  runs: ReadonlyMap<string, ReportRunRow>,
): Record<string, unknown> | null {
  const dismissal = record(match.snapshot?.dismissal);
  const user = text(dismissal.user);
  const reason = text(dismissal.reason);
  if (match.snapshot === null || user === null || reason === null) {
    return null;
  }
  const run = runs.get(match.firstRunId);
  return {
    'match-id': match.id,
    'ignored-at': text(dismissal.at) ?? match.updatedAt.toISOString(),
    'run-id': match.firstRunId,
    'run-history-completed-at': run?.completedAt?.toISOString() ?? null,
    match:
      type === 'custom-list'
        ? (customListMatchedLists([match])[0] ?? {})
        : GROUPED.has(type)
          ? (grouped(type, [match])[0] ?? {})
          : entityOf(type, match),
    user,
    'ignore-reason': reason,
  };
}

/** The type's result and review attributes, unmasked. */
function typeAttributes(
  report: StoredReport,
  matches: readonly StoredReportMatch[],
  runs: ReadonlyMap<string, ReportRunRow>,
): Record<string, unknown> {
  const type = report.reportType;
  if (report.redactedAt !== null) {
    return {};
  }
  const names = new Set(TYPE_ATTRIBUTES[type]);
  const stored = record(report.result);
  const attributes: Record<string, unknown> = Object.fromEntries(
    Object.entries(stored).filter(([name]) => names.has(name) && !DERIVED.has(name)),
  );
  const live = LIVE_ATTRIBUTE[type];
  if (REPORT_REGISTRY[type].review !== 'matches' || live === undefined) {
    return attributes;
  }
  if (report.status === 'pending' && matches.length === 0) {
    return attributes;
  }
  const kept = matches.filter((match) => match.snapshot !== null);
  const current = kept.filter((match) => match.status !== 'dismissed');
  attributes.matches = kept.flatMap((match) => {
    const view = reviewMatch(match);
    return view === null ? [] : [view];
  });
  attributes[live] =
    type === 'custom-list'
      ? customListMatchedLists(current)
      : GROUPED.has(type)
        ? grouped(type, current)
        : current.map((match) => entityOf(type, match));
  attributes['ignore-list'] = kept
    .filter((match) => match.status === 'dismissed')
    .flatMap((match) => {
      const entry = ignored(type, match, runs);
      return entry === null ? [] : [entry];
    });
  if (type === 'business-watchlist') {
    const seen = new Map<string, { name: string; url: string | null }>();
    for (const list of attributes[live] as Record<string, unknown>[]) {
      const name = text(list.name);
      if (name !== null && list['list-type'] === 'sanction') {
        seen.set(name, { name, url: text(list.url) });
      }
    }
    attributes['sanction-list'] = [...seen.values()];
    attributes['fitness-probity-list'] = null;
    attributes['warning-list'] = null;
  }
  return attributes;
}

export interface ReportView {
  report: StoredReport;
  /** Every match row of the report (types with review); `[]` otherwise. */
  matches: readonly StoredReportMatch[];
  /** The report's runs, for the ignore list's run times. */
  runs?: readonly ReportRunRow[] | undefined;
  /** C105.7 (Workflow 7B): the latest transaction the report was attached to. */
  transactionId?: string | null | undefined;
  /**
   * C173.1 (Workflow 9B, `api-cases-reports`): the latest finished run's note codes; left out while
   * no run has finished.
   */
  latestRunNotes?: readonly ReportRunNote[] | undefined;
}

/**
 * C70.2: the report resource, masked for the caller (C70.3): unmasked for event payloads and
 * webhooks (`UNMASKED`), masked attribute by attribute without `pii:view`.
 */
export function reportResource(view: ReportView, mask: PiiMask): ReportResource {
  const { report } = view;
  const runs = new Map((view.runs ?? []).map((run) => [run.id, run]));
  const built = buildReportResource({
    ...(view.transactionId === undefined ? {} : { transactionId: view.transactionId }),
    ...(view.latestRunNotes === undefined ? {} : { latestRunNotes: view.latestRunNotes }),
    id: report.id,
    type: report.reportType,
    status: report.status,
    origin: report.origin,
    reportTemplateId: report.reportTemplateId,
    reportTemplateVersionId: report.reportTemplateVersionId,
    versionNumber: report.versionNumber,
    inquiryId: report.inquiryId,
    accountId: report.accountId,
    accountIds: report.accountIds,
    query: report.query,
    querySources: report.querySources as Record<string, ReportQuerySource>,
    hasMatch: REPORT_REGISTRY[report.reportType].review === 'matches' ? report.hasMatch : false,
    completedRunCount: report.completedRunCount,
    tags: report.tags,
    errors: report.errors as { code: ReportErrorCode; source?: string }[],
    unavailableFields: report.unavailableFields,
    coverage:
      report.coverage === null
        ? null
        : {
            complete: report.coverage.complete,
            limits: report.coverage.limits as ReportCoverageLimit[],
          },
    nextRunAt: report.nextRunAt,
    pausedAt: report.pausedAt,
    pausedReason: report.pausedReason,
    sources: report.reportType === 'custom-list' ? [] : sourceRecords(report.sources),
    ...(report.reportType === 'custom-list'
      ? { listSources: listSourceRecords(report.sources) }
      : {}),
    matcherVersion: report.matcherVersion,
    provider: report.provider,
    thresholds: report.thresholds,
    notices: report.notices,
    attributes: typeAttributes(report, view.matches, runs),
    createdAt: report.createdAt,
    completedAt: report.completedAt,
    redactedAt: report.redactedAt,
  });
  return { ...built, attributes: mask.attributes(built.attributes) } as ReportResource;
}

/** C74.2: one run in the history. */
export function reportRunResource(report: StoredReport, run: ReportRunRow): ReportRunResource {
  return buildReportRunResource({
    id: run.id,
    reportId: report.id,
    reportType: report.reportType,
    runType: run.runType,
    status: run.status,
    scheduledFor: run.scheduledFor,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    matchCount: run.matchCount,
    newMatchCount: run.newMatchCount,
    notes: run.notes as ReportRunNote[],
    errors: run.errors as { code: ReportErrorCode; source?: string }[],
    coverage:
      run.coverage === null
        ? null
        : { complete: run.coverage.complete, limits: run.coverage.limits as ReportCoverageLimit[] },
    createdAt: run.createdAt,
  });
}

/** C74.2: one action in the history; `reason` and `comment` are PII (C70.3). */
export function reportActionResource(
  report: StoredReport,
  action: StoredReportAction,
  mask: PiiMask,
): ReportActionResource {
  const details = action.details;
  const built = buildReportActionResource({
    id: action.id,
    reportId: report.id,
    reportType: report.reportType,
    actionType: action.actionType,
    actor: action.actorId ?? 'system',
    reason: details?.reason ?? null,
    comment: details?.comment ?? null,
    matchIds: details?.matchIds ?? [],
    reviewStatus: details?.reviewStatus ?? null,
    riskLevel: details?.riskLevel ?? null,
    createdAt: action.createdAt,
  });
  return { ...built, attributes: mask.attributes(built.attributes) };
}
