/**
 * C79.2 (Workflow 6A Stage 3, owner `api-reports`): the `business-watchlist` report job, behind
 * the frozen `ReportTypeJob` of `jobs/report-types/index.ts`. A business name (its legal form
 * compared by tag) and its exact identifiers, screened against the pinned sanctions lists; an IMO,
 * MMSI or aircraft identifier also meets vessels and aircraft. Not 50%-rule screening (decision
 * 17): every result says so; the warning and fitness-and-probity lists are not built (decision 18)
 * and stay `null` with `list_not_configured`.
 */
import type { BusinessCountryField, BusinessEntityKind, ReportFilterMode } from '@openverify/core';
import { businessSubject, type BusinessQuery } from '@openverify/watchlist';
import { countriesOf, screenNames, searchLists, type NameScreening } from '../reports/screening.js';
import type { ReportTypeJob } from './job.js';
import { listEvidence } from './record-evidence.js';

/** The screening of a `business-watchlist` report's query under its configuration. */
export function businessWatchlistScreening(
  query: Readonly<Record<string, unknown>>,
  config: Readonly<Record<string, unknown>>,
): NameScreening {
  const kinds = (config['entity-kinds'] as BusinessEntityKind[] | undefined) ?? ['entity'];
  return {
    type: 'business-watchlist',
    subject: () => businessSubject(query as unknown as BusinessQuery),
    options: {
      birthdateMatching: 'exact_date',
      birthdateFilter: 'off',
      countryFields: config['country-fields'] as BusinessCountryField[],
      countryFilter: config['country-filter'] as ReportFilterMode,
      screenWeakAliases: config['screen-weak-aliases'] === true,
      entityKinds: kinds,
    },
    // C78.4 (H06): identifiers search vessels and aircraft whatever `entity-kinds` says.
    entryKinds: ['entity', 'vessel', 'aircraft'],
    entity: (match, { record }) => ({
      'entity-id': match.entryKey,
      name: match.listName.slice(0, 300),
      'alias-type': match.aliasType,
      'match-types': [...match.matchTypes],
      kind: record.kind === 'individual' ? 'entity' : record.kind,
      countries: countriesOf(record),
      programs: record.programs.slice(0, 100),
      identifiers: record.identifiers.map((identifier) => ({
        kind: identifier.kind,
        value: identifier.value,
        country: identifier.country ?? null,
      })),
      ...listEvidence(record),
    }),
    notices: ['no_ownership_screening'],
    unavailableFields: [
      { field: 'fitness-probity-list', reason: 'list_not_configured' },
      { field: 'warning-list', reason: 'list_not_configured' },
    ],
    result: { 'lists-searched': searchLists(config) },
  };
}

export const businessWatchlistReportJob: ReportTypeJob = {
  type: 'business-watchlist',
  run: (ctx) => screenNames(ctx, businessWatchlistScreening(ctx.report.query, ctx.report.config)),
};
