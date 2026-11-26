/**
 * C80.2-C80.4: the PEP rules the sync applies to Wikidata's statements, as pure functions of a
 * frozen clock.
 *
 * - **Open-ended tenures** (C80.2, P12, H14). A `position held` statement without an end date may
 *   mean "in office" or "end unknown". It is current (`in_office: yes`) only when it has no
 *   successor statement (P1366), no later holder of a single-holder position, and a start within
 *   `openTenureMaxYears`. Otherwise it ended at the successor's or the later holder's start, or at
 *   an unknown date (`end: unknown`, `in_office: no`). A statement without a start cannot show
 *   that it started within the limit, so it is not current either. A start still to come reads
 *   `in_office: unknown` (an incoming holder), and counts as current for retention.
 * - **Retention** (C80.4, decision 9). A tenure keeps its holder while it is current or ended
 *   within `retentionMonths`, or `headRetentionMonths` for a national head of state or government;
 *   an unknown end counts as older than either.
 * - **Relatives** (C80.3). A relative is synced only with a stated birth date at least
 *   `relativeMinimumAgeYears` ago on every reading (never a possible minor), and only while a PEP
 *   it is linked to is kept (V13); the caller applies the install flag and excludes the deceased.
 *
 * Partial dates are read at the bound that keeps more people screened: a start or an end at the
 * latest instant its precision allows, a birth date at the latest too (so a possible minor is
 * never synced).
 */
import { partialDate } from '../parsers/normalise.js';

/** A default with its basis and source, as the other report constants are (ADR 0002 §3f). */
export interface PepRuleDefault {
  readonly value: number;
  readonly basis: 'provisional';
  readonly source: string;
}

/** C80.2-C80.4: the rule defaults the install's variables override. */
export const PEP_RULE_DEFAULTS = Object.freeze({
  /** `OPENVERIFY_PEP_OPEN_TENURE_MAX_YEARS`. */
  openTenureMaxYears: Object.freeze<PepRuleDefault>({
    value: 20,
    basis: 'provisional',
    source:
      'C80.2 (P12, H14), ours: the reference practice treats no tenure started over 40 years ago as current',
  }),
  /** `OPENVERIFY_PEP_RETENTION_MONTHS`. */
  retentionMonths: Object.freeze<PepRuleDefault>({
    value: 12,
    basis: 'provisional',
    source: 'C80.4, decision 9: twelve months after the last position ended, the EU minimum',
  }),
  /** `OPENVERIFY_PEP_HEAD_RETENTION_MONTHS`. */
  headRetentionMonths: Object.freeze<PepRuleDefault>({
    value: 60,
    basis: 'provisional',
    source: 'C80.4, decision 9: five years for national heads of state or government',
  }),
  /** Never a minor (C80.3, P12). */
  relativeMinimumAgeYears: Object.freeze<PepRuleDefault>({
    value: 18,
    basis: 'provisional',
    source: 'C80.3 (P12): a relative born less than 18 years ago is never synced',
  }),
});

export interface PepRuleOptions {
  readonly now: Date;
  readonly openTenureMaxYears?: number;
  readonly retentionMonths?: number;
  readonly headRetentionMonths?: number;
}

/** A `position held` statement as the rules read it. */
export interface TenureStatement {
  readonly person: string;
  readonly start: string | null;
  readonly end: string | null;
  readonly endStated: boolean;
  /** The successor's QID, `unknown`, or null for none stated. */
  readonly successor: string | null;
}

/** A tenure as the record states it (C77.1 `positions[]`). */
export interface Tenure {
  readonly start: string | null;
  readonly end: string | null;
  readonly in_office: 'yes' | 'no' | 'unknown';
}

function instant(year: number, month: number, day: number, end: boolean): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (end) {
    date.setUTCHours(23, 59, 59, 999);
  }
  return date.getTime();
}

function lastDay(year: number, month: number): number {
  return new Date(instant(year, month + 1, 0, false)).getUTCDate();
}

/** The earliest and latest instants (ms since the epoch, UTC) a partial date covers. */
export function partialDateBounds(value: string): { earliest: number; latest: number } {
  const [year = 0, month, day] = value.split('-').map(Number);
  if (month === undefined) {
    return { earliest: instant(year, 1, 1, false), latest: instant(year, 12, 31, true) };
  }
  if (day === undefined) {
    return {
      earliest: instant(year, month, 1, false),
      latest: instant(year, month, lastDay(year, month), true),
    };
  }
  return { earliest: instant(year, month, day, false), latest: instant(year, month, day, true) };
}

/** The same instant `months` calendar months earlier, its day clamped to the month's length. */
function monthsBefore(now: Date, months: number): Date {
  const total = now.getUTCFullYear() * 12 + now.getUTCMonth() - months;
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  const date = new Date(now.getTime());
  date.setUTCFullYear(year, month - 1, Math.min(now.getUTCDate(), lastDay(year, month)));
  return date;
}

const earliest = (value: string): number => partialDateBounds(value).earliest;
const latest = (value: string): number => partialDateBounds(value).latest;

/** The earliest start among `statements`, as its partial date. */
function firstStart(statements: readonly TenureStatement[]): string | null {
  let first: string | null = null;
  for (const { start } of statements) {
    if (start !== null && (first === null || earliest(start) < earliest(first))) {
      first = start;
    }
  }
  return first;
}

/**
 * C80.2: the tenure of `statement`, given every statement of the same position (itself
 * included) and whether the position has one holder at a time.
 */
export function tenureOf(
  statement: TenureStatement,
  position: readonly TenureStatement[],
  singleHolder: boolean,
  options: PepRuleOptions,
): Tenure {
  const now = options.now.getTime();
  const { start } = statement;
  if (start !== null && earliest(start) > now) {
    return { start, end: statement.end, in_office: 'unknown' };
  }
  if (statement.end !== null) {
    return { start, end: statement.end, in_office: latest(statement.end) >= now ? 'yes' : 'no' };
  }
  if (statement.endStated) {
    return { start, end: 'unknown', in_office: 'no' };
  }
  if (statement.successor !== null) {
    const successors = position.filter(
      (other) =>
        other.person === statement.successor &&
        other.start !== null &&
        (start === null || latest(other.start) >= earliest(start)),
    );
    return { start, end: firstStart(successors) ?? 'unknown', in_office: 'no' };
  }
  if (singleHolder && start !== null) {
    const later = position.filter(
      (other) =>
        other !== statement && other.start !== null && earliest(other.start) > latest(start),
    );
    const end = firstStart(later);
    if (end !== null) {
      return { start, end, in_office: 'no' };
    }
  }
  const limit = monthsBefore(
    options.now,
    12 * (options.openTenureMaxYears ?? PEP_RULE_DEFAULTS.openTenureMaxYears.value),
  ).getTime();
  if (start === null || latest(start) < limit) {
    return { start, end: 'unknown', in_office: 'no' };
  }
  return { start, end: null, in_office: 'yes' };
}

/** C80.4: whether a tenure keeps its holder, `head` for a national head of state or government. */
export function tenureRetained(tenure: Tenure, head: boolean, options: PepRuleOptions): boolean {
  if (tenure.in_office !== 'no') {
    return true;
  }
  if (tenure.end === null || tenure.end === 'unknown') {
    return false;
  }
  const months = head
    ? (options.headRetentionMonths ?? PEP_RULE_DEFAULTS.headRetentionMonths.value)
    : (options.retentionMonths ?? PEP_RULE_DEFAULTS.retentionMonths.value);
  return latest(tenure.end) >= monthsBefore(options.now, months).getTime();
}

/** C80.3: whether a relative with these birth dates may be synced. */
export function relativeMayBeSynced(
  birthDates: readonly string[],
  options: { readonly now: Date; readonly minimumAgeYears?: number },
): boolean {
  const years = options.minimumAgeYears ?? PEP_RULE_DEFAULTS.relativeMinimumAgeYears.value;
  const cutoff = monthsBefore(options.now, 12 * years);
  const day = partialDate(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, cutoff.getUTCDate());
  const lastBirth = day === null ? Number.NEGATIVE_INFINITY : latest(day);
  return birthDates.length > 0 && birthDates.every((birth) => latest(birth) <= lastBirth);
}
