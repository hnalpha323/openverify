/**
 * C106.2 (Workflow 7B, owner `api-lists`; H08, ADR 0005): the `custom-list` report job, behind the
 * frozen `ReportTypeJob` of `jobs/report-types/index.ts`.
 *
 * - **What it reads.** The lists pinned on the report template, else the query's `list-ids`. It
 *   calls `matchLists` with the fuzzy method on, as a screening does. A biometric list needs an
 *   inquiry's selfie: with no inquiry the subject has no value of its kind, and with one the job
 *   holds no matcher, so that list is unscreened until the engine gives it one.
 * - **Honesty.** Any selected list in `unscreened` ends the run `errored` with `list_unavailable`
 *   and the list id, keeping the matches it found; a list in `not-applicable` does not. No query or
 *   no list ends it `insufficient_input`, so nothing reads as screened.
 * - **Each match** is a report match under the C75 review semantics, keyed by the list item
 *   (`<list id>:<item id>`). An item never changes, so its content hash is its id's. The snapshot's
 *   `entity` holds the C99.1 evidence, read back by `services/lists/report-view.ts`.
 * - **Provenance.** `listSources` holds one `{ list-id, version, normaliser-version, item-count,
 *   screened-at }` per list it read in full, never through `WatchlistReads`.
 *
 * Nothing it logs names a value.
 */
import { createHash } from 'node:crypto';
import { LIST_KEYS_VERSION } from '@openverify/checks';
import { customListQuerySchema, type ReportListProvenance } from '@openverify/contracts';
import { toListItemResourceType, toListResourceType, type ReportErrorCode } from '@openverify/core';
import { getLists, type ListRow } from '@openverify/db';
import { matchLists, type FoundListMatch, type ListProbe } from '../../services/lists/match.js';
import type {
  FoundReportMatch,
  ReportRunContext,
  ReportRunResult,
  ReportTypeJob,
  RunOutcome,
} from './job.js';
import { erroredResult } from './provider-reports.js';

/** A completed run with the list provenance a custom-list report serves as `sources`. */
export interface CustomListRunResult extends ReportRunResult {
  listSources: readonly ReportListProvenance[];
}

const refused = (code: ReportErrorCode): RunOutcome => ({
  kind: 'completed',
  result: { ...erroredResult(code), listSources: [] },
});

type Query = Readonly<Record<string, unknown>>;

const SOURCE = 'report.query' as const;

/** C106.2: the query's values, one probe per kind. */
function probesOf(query: Query): ListProbe[] {
  const probe = (kind: ListProbe['kind'], value: Query): ListProbe => ({
    source: SOURCE,
    kind,
    values: [value],
  });
  const of = (member: string) => query[member];
  return [
    ...(of('email-address') === undefined
      ? []
      : [probe('email-address', { value: of('email-address') })]),
    ...(of('phone-number') === undefined
      ? []
      : [probe('phone-number', { value: of('phone-number') })]),
    ...(of('name-first') === undefined && of('name-last') === undefined
      ? []
      : [
          probe('name', {
            'name-first': of('name-first') ?? '',
            'name-last': of('name-last') ?? '',
          }),
        ]),
    ...(of('government-id-number') === undefined
      ? []
      : [
          probe('government-id-number', {
            'id-number': of('government-id-number'),
            ...(of('government-id-class') === undefined
              ? {}
              : { 'id-class': of('government-id-class') }),
          }),
        ]),
    ...(of('ip-address') === undefined ? [] : [probe('ip-address', { value: of('ip-address') })]),
    ...(of('country-code') === undefined
      ? []
      : [probe('country', { 'country-code': of('country-code') })]),
    ...(of('string') === undefined ? [] : [probe('string', { value: of('string') })]),
  ];
}

/** C106.2 (amendment 19): the report's match types; only these two methods have one. */
function matchTypesOf(method: FoundListMatch['method']): string[] {
  if (method === 'fuzzy_name') {
    return ['name_fuzzy'];
  }
  return method === 'exact' || method === 'cidr' ? ['identifier_exact'] : [];
}

function reportMatch(match: FoundListMatch, list: ListRow): FoundReportMatch {
  const entryKey = `${match.listId}:${match.listItemId}`;
  return {
    sourceId: match.listId,
    entryKey,
    contentHash: createHash('sha256').update(match.listItemId).digest('hex'),
    riskDataHash: null,
    matchedName: list.name,
    score: match.score ?? 1,
    snapshot: {
      list: {
        'list-id': list.id,
        'list-type': toListResourceType(list.type),
        name: list.name,
        version: match.listVersion,
      },
      entity: {
        'entity-id': entryKey,
        'list-item': { type: toListItemResourceType(list.type), id: match.listItemId },
        source: match.source,
        method: match.method,
        tier: match.tier,
        confidence: match.confidence,
        approximate: match.approximate,
        score: match.score,
        'distance-meters': match.distanceMeters,
        'matched-value': match.matchedValue,
      },
      'match-types': matchTypesOf(match.method),
      qualifiers: [],
      components: {
        'subject-name': null,
        'list-name': null,
        'name-level': null,
        methods: [match.method.replaceAll('_', '-')],
        preset: null,
        'min-score': null,
      },
    },
  };
}

async function run(ctx: ReportRunContext): Promise<RunOutcome> {
  const { report, deps } = ctx;
  const query = customListQuerySchema.safeParse(report.query);
  const pinned = report.config['list-ids'] as readonly string[] | null | undefined;
  const ids = pinned ?? (query.success ? query.data['list-ids'] : undefined);
  if (!query.success || ids === undefined) {
    return refused('insufficient_input');
  }
  const key = deps.blindIndexKey;
  if (key === undefined) {
    throw new Error('the worker has no blind index key for the custom-list report');
  }
  const { environmentId } = report;
  const lists = await getLists(deps.db, environmentId, ids);
  const held = new Map(lists.map((list) => [list.id, list]));
  const outcome = await matchLists(deps.db, environmentId, probesOf(report.query), {
    key,
    lists,
    matcherData: deps.matcherData?.(),
    ...(report.inquiryId === null ? { biometric: 'no_subject' as const } : {}),
  });
  const unscreened = [
    ...ids
      .filter((id) => !held.has(id))
      .map((id) => ({ 'list-id': id, reason: 'list_archived' as const })),
    ...outcome.unscreened,
  ];
  const unread = new Set(unscreened.map((entry) => entry['list-id']));
  const screenedAt = deps.clock.now().toISOString();
  const result: CustomListRunResult = {
    errors: [...unread].map((source) => ({ code: 'list_unavailable', source })),
    sources: [],
    listSources: lists
      .filter(({ id }) => !unread.has(id))
      .map((list) => ({
        'list-id': list.id,
        version: list.version,
        'normaliser-version': LIST_KEYS_VERSION,
        'item-count': list.itemCount,
        'screened-at': screenedAt,
      })),
    coverage: null,
    result: {
      'lists-searched': [...ids],
      unscreened,
      'not-applicable': outcome.notApplicable,
    },
    unavailableFields: [],
    provider: null,
    thresholds: null,
    notices: [],
    matcherVersion: null,
    matches: outcome.matches.flatMap((match) => {
      const list = held.get(match.listId);
      return list === undefined ? [] : [reportMatch(match, list)];
    }),
  };
  return { kind: 'completed', result };
}

export const customListReportJob: ReportTypeJob = { type: 'custom-list', run };
