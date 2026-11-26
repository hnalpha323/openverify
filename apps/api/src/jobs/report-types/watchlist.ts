/**
 * C79.1 (Workflow 6A Stage 3, owner `api-reports`): the `watchlist` report job, behind the frozen
 * `ReportTypeJob` of `jobs/report-types/index.ts`. A person's names (and any `additional-names`),
 * birth date, country, gender and identification number, screened against the pinned sanctions
 * lists with the template's preset and filters (`jobs/reports/screening.ts`).
 */
import type { BirthdateMatchingMode, PersonCountryField, ReportFilterMode } from '@openverify/core';
import { personSubject } from '@openverify/watchlist';
import {
  birthdatesOf,
  countriesOf,
  screenNames,
  type NameScreening,
} from '../reports/screening.js';
import type { ReportTypeJob } from './job.js';
import { listEvidence } from './record-evidence.js';

/** The screening of a `watchlist` report's query under its configuration (the re-screen's too). */
export function watchlistScreening(
  query: Readonly<Record<string, unknown>>,
  config: Readonly<Record<string, unknown>>,
): NameScreening {
  return {
    type: 'watchlist',
    subject: () => personSubject(query),
    options: {
      birthdateMatching: config['birthdate-matching'] as BirthdateMatchingMode,
      birthdateFilter: config['birthdate-filter'] as ReportFilterMode,
      countryFields: config['country-fields'] as PersonCountryField[],
      countryFilter: config['country-filter'] as ReportFilterMode,
      screenWeakAliases: config['screen-weak-aliases'] === true,
    },
    entryKinds: ['individual'],
    entity: (match, { record }) => ({
      'entity-id': match.entryKey,
      name: match.listName.slice(0, 300),
      'alias-type': match.aliasType,
      'match-types': [...match.matchTypes],
      birthdates: birthdatesOf(record),
      countries: countriesOf(record),
      programs: record.programs.slice(0, 100),
      ...listEvidence(record),
    }),
    notices: [],
    unavailableFields: [],
  };
}

export const watchlistReportJob: ReportTypeJob = {
  type: 'watchlist',
  run: (ctx) => screenNames(ctx, watchlistScreening(ctx.report.query, ctx.report.config)),
};
