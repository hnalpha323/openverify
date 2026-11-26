/**
 * C164.8 (Workflow 9B, `api-analytics`): one read of `GET /api/v1/analytics/<report>`: the caller's
 * one environment (sandbox and production never mix, A13), the window's rows after every filter
 * (`read.ts`), and the suppressed answer (`answers.ts`).
 *
 * A filter the report's rollups cannot apply is refused (400), never ignored: the step, verification
 * and check rollups have no device dimension, so the funnel, verifications and checks answers refuse
 * `filter[platform]` and `filter[device-kind]` rather than answer unfiltered as if filtered.
 */
import type { AnalyticsBucket, AnalyticsReport } from '@openverify/core';
import type { Db } from '@openverify/db';
import { BadRequestError } from '../../errors.js';
import type { Clock } from '../../ports.js';
import {
  answerId,
  casesAnswer,
  checksAnswer,
  funnelAnswer,
  inquiriesAnswer,
  signalsAnswer,
  verificationsAnswer,
  type AnswerInput,
} from './answers.js';
import { readContext, readWindow, rollupsNamed, type AnalyticsFilters } from './read.js';

/** The query of any of the six reads, as the route's schema parsed it. */
export type AnalyticsQuery = Readonly<Record<string, string | undefined>>;

export interface AnalyticsReader {
  environmentId: string;
  /** The reader holds `users:write`, and may see the per-reviewer distribution (review P20). */
  mayReadAssignees: boolean;
}

const DEVICE_FILTERS = ['filter[platform]', 'filter[device-kind]'] as const;
const WITHOUT_DEVICE: ReadonlySet<AnalyticsReport> = new Set(['funnel', 'verifications', 'checks']);

/** The rows each answer reads, by their `rows` name. */
function rowsRead(report: AnalyticsReport, query: AnalyticsQuery, reader: AnalyticsReader) {
  switch (report) {
    case 'inquiries':
      if (query['filter[tag]'] !== undefined) {
        return ['tag'];
      }
      return DEVICE_FILTERS.some((filter) => query[filter] !== undefined)
        ? ['inquiry']
        : ['inquiry', 'step', 'transition', 'path'];
    case 'funnel':
      return ['inquiry', 'step', 'transition', 'path'];
    case 'verifications':
    case 'checks':
      return ['verification', 'verificationStep', 'check', 'checkReason'];
    case 'cases':
      return reader.mayReadAssignees ? ['case', 'assignee'] : ['case'];
    case 'signals':
      return ['signal'];
  }
}

export async function readAnalyticsAnswer(
  deps: { db: Db; clock: Clock },
  report: AnalyticsReport,
  query: AnalyticsQuery,
  reader: AnalyticsReader,
): Promise<unknown> {
  if (WITHOUT_DEVICE.has(report)) {
    const filter = DEVICE_FILTERS.find((name) => query[name] !== undefined);
    if (filter !== undefined) {
      throw new BadRequestError(
        `${filter} does not apply to the ${report} answer: its rollups have no device dimension.`,
      );
    }
  }
  const context = await readContext(deps.db, reader.environmentId, deps.clock.now());
  const filters: AnalyticsFilters = {
    inquiryTemplateId: query['filter[inquiry-template-id]'],
    inquiryTemplateVersionId: query['filter[inquiry-template-version-id]'],
    platform: query['filter[platform]'],
    deviceKind: query['filter[device-kind]'],
    tag: query['filter[tag]'],
    caseTemplateId: query['filter[case-template-id]'],
  };
  const names = rowsRead(report, query, reader);
  const window = await readWindow(deps.db, context, {
    from: query['filter[from]'] ?? '',
    to: query['filter[to]'] ?? '',
    rollups: rollupsNamed(...names),
    filters,
  });
  const input: AnswerInput = {
    context,
    window,
    bucket: (query.bucket ?? 'day') as AnalyticsBucket,
    id: answerId(report, query),
    withFunnel: names.includes('step'),
  };
  switch (report) {
    case 'inquiries':
      return inquiriesAnswer(input, query['filter[tag]'] !== undefined);
    case 'funnel':
      return funnelAnswer(input);
    case 'verifications':
      return verificationsAnswer(input);
    case 'checks':
      return checksAnswer(input);
    case 'cases':
      return casesAnswer(input, reader.mayReadAssignees);
    case 'signals':
      return signalsAnswer(input);
  }
}
