/**
 * Reports in words (C69.3, C69.4, C73.2, C74, C78.5, C84.2, C86): why a report or run errored,
 * what a run noted, how completely it compared, why a field is unavailable, the notices a result
 * carries, and the labels of the history, monitoring and provenance values. Each list is keyed by
 * its contract vocabulary, so a value added to `@openverify/core` or `@openverify/contracts`
 * without words fails the typecheck, and each test iterates the contract's list first. A value
 * the console has no words for shows as its code.
 *
 * Honesty (ADR 0005): an errored report was not screened, so no word here reads as "no match".
 */
import type {
  REPORT_NOTICES,
  REPORT_QUERY_SOURCES,
  REPORT_UNAVAILABLE_REASONS,
  ReportResourceOrigin,
} from '@openverify/contracts';
import type {
  ReportActionType,
  ReportCoverageLimit,
  ReportErrorCode,
  ReportPausedReason,
  ReportRunNote,
  ReportRunStatus,
  ReportRunType,
  ReportType,
} from '@openverify/core';

export type ReportUnavailableReason = (typeof REPORT_UNAVAILABLE_REASONS)[number];
export type ReportNotice = (typeof REPORT_NOTICES)[number];
export type ReportQuerySourceName = (typeof REPORT_QUERY_SOURCES)[number];

/** An error code in words: a short title and what it means. */
export interface ReportErrorWords {
  readonly title: string;
  /**
   * What happened. For a code that names its source, it starts with "A selected list", which
   * {@link reportErrorText} replaces with the source's id.
   */
  readonly detail: string;
}

/** C69.3: each error code, as `docs/reports/README.md` ("Errors") explains it. */
export const REPORT_ERROR_WORDS: Readonly<Record<ReportErrorCode, ReportErrorWords>> =
  Object.freeze({
    insufficient_input: {
      title: 'Not enough input',
      detail:
        'The query lacks what this type needs, so nothing was screened (for a report made when an inquiry completed: the inquiry held no such value).',
    },
    list_unavailable: {
      title: 'List not available',
      detail:
        'A selected list has never been synced or checked, is not configured, or was disabled, so it was not screened.',
    },
    list_stale: {
      title: 'List out of date',
      detail:
        'A selected list was not checked successfully within its stale limit or the template’s maximum list age, so it was not screened.',
    },
    result_truncated: {
      title: 'Search cut short',
      detail:
        'The search reached its cap and found nothing, so it cannot say that nothing is there.',
    },
    matcher_data_unavailable: {
      title: 'Matcher data missing',
      detail:
        'A selected list was keyed by another matcher version, or the name variant groups are missing, so it was not screened. A re-key or a sync fixes it.',
    },
    provider_not_configured: {
      title: 'No provider bound',
      detail: 'No provider is bound for this report in this environment, so nothing was searched.',
    },
    provider_error: {
      title: 'Provider failed',
      detail: 'The provider failed on the last attempt, or the run waited 24 hours for its budget.',
    },
    execution_error: {
      title: 'Run failed',
      detail: 'The run failed on its last attempt.',
    },
  });

/** C73.2: what a run records beside its result. */
export const REPORT_RUN_NOTE_WORDS: Readonly<Record<ReportRunNote, string>> = Object.freeze({
  inquiry_already_decided:
    'The inquiry was decided before this report finished, so the report did not change it.',
  report_match: 'A match sent the inquiry to review.',
  report_errored: 'The report could not screen, so it sent the inquiry to review.',
  recurring_limit:
    'Monitoring did not start: the environment holds its cap of recurring reports or of scheduled media runs, so the report ran once.',
  evidence_changed: 'A matched list entry changed; its open match was updated in place.',
  risk_data_changed:
    'A matched entry’s risk data changed (a programme, listing date, position or relation).',
  match_not_found_in_run:
    'This run did not find an open match again; it stays open until a person dismisses it.',
});

/** C78.5, C81.5: why a run did not compare every name, or searched less than everything. */
export const REPORT_COVERAGE_LIMIT_WORDS: Readonly<Record<ReportCoverageLimit, string>> =
  Object.freeze({
    lossy_script:
      'A name was compared only through a lossy transliteration, so a miss is weaker evidence.',
    not_compared: 'A name in a script with no keys was not compared at all.',
    truncated: 'The search reached its cap, so not every candidate was compared.',
    unclassified_format:
      'The address is in no known format and was compared as its trimmed text only.',
    title_only: 'Relevance is read from article titles only.',
    window_90_days: 'Only the last 90 days of news were searched.',
    lexicon_languages: 'The terms are in English, Spanish, French and German only.',
  });

/**
 * Owner decision 6 after 6B: what complete coverage of a name screening does not promise, shown
 * beside "Complete", in the sentence `matcher-6c` proposed. `docs/reports/watchlist.md` ("What
 * complete coverage does not promise") says each part, and the test reads it there.
 */
export const COMPLETE_COVERAGE_WORDS =
  'Complete coverage does not promise romanisations outside the variant groups and ICAO’s tables, unknown spellings, or typos beyond the budget.';

/**
 * The report types whose coverage says how the subject's names were compared, so the sentence
 * above applies: a crypto address is compared exactly, and media relevance has its own limits.
 */
export const NAME_SCREENING_TYPES: ReadonlySet<ReportType> = new Set<ReportType>([
  'watchlist',
  'business-watchlist',
  'politically-exposed-person',
]);

/** C69.4: why a field is `null` and listed in `unavailable-fields`. */
export const REPORT_UNAVAILABLE_REASON_WORDS: Readonly<Record<ReportUnavailableReason, string>> =
  Object.freeze({
    provider_not_configured: 'No provider is bound for it in this environment.',
    not_confirmed: 'The inquiry did not confirm this value with a one-time code.',
    not_linked: 'Only a report made when an inquiry completed can say this, and this one was not.',
    line_type_undetermined:
      'The numbering plan cannot tell a fixed line from a mobile, and no provider said.',
    unsupported_country: 'The provider covers US addresses only, so nothing was sent.',
    list_not_configured: 'This list is not built, so it was not searched.',
    undetermined: 'The rule could not decide it.',
    execution_error: 'The lookup failed on the last attempt.',
    no_adapter: 'No provider for it exists yet.',
    no_documented_method: 'No documented method computes it.',
    // C106.1 (Phase 7): the network reasons.
    list_stale: 'The network data it needs is stale.',
    list_unavailable: 'The network data it needs has not been synced.',
    ipv6_not_covered: 'The exit list has no IPv6 exits, so an IPv6 address cannot be checked.',
    address_not_public: 'The address is not a public address.',
    not_in_known_ranges: 'Not in the lists we hold, which are not exhaustive.',
    not_in_provider_data: 'Not flagged in the provider’s file, which flags rather than clears.',
    client_address_untrusted: 'The client could choose this address, so it is not judged.',
  });

/** C79.2, C80.5, C81.5: what a result always says about what it cannot say. */
export const REPORT_NOTICE_WORDS: Readonly<Record<ReportNotice, string>> = Object.freeze({
  no_ownership_screening:
    'This is not ownership screening: a company owned by a listed party is not found unless it is listed itself.',
  pep_coverage_uneven:
    'Wikidata’s coverage is uneven by country and level, and dates are often missing: a miss is not evidence that the person is not politically exposed.',
  media_coverage_limited:
    'No match means no title mention in the 90-day window, not that there is no coverage anywhere.',
});

export const REPORT_RUN_TYPE_LABELS: Readonly<Record<ReportRunType, string>> = Object.freeze({
  initial: 'Initial',
  scheduled: 'Scheduled',
  manual: 'Run now',
  list_update: 'List update',
});

/** A run's status is about processing; an errored run was not screened (C69.4). */
export const REPORT_RUN_STATUS_LABELS: Readonly<Record<ReportRunStatus, string>> = Object.freeze({
  pending: 'Pending',
  running: 'Running',
  ready: 'Ready',
  errored: 'Errored (not screened)',
});

export const REPORT_ACTION_TYPE_LABELS: Readonly<Record<ReportActionType, string>> = Object.freeze({
  dismiss: 'Dismissed',
  review: 'Reviewed',
  pause: 'Monitoring paused',
  resume: 'Monitoring resumed',
  run: 'Run requested',
  redact: 'Redacted',
});

/**
 * Owner decision 12: a `redact` action by the system is an inquiry's or account's redaction
 * reaching its reports, or the `report-retention-days` setting.
 */
export const REDACTED_BY_SYSTEM =
  'System: the redaction of its inquiry or account, or the report retention setting';

export const REPORT_ORIGIN_LABELS: Readonly<Record<ReportResourceOrigin, string>> = Object.freeze({
  inquiry_completion: 'Inquiry completion',
  api: 'API',
  dashboard: 'Console',
  workflow: 'Workflow',
  // C166.5 (Workflow 9B): a report a bulk job created from a CSV row.
  bulk: 'Bulk upload',
});

export const REPORT_PAUSED_REASON_LABELS: Readonly<Record<ReportPausedReason, string>> =
  Object.freeze({
    operator: 'Paused by an operator',
    match: 'Paused on a match',
  });

/** C84.2: where a query field came from. */
export const REPORT_QUERY_SOURCE_LABELS: Readonly<Record<ReportQuerySourceName, string>> =
  Object.freeze({
    request: 'Sent with the request',
    government_id: 'Government ID extraction',
    inquiry_fields: 'Inquiry fields',
    account_fields: 'Account fields',
    otp_confirmed: 'Confirmed by a one-time code',
    crypto_wallet: 'Crypto wallet verification',
    business_registry: 'Business registry record',
    business_entered: 'Business name entered',
    // C106.1 (Phase 7).
    inquiry_session: 'The first evaluated session',
    // C106.2 (Workflow 7B).
    government_id_country: 'The issuing country of the government ID',
  });

/** How the detail of a code that names its source starts. */
const SELECTED_LIST = 'A selected list';

// A map, so a code such as `constructor` never reaches `Object.prototype`.
const ERRORS: ReadonlyMap<string, ReportErrorWords> = new Map(Object.entries(REPORT_ERROR_WORDS));

/** An error in words, naming its source; `undefined` for a code without words. */
export function reportErrorText(error: {
  readonly code: string;
  readonly source?: string | undefined;
}): ReportErrorWords | undefined {
  const words = ERRORS.get(error.code);
  if (words === undefined) {
    return undefined;
  }
  if (error.code === 'list_unavailable' && error.source === undefined) {
    return { title: words.title, detail: 'No list was selected, so nothing was screened.' };
  }
  return {
    title: words.title,
    detail:
      error.source === undefined || !words.detail.startsWith(SELECTED_LIST)
        ? words.detail
        : `${error.source}${words.detail.slice(SELECTED_LIST.length)}`,
  };
}
