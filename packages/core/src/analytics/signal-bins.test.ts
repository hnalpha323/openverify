/**
 * C164.6 (Phase 9, Workflow 9B; `analytics-logic`): `signalBinOf` puts a signal's value in the fixed
 * bins of `SIGNAL_BINS`, `null` in `not-evaluated`, and refuses a value its registry entry does not
 * allow, so no value is ever counted in a bin it does not belong to.
 */
import { describe, expect, it } from 'vitest';
import { SIGNAL_REGISTRY } from '../signal-registry.js';
import {
  SIGNAL_BINS,
  SIGNAL_NOT_EVALUATED_BIN,
  listMatchCountValue,
  signalBinOf,
} from './signal-bins.js';

const INTEGER_SIGNALS = SIGNAL_REGISTRY.filter((signal) => signal.valueType === 'integer');

describe('signalBinOf (C164.6)', () => {
  it('counts a null value as not evaluated, for every signal of the registry', () => {
    for (const signal of SIGNAL_REGISTRY) {
      expect(signalBinOf(signal.name, null), signal.name).toBe(SIGNAL_NOT_EVALUATED_BIN);
    }
  });

  it('bins an enum value as itself, and a boolean as true or false where both are allowed', () => {
    expect(signalBinOf('inquiry/behavior_threat_level', 'medium')).toBe('medium');
    expect(signalBinOf('inquiry/network_threat_level', 'high')).toBe('high');
    expect(signalBinOf('inquiry/country_comparison', 'different')).toBe('different');
    expect(signalBinOf('inquiry/tor_detected', false)).toBe('false');
    expect(signalBinOf('inquiry/proxy_detected', true)).toBe('true');
    expect(signalBinOf('inquiry/vpn_detected', true)).toBe('true');
  });

  it('refuses false for a never-false signal, and a value outside an enum', () => {
    expect(() => signalBinOf('inquiry/datacenter_detected', false)).toThrow(RangeError);
    expect(() => signalBinOf('inquiry/vpn_detected', false)).toThrow(RangeError);
    expect(() => signalBinOf('inquiry/behavior_threat_level', 'severe')).toThrow(RangeError);
    expect(() => signalBinOf('inquiry/tor_detected', 'true')).toThrow(RangeError);
  });

  it('bins the integer edges as the bin names read', () => {
    expect(signalBinOf('inquiry/bot_score', 0)).toBe('0-9');
    expect(signalBinOf('inquiry/bot_score', 9)).toBe('0-9');
    expect(signalBinOf('inquiry/bot_score', 10)).toBe('10-19');
    expect(signalBinOf('inquiry/bot_score', 89)).toBe('80-89');
    expect(signalBinOf('inquiry/bot_score', 90)).toBe('90-100');
    expect(signalBinOf('inquiry/bot_score', 100)).toBe('90-100');
    expect(signalBinOf('inquiry/list_match_count', 0)).toBe('0');
    expect(signalBinOf('inquiry/list_match_count', 1)).toBe('1');
    expect(signalBinOf('inquiry/list_match_count', 2)).toBe('2-4');
    expect(signalBinOf('inquiry/list_match_count', 4)).toBe('2-4');
    expect(signalBinOf('inquiry/list_match_count', 5)).toBe('5+');
    expect(signalBinOf('inquiry/list_match_count', 100_000)).toBe('5+');
    expect(signalBinOf('inquiry/session_count', 3)).toBe('3-5');
    expect(signalBinOf('inquiry/handoff_count', 3)).toBe('3+');
  });

  it('bins the session distance, stored in metres, in whole kilometres', () => {
    expect(signalBinOf('inquiry/max_session_distance', 0)).toBe('0-49');
    expect(signalBinOf('inquiry/max_session_distance', 49_999)).toBe('0-49');
    expect(signalBinOf('inquiry/max_session_distance', 50_000)).toBe('50-499');
    expect(signalBinOf('inquiry/max_session_distance', 499_999)).toBe('50-499');
    expect(signalBinOf('inquiry/max_session_distance', 500_000)).toBe('500-1999');
    expect(signalBinOf('inquiry/max_session_distance', 1_999_999)).toBe('500-1999');
    expect(signalBinOf('inquiry/max_session_distance', 2_000_000)).toBe('2000+');
    expect(signalBinOf('inquiry/max_session_distance', 20_037_508)).toBe('2000+');
  });

  it('puts every integer of each range in exactly one bin, in the bins order', () => {
    for (const signal of INTEGER_SIGNALS) {
      const entry = SIGNAL_BINS[signal.name];
      const bins = entry?.kind === 'fixed' ? entry.bins : [];
      const step = signal.unit === 'meters' ? 1000 : 1;
      const last = (signal.range?.max ?? 3000) * step;
      let previous = -1;
      for (let value = 0; value <= last; value += step) {
        const index = bins.indexOf(signalBinOf(signal.name, value));
        expect(index, `${signal.name} ${String(value)}`).toBeGreaterThanOrEqual(previous);
        previous = index;
      }
      expect(previous, signal.name).toBe(bins.length - 1);
    }
  });

  it('refuses an integer outside the registry range, or a value that is no integer', () => {
    expect(() => signalBinOf('inquiry/bot_score', 101)).toThrow(RangeError);
    expect(() => signalBinOf('inquiry/bot_score', -1)).toThrow(RangeError);
    expect(() => signalBinOf('inquiry/bot_score', 4.5)).toThrow(RangeError);
    expect(() => signalBinOf('inquiry/session_count', '3')).toThrow(RangeError);
    expect(() => signalBinOf('inquiry/max_session_distance', -10)).toThrow(RangeError);
  });

  it('bins the session country as its ISO 3166-1 alpha-2 code, and refuses any other text', () => {
    expect(signalBinOf('inquiry/country_from_session', 'FR')).toBe('FR');
    expect(signalBinOf('inquiry/country_from_session', 'JP')).toBe('JP');
    expect(() => signalBinOf('inquiry/country_from_session', 'fr')).toThrow(RangeError);
    expect(() => signalBinOf('inquiry/country_from_session', 'FRA')).toThrow(RangeError);
    expect(() => signalBinOf('inquiry/country_from_session', 33)).toThrow(RangeError);
  });

  it('refuses an unknown signal and an absent value, never guessing a bin', () => {
    expect(() => signalBinOf('inquiry/not_a_signal', 1)).toThrow(RangeError);
    expect(() => signalBinOf('inquiry/bot_score', undefined)).toThrow(RangeError);
  });

  it('never names the refused value in its message', () => {
    expect(() => signalBinOf('inquiry/country_from_session', 'zq')).toThrow(
      /^inquiry\/country_from_session: the value is outside the signal's bins$/,
    );
  });
});

describe('listMatchCountValue (C164.6, Phase 7 C99)', () => {
  it("reads a completed screening's match count, which bins like any count", () => {
    expect(listMatchCountValue({ status: 'completed', matchCount: 0 })).toBe(0);
    expect(listMatchCountValue({ status: 'completed', matchCount: 3 })).toBe(3);
    expect(
      signalBinOf(
        'inquiry/list_match_count',
        listMatchCountValue({ status: 'completed', matchCount: 3 }),
      ),
    ).toBe('2-4');
  });

  it('reads every other screening, and none, as not evaluated, never 0', () => {
    for (const status of ['pending', 'partial', 'errored'] as const) {
      expect(listMatchCountValue({ status, matchCount: 2 }), status).toBeNull();
    }
    expect(listMatchCountValue(null)).toBeNull();
    expect(signalBinOf('inquiry/list_match_count', listMatchCountValue(null))).toBe(
      SIGNAL_NOT_EVALUATED_BIN,
    );
  });

  it('refuses a completed screening without a whole match count', () => {
    expect(() => listMatchCountValue({ status: 'completed', matchCount: null })).toThrow(
      RangeError,
    );
    expect(() => listMatchCountValue({ status: 'completed', matchCount: -1 })).toThrow(RangeError);
  });
});
