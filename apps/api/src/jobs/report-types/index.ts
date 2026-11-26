/**
 * C69-C82 (Workflow 6A Stage 1b): the per-type report job hooks, one file per type
 * (`jobs/report-types/<type>.ts`), gathered here. The run framework (`jobs/reports/`, owned by
 * `api-reports`) claims a run, builds its {@link ReportRunContext}, calls the type's `run` and
 * persists the {@link RunOutcome} fenced by its claim (C74.1): the match state machine, the report
 * columns, events, `on-report-match` and the schedule are the framework's; what to search and
 * what was found are the type's.
 *
 * Owners: `api-reports` builds `watchlist`, `business-watchlist`, `crypto-address-watchlist` and
 * `politically-exposed-person`; `api-providers` builds `adverse-media`, `business-adverse-media`,
 * `email-address`, `phone-number` and `address-lookup`. This file and its types are frozen by
 * `foundation-6`; a change is a plan amendment. A type not built yet fails its runs with
 * {@link ReportTypeNotBuiltError}, which the framework ends `errored` with `execution_error`, so
 * nothing reads as screened.
 */
import type { ReportType } from '@openverify/core';
import { addressLookupReportJob } from './address-lookup.js';
import { adverseMediaReportJob } from './adverse-media.js';
import { businessAdverseMediaReportJob } from './business-adverse-media.js';
import { businessWatchlistReportJob } from './business-watchlist.js';
import { cryptoAddressWatchlistReportJob } from './crypto-address-watchlist.js';
import { customListReportJob } from './custom-list.js';
import { emailAddressReportJob } from './email-address.js';
import { ipAddressReportJob } from './ip-address.js';
import type { ReportTypeJob } from './job.js';
import { phoneNumberReportJob } from './phone-number.js';
import { politicallyExposedPersonReportJob } from './politically-exposed-person.js';
import { watchlistReportJob } from './watchlist.js';

export * from './job.js';

/** Every report type's job (C69.1), in the order of `REPORT_TYPES`. */
export const REPORT_TYPE_JOBS: Readonly<Record<ReportType, ReportTypeJob>> = Object.freeze({
  watchlist: watchlistReportJob,
  'business-watchlist': businessWatchlistReportJob,
  'crypto-address-watchlist': cryptoAddressWatchlistReportJob,
  'politically-exposed-person': politicallyExposedPersonReportJob,
  'adverse-media': adverseMediaReportJob,
  'business-adverse-media': businessAdverseMediaReportJob,
  'email-address': emailAddressReportJob,
  'phone-number': phoneNumberReportJob,
  'address-lookup': addressLookupReportJob,
  // C106.1 (Phase 7): built by `api-network`.
  'ip-address': ipAddressReportJob,
  // C106.2 (Workflow 7B): built by `api-lists`.
  'custom-list': customListReportJob,
});

/** The job of `type`. */
export function reportTypeJob(type: ReportType): ReportTypeJob {
  return REPORT_TYPE_JOBS[type];
}
