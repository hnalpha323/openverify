/**
 * Each report type's honesty labels in words (ADR 0002, ADR 0005, C69.1, C86): its tiers and
 * stage, what a status means, and "What a result means" for each state of a result, as
 * `docs/reports/` says it. The test reads the pages, so a line the docs stop saying fails it.
 *
 * Honesty (C69.4): "no match" is said only beside `ready`; an errored report was not screened.
 */
import type { CheckStage, ReportStatus, ReportTier, ReportType } from '@openverify/core';
import { REPORT_REGISTRY } from '@openverify/core';

/** What a result of one type means in each state; a state without its own line says nothing. */
export interface ReportResultMeans {
  /** `ready` with `has-match: true` (types with review). */
  readonly match?: string;
  /** `ready` with `has-match: false` (types with review): beside the coverage. */
  readonly noMatch?: string;
  /** `ready` (types without review). */
  readonly ready?: string;
  /** Shown with every result of the type. */
  readonly always?: string;
}

/** ADR 0002 §1: what each tier of a result rests on. */
export const REPORT_TIER_WORDS: Readonly<Record<ReportTier, string>> = Object.freeze({
  R: 'R: real logic, exact and tested',
  H: 'H: a heuristic, with a confidence and its reasons',
  A: 'A: an adapter, a provider’s data',
});

export const REPORT_STAGE_LABELS: Readonly<Record<CheckStage, string>> = Object.freeze({
  ga: 'GA',
  beta: 'Beta',
  sunset: 'Sunset',
});

/** `docs/reports/README.md`: a status is about processing, never about the result. */
export const REPORT_STATUS_MEANS: Readonly<Record<ReportStatus, string>> = Object.freeze({
  pending: 'Created; its first run has not finished.',
  submitted: 'Submitted is reserved and no Phase 6 path uses it.',
  ready: 'Its latest run screened everything it was asked to.',
  errored: 'Its latest run could not screen something.',
});

/** The rule every type without review shares (`docs/reports/README.md`). */
const UNKNOWN_IS_NEVER_FALSE =
  'A field the run could not decide, or that needs a provider that is not bound, is null and listed in unavailable-fields with its reason.';

/** `docs/reports/<type>.md`, "What a result means". */
export const REPORT_RESULT_MEANS: Readonly<Record<ReportType, ReportResultMeans>> = Object.freeze({
  watchlist: {
    match:
      "At least one entry of a screened list matched the person at or above the template's minimum, or by an exact identifier.",
    noMatch:
      'Every selected list was screened, fresh, by the current matcher, over every name the query gave, and nothing reached the minimum.',
    always:
      'A match is a lead for a reviewer, never a decision: a common name can match many people, and a different person can share a listed name.',
  },
  'business-watchlist': {
    match:
      'An entry matched by name at or above the minimum, or by an exact identifier whatever the name says.',
    noMatch: 'Every selected list was screened and no entity matched.',
    always:
      'This is not ownership screening. A company owned 50% or more by a listed party is not found unless it is listed itself.',
  },
  'crypto-address-watchlist': {
    match: "A listed address has exactly the query's canonical form.",
    noMatch: 'No listed address has that canonical form on any selected list that was screened.',
    always: 'A match says the address is listed, not who controls it now.',
  },
  'politically-exposed-person': {
    match: 'A holder of a public position in the selected PEP classes matched by name.',
    noMatch:
      'Nobody in the mirror matched. A miss is not evidence that the person is not politically exposed.',
  },
  'adverse-media': {
    match:
      "At least one article title holds the person's whole name in order, or every token of it, and at least one category term.",
    noMatch:
      'No title in the window matched. This says no title mention, not no coverage anywhere.',
    always:
      "An article is a lead. The name may be someone else's, and the title is not the article.",
  },
  'business-adverse-media': {
    match: 'An article title names the company beside a category term.',
    noMatch: 'No title mention in the 90-day window, never "no coverage anywhere".',
  },
  'email-address': {
    ready:
      'The report is ready with every field it could compute. A field it could not decide, or that needs an unbound provider, is null and listed in unavailable-fields with its reason, never false.',
  },
  'phone-number': {
    ready: `${UNKNOWN_IS_NEVER_FALSE} With a provider bound, the network line type replaces the plan's.`,
  },
  'address-lookup': {
    ready: UNKNOWN_IS_NEVER_FALSE,
  },
  // C106.1 (Phase 7).
  'ip-address': {
    ready: UNKNOWN_IS_NEVER_FALSE,
  },
  // C106.2: as docs/reports/custom-list.md says it.
  'custom-list': {
    match: 'A value of the query is on one of your lists, by the method each match names.',
    noMatch: 'No match on the lists read. A list that could not be read errors the report.',
    always:
      'has-match: false means "no match" only beside ready, and a report is ready only when no selected list went unscreened.',
  },
});

/** The docs page of each type, under `docs/reports/`. */
export function reportDocsPage(type: ReportType): string {
  return `${type}.md`;
}

/**
 * What this result means, line by line: its status, its type's line for its state (a "no match"
 * line only beside `ready`), then what every result of the type says.
 */
export function resultMeansLines(
  type: ReportType,
  status: ReportStatus,
  hasMatch: boolean,
): string[] {
  const means = REPORT_RESULT_MEANS[type];
  const review = REPORT_REGISTRY[type].review === 'matches';
  const state =
    status !== 'ready'
      ? undefined
      : review
        ? hasMatch
          ? means.match
          : means.noMatch
        : means.ready;
  return [REPORT_STATUS_MEANS[status], state, means.always].filter(
    (line): line is string => line !== undefined,
  );
}
