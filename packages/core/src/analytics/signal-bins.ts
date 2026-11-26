/**
 * C164.6 (Phase 9, Workflow 9B; K8): the fixed bins `analytics_signal_daily` stores for each signal
 * of Phase 7's registry, over a period, with the signal's tier and stage beside every figure. The
 * registry has no bins member (only `valueType`, `values` and `range`), so they are named here
 * (ours, provisional, from each signal's value type and range; none is tuned on data):
 * - an enum or a boolean: one bin per value the registry allows (a never-false flag has only `true`);
 * - `inquiry/country_from_session`: one bin per ISO 3166-1 alpha-2 code, the code itself;
 * - an integer: ranges named `<low>-<high>`, or `<n>` for one value and `<n>+` for the open end.
 *
 * A `null` value counts as `not-evaluated`, never as a bin. `inquiry/list_match_count` is never in a
 * stored signals array: the rollup reads it from `list_screenings` (a completed screening's
 * `match_count`; any other status, or no screening, is `not-evaluated`; Phase 7 C99). `SIGNAL_BINS`
 * and `SIGNAL_NOT_EVALUATED_BIN` are frozen by `contracts-9b`; `signalBinOf` is `analytics-logic`'s.
 *
 * `inquiry/max_session_distance` is stored in metres (its registry `unit`), and its bins read in
 * whole kilometres, so a value is binned as `floor(metres / 1000)`.
 */
import { SIGNAL_REGISTRY, type SignalDefinition } from '../signal-registry.js';
import type { ListScreeningStatus } from '../lists.js';
import { AnalyticsInputError, assertCount } from './errors.js';

/** The bin of a signal whose value is `null` (C164.6). */
export const SIGNAL_NOT_EVALUATED_BIN = 'not-evaluated';

/** How a signal's values are binned. */
export type SignalBins =
  { readonly kind: 'fixed'; readonly bins: readonly string[] } | { readonly kind: 'country' };

const fixed = (...bins: string[]): SignalBins =>
  Object.freeze({ kind: 'fixed', bins: Object.freeze(bins) });

/** By registry name, every signal of `SIGNAL_REGISTRY` (a test holds the two lists equal). */
export const SIGNAL_BINS: Readonly<Record<string, SignalBins>> = Object.freeze({
  'inquiry/bot_score': fixed(
    '0-9',
    '10-19',
    '20-29',
    '30-39',
    '40-49',
    '50-59',
    '60-69',
    '70-79',
    '80-89',
    '90-100',
  ),
  'inquiry/behavior_threat_level': fixed('low', 'medium', 'high'),
  'inquiry/automation_artefact_count': fixed('0', '1', '2-4', '5+'),
  'inquiry/session_count': fixed('0', '1', '2', '3-5', '6+'),
  'inquiry/network_threat_level': fixed('low', 'medium', 'high'),
  'inquiry/tor_detected': fixed('true', 'false'),
  'inquiry/datacenter_detected': fixed('true'),
  'inquiry/vpn_detected': fixed('true'),
  'inquiry/proxy_detected': fixed('true', 'false'),
  'inquiry/country_from_session': Object.freeze({ kind: 'country' }),
  'inquiry/country_comparison': fixed('same', 'different'),
  /** Kilometres. */
  'inquiry/max_session_distance': fixed('0-49', '50-499', '500-1999', '2000+'),
  'inquiry/handoff_count': fixed('0', '1', '2', '3+'),
  'inquiry/list_match_count': fixed('0', '1', '2-4', '5+'),
  // Workflow 10B (C210.4, C211.5): true or null; the levels; true or false.
  'inquiry/device_emulated': fixed('true'),
  'inquiry/device_rooted': fixed('true'),
  'inquiry/device_hooked': fixed('true'),
  'inquiry/device_integrity_level': fixed('strong', 'device', 'basic', 'none'),
  'inquiry/app_recognized': fixed('true', 'false'),
});

/** An integer bin's bounds, both included; `high` is `null` for the open end. */
interface IntegerBin {
  readonly name: string;
  readonly low: number;
  readonly high: number | null;
}

// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const INTEGER_BIN_NAME = /^(0|[1-9][0-9]*)(?:-(0|[1-9][0-9]*)|(\+))?$/;

function integerBin(name: string): IntegerBin {
  const match = INTEGER_BIN_NAME.exec(name);
  if (match === null) {
    throw new AnalyticsInputError(`${name} is not an integer bin`);
  }
  const low = Number(match[1]);
  if (match[3] === '+') {
    return { name, low, high: null };
  }
  return { name, low, high: match[2] === undefined ? low : Number(match[2]) };
}

const INTEGER_BINS = new Map<string, readonly IntegerBin[]>(
  SIGNAL_REGISTRY.filter((signal) => signal.valueType === 'integer').map((signal) => {
    const entry = SIGNAL_BINS[signal.name];
    return [signal.name, entry?.kind === 'fixed' ? entry.bins.map(integerBin) : []];
  }),
);

const REGISTRY = new Map<string, SignalDefinition>(
  SIGNAL_REGISTRY.map((signal) => [signal.name, signal]),
);

const COUNTRY_CODE = /^[A-Z]{2}$/;

const outside = (name: string) =>
  new AnalyticsInputError(`${name}: the value is outside the signal's bins`);

/** The bin of `value` for the signal `name`: `SIGNAL_NOT_EVALUATED_BIN` for `null`. */
export function signalBinOf(name: string, value: unknown): string {
  const signal = REGISTRY.get(name);
  const entry = SIGNAL_BINS[name];
  if (signal === undefined || entry === undefined) {
    throw new AnalyticsInputError('the signal is not in the registry');
  }
  if (value === null) {
    return SIGNAL_NOT_EVALUATED_BIN;
  }
  if (entry.kind === 'country') {
    if (typeof value === 'string' && COUNTRY_CODE.test(value)) {
      return value;
    }
    throw outside(name);
  }
  if (signal.valueType === 'integer') {
    return integerBinOf(signal, value);
  }
  const bin =
    signal.valueType === 'boolean' && typeof value === 'boolean'
      ? String(value)
      : signal.valueType === 'enum' && typeof value === 'string'
        ? value
        : null;
  if (bin === null || !entry.bins.includes(bin)) {
    throw outside(name);
  }
  return bin;
}

function integerBinOf(signal: SignalDefinition, value: unknown): string {
  const max = signal.range?.max ?? null;
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < (signal.range?.min ?? 0) ||
    (max !== null && value > max)
  ) {
    throw outside(signal.name);
  }
  const binned = signal.unit === 'meters' ? Math.floor(value / 1000) : value;
  const bin = (INTEGER_BINS.get(signal.name) ?? []).find(
    (candidate) => binned >= candidate.low && (candidate.high === null || binned <= candidate.high),
  );
  if (bin === undefined) {
    throw outside(signal.name);
  }
  return bin.name;
}

/**
 * C164.6 (Phase 7 C99): the value `inquiry/list_match_count` is binned on, read from the inquiry's
 * list screening rather than its stored signals: a completed screening's `match_count`; `null` (not
 * evaluated, never 0) for a pending, partial or errored screening, or none.
 */
export function listMatchCountValue(
  screening: { readonly status: ListScreeningStatus; readonly matchCount: number | null } | null,
): number | null {
  if (screening?.status !== 'completed') {
    return null;
  }
  return assertCount(screening.matchCount ?? Number.NaN, 'a completed screening match count');
}
