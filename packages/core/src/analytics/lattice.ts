/**
 * C164.7, C164.8 (Phase 9, Workflow 9B; review P21; `analytics-logic`): the time axis of an answer.
 * A window of whole local days (both ends included) is a lattice of nodes: its days, its weeks
 * (Monday to Sunday, ISO 8601, cut to the window), its months (cut to the window) and its total.
 * Complementary suppression runs over the whole lattice whatever `bucket` is asked, so a day answer,
 * a week answer and a month answer of one window hide the same cells (re-exported through
 * `suppression.ts`, since the index is frozen).
 */
import { ANALYTICS_MAX_RANGE_DAYS, type AnalyticsBucket } from './definitions.js';
import { AnalyticsInputError } from './errors.js';

export type AnalyticsTimeNodeKind = 'day' | 'week' | 'month' | 'total';

/** One node: its id, its first and last local day in the window, and those days in order. */
export interface AnalyticsTimeNode {
  /** `day:YYYY-MM-DD`, `week:<first day in the window>`, `month:YYYY-MM` or `total`. */
  readonly id: string;
  readonly kind: AnalyticsTimeNodeKind;
  readonly start: string;
  readonly end: string;
  readonly days: readonly string[];
}

export interface AnalyticsTimeLattice {
  readonly from: string;
  readonly to: string;
  readonly days: readonly AnalyticsTimeNode[];
  readonly weeks: readonly AnalyticsTimeNode[];
  readonly months: readonly AnalyticsTimeNode[];
  readonly total: AnalyticsTimeNode;
}

const DAY_MS = 86_400_000;
const LOCAL_DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

/** A local date as a whole number of days since 1970-01-01, refusing anything else. */
function dayNumber(date: string, what: string): number {
  const time = LOCAL_DATE.test(date) ? Date.parse(`${date}T00:00:00Z`) : Number.NaN;
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date) {
    throw new AnalyticsInputError(`${what} must be a local date YYYY-MM-DD`);
  }
  return time / DAY_MS;
}

const dateOf = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

function node(id: string, kind: AnalyticsTimeNodeKind, days: readonly string[]): AnalyticsTimeNode {
  return Object.freeze({
    id,
    kind,
    start: days[0] ?? '',
    end: days[days.length - 1] ?? '',
    days: Object.freeze([...days]),
  });
}

/** Consecutive runs of `days` that share `keyOf(day)`, in order. */
function runs(days: readonly string[], keyOf: (day: string, index: number) => string) {
  const out: { key: string; days: string[] }[] = [];
  days.forEach((day, index) => {
    const key = keyOf(day, index);
    const last = out[out.length - 1];
    if (last?.key === key) {
      last.days.push(day);
    } else {
      out.push({ key, days: [day] });
    }
  });
  return out;
}

/**
 * The lattice of the window `from` to `to` (local dates, both included, at most
 * `ANALYTICS_MAX_RANGE_DAYS`). A week starts on Monday (ISO 8601); weeks and months are cut to the
 * window, so a week across two months lies in both of its months' cells.
 */
export function analyticsTimeLattice(from: string, to: string): AnalyticsTimeLattice {
  const first = dayNumber(from, 'from');
  const last = dayNumber(to, 'to');
  const length = last - first + 1;
  if (length < 1) {
    throw new AnalyticsInputError('to must not be before from');
  }
  if (length > ANALYTICS_MAX_RANGE_DAYS) {
    throw new AnalyticsInputError(`the window is at most ${String(ANALYTICS_MAX_RANGE_DAYS)} days`);
  }
  const dates = Array.from({ length }, (_, index) => dateOf(first + index));
  // 1970-01-01 was a Thursday: day n is a Monday when (n + 3) mod 7 is 0.
  const weekOf = (_day: string, index: number) => {
    const number = first + index;
    return dateOf(number - ((((number + 3) % 7) + 7) % 7));
  };
  const lattice: AnalyticsTimeLattice = {
    from,
    to,
    days: Object.freeze(dates.map((day) => node(`day:${day}`, 'day', [day]))),
    weeks: Object.freeze(
      runs(dates, weekOf).map((run) => node(`week:${run.days[0] ?? ''}`, 'week', run.days)),
    ),
    months: Object.freeze(
      runs(dates, (day) => day.slice(0, 7)).map((run) =>
        node(`month:${run.key}`, 'month', run.days),
      ),
    ),
    total: node('total', 'total', dates),
  };
  return Object.freeze(lattice);
}

/** The nodes an answer of `bucket` lists, in order. */
export function analyticsBucketNodes(
  lattice: AnalyticsTimeLattice,
  bucket: AnalyticsBucket,
): readonly AnalyticsTimeNode[] {
  return bucket === 'day' ? lattice.days : bucket === 'week' ? lattice.weeks : lattice.months;
}
