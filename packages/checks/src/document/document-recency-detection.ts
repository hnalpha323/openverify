/**
 * `document_recency_detection` (R, user behaviour, required, ours; C60.6, V13): the document is
 * recent, by the feature table: a lease's term or end date covers today; a tax document was issued
 * within 18 months; any other class was issued within `max-age-days`, else `document_too_old`.
 * No issue date, two different ones, a date more than one day in the future, or two readings that
 * disagree on the outcome answer `input_missing`; so does a lease whose term has ended (the expiry
 * check fails it, one mistake failing one check).
 */
import type { CheckResult } from '@openverify/core';
import { phase5CheckConfig, phase5ResultOptions } from '../contact/phase5-config.js';
import { daysBetween, parseIsoDate, utcToday, type CalendarDate } from '../dates.js';
import { checkResult, type CheckResultOptions } from '../result.js';
import type { DocumentContext } from './context.js';
import { addCalendarMonths, type DocumentDate } from './dates.js';
import { DOCUMENT_FEATURE_TABLE, TAX_DOCUMENT_MAX_AGE_MONTHS } from './feature-table.js';

const ID = 'document_recency_detection';

/** A date more than this many days ahead is in the future (C60.6). */
const FUTURE_SLACK_DAYS = 1;

type Outcome = 'recent' | 'old' | 'future' | 'unreadable';

/** One outcome for every reading, or `null` when they disagree. */
function agreed(date: DocumentDate, judge: (date: CalendarDate) => Outcome): Outcome | null {
  const outcomes = new Set(
    date.readings.map((reading) => {
      const parsed = parseIsoDate(reading);
      return parsed === null ? 'unreadable' : judge(parsed);
    }),
  );
  const [only] = outcomes;
  return outcomes.size === 1 && only !== undefined ? only : null;
}

export function documentRecencyDetection(context: DocumentContext): CheckResult {
  const config = phase5CheckConfig(context.template, ID);
  const { established, extraction } = context;
  if (established === null || extraction === null) {
    return checkResult(
      ID,
      'not_applicable',
      ['input_missing'],
      {},
      phase5ResultOptions(config, ['max-age-days']),
    );
  }
  const today = utcToday(context.now);
  const recency = DOCUMENT_FEATURE_TABLE[established].recency;
  const metadata = { 'document-class': established, 'date-source': extraction.issueDateSource };
  const missing = (flag: string, options: CheckResultOptions) =>
    checkResult(ID, 'not_applicable', ['input_missing'], { ...metadata, flags: [flag] }, options);

  if (recency === 'lease-term') {
    const options = {};
    if (extraction.expiryConflict) {
      return missing('expiry-conflict', options);
    }
    if (extraction.expiry === null) {
      return missing('no-term', options);
    }
    const start = extraction.leaseStart;
    if (start !== null) {
      const started = agreed(start, (date) =>
        daysBetween(today, date) > FUTURE_SLACK_DAYS ? 'future' : 'recent',
      );
      if (started !== 'recent') {
        return missing(started === null ? 'ambiguous-date' : 'not-started', options);
      }
    }
    const covers = agreed(extraction.expiry, (date) =>
      daysBetween(today, date) >= 0 ? 'recent' : 'old',
    );
    if (covers === 'recent') {
      return checkResult(ID, 'passed', [], metadata, options);
    }
    // An ended lease fails the expiry check; recency does not fail it again (H22).
    return missing(covers === null ? 'ambiguous-date' : 'term-ended', options);
  }

  const options: CheckResultOptions =
    recency === 'tax-document'
      ? {
          thresholds: { 'max-age-months': TAX_DOCUMENT_MAX_AGE_MONTHS },
          thresholdBasis: { 'max-age-months': 'provisional' },
        }
      : phase5ResultOptions(config, ['max-age-days']);
  if (extraction.issueDateConflict) {
    return missing('issue-date-conflict', options);
  }
  if (extraction.issueDate === null) {
    return missing('no-issue-date', options);
  }
  const maxAge = config.values['max-age-days'];
  const outcome = agreed(extraction.issueDate, (date) => {
    if (daysBetween(today, date) > FUTURE_SLACK_DAYS) {
      return 'future';
    }
    if (recency === 'tax-document') {
      return daysBetween(today, addCalendarMonths(date, TAX_DOCUMENT_MAX_AGE_MONTHS)) >= 0
        ? 'recent'
        : 'old';
    }
    return daysBetween(date, today) <= (typeof maxAge === 'number' ? maxAge : 0) ? 'recent' : 'old';
  });
  switch (outcome) {
    case 'recent':
      return checkResult(ID, 'passed', [], metadata, options);
    case 'old':
      return checkResult(ID, 'failed', ['document_too_old'], metadata, options);
    case 'future':
      return missing('future-date', options);
    default:
      return missing('ambiguous-date', options);
  }
}
