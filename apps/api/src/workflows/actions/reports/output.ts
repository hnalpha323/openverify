/**
 * C127.2, outcome 15: a report as a step reads it. `has-match`, `match-count` and `flagged` are `null`
 * unless the report is `ready`, and `has-match` is `null` for a type of review model `none`, whose own
 * flag carries the result. Everything here is an id or a code; the hits stay on the report.
 */
import { REPORT_REGISTRY } from '@openverify/core';
import { listReportMatches, type Db, type StoredReport } from '@openverify/db';
import { ACTION_REPORT_TYPE_TABLE } from '@openverify/workflow-engine/actions';
import type { JsonRecord } from '@openverify/workflow-engine';
import { UNMASKED } from '../../../auth/pii.js';
import { reportResourceOf } from '../../../services/reports/reports.js';

interface MatchSnapshot {
  entity?: { method?: string; tier?: string; confidence?: number | null; approximate?: boolean };
  components?: { methods?: readonly string[] };
  'match-types'?: readonly string[];
}

/** C122.1 (H10): what the job stored of a match; a report type stores one of these shapes. */
export function matchFacts(snapshot: Record<string, unknown> | null, tier: string, score: number) {
  const { entity, components, 'match-types': types } = (snapshot ?? {}) as MatchSnapshot;
  const heuristic = entity?.tier ?? tier;
  return {
    method: entity?.method ?? components?.methods?.[0] ?? types?.[0] ?? 'not_recorded',
    tier: heuristic,
    confidence: entity?.confidence === undefined ? score : entity.confidence,
    approximate: entity?.approximate ?? heuristic === 'H',
  };
}

export async function reportOutputOf(tx: Db, report: StoredReport): Promise<JsonRecord> {
  const { reportType: type, status } = report;
  const entry = ACTION_REPORT_TYPE_TABLE[type];
  const ready = status === 'ready';
  const resource = (await reportResourceOf(tx, report, UNMASKED)) as unknown as {
    attributes: Readonly<Record<string, unknown>>;
  };
  const { attributes } = resource;
  const { tiers, stage } = REPORT_REGISTRY[type];
  const tier = tiers.includes('H') ? 'H' : (tiers[0] ?? 'R');
  const matches = entry.hasMatch
    ? await listReportMatches(tx, report.environmentId, report.id)
    : [];
  const open = matches.filter((match) => match.status === 'open');
  const unavailable = (attributes['unavailable-fields'] ?? []) as readonly { field: string }[];
  const errors = (attributes.errors ?? []) as readonly { code: string }[];
  return {
    'report-id': report.id,
    'report-type': type,
    'review-model': entry.review,
    status,
    'has-match': ready && entry.hasMatch ? report.hasMatch : null,
    'match-count': ready ? open.length : null,
    coverage: (attributes.coverage ?? null) as JsonRecord | null,
    'unavailable-fields': unavailable.map(({ field }) => field),
    errors: errors.map(({ code }) => code),
    matches: open.map(({ id, score, snapshot }) => ({
      id,
      stage,
      ...matchFacts(snapshot, tier, score),
    })),
    flagged: ready && entry.flag !== null ? attributes[entry.flag] === true : null,
  };
}
