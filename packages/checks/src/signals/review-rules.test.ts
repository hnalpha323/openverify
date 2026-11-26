import { describe, expect, it } from 'vitest';
import { computeInquirySignals } from './compute.js';
import type { SignalSessionInput } from './inputs.js';
import { matchSignalReviewRules } from './review-rules.js';
import { behaviour, cleanNetwork, integrity, session, webBody } from './testing.js';

const COMPUTED_AT = new Date('2026-10-30T12:30:00.000Z');
const signalsOf = (sessions: readonly SignalSessionInput[]) =>
  computeInquirySignals({
    environment: 'production',
    collect: 'default',
    computedAt: COMPUTED_AT,
    sessions,
    governmentIdCountry: null,
  });

const torNull = (reason: 'ipv6_not_covered' | 'list_stale') =>
  cleanNetwork({ isTor: null, reasons: [...cleanNetwork().reasons, { field: 'is-tor', reason }] });

const automated = session('iqse_a', {
  bodies: [webBody(1, { integrity: integrity({ webdriver: true }), behaviour: behaviour() })],
});

describe('matchSignalReviewRules (C90.7, H03, V01)', () => {
  it('matches a rule whose comparison holds for the value', () => {
    expect(
      matchSignalReviewRules([{ signal: 'inquiry/bot_score', gte: 70 }], signalsOf([automated])),
    ).toEqual({
      rules: [0],
      cause: 'signal_rule',
    });
    expect(
      matchSignalReviewRules(
        [
          { signal: 'inquiry/bot_score', lte: 50 },
          { signal: 'inquiry/automation_artefact_count', eq: 1 },
          { signal: 'inquiry/network_threat_level', in: ['medium', 'high'] },
          { signal: 'inquiry/tor_detected', eq: false },
        ],
        signalsOf([automated]),
      ),
    ).toEqual({ rules: [1, 3], cause: 'signal_rule' });
  });

  it('sends a stale exit list to review under a Tor rule (signal_unevaluated)', () => {
    expect(
      matchSignalReviewRules(
        [{ signal: 'inquiry/tor_detected', eq: true }],
        signalsOf([session('iqse_a', { network: torNull('list_stale') })]),
      ),
    ).toEqual({ rules: [0], cause: 'signal_unevaluated' });
  });

  it('leaves an IPv6-only session alone under a Tor rule', () => {
    expect(
      matchSignalReviewRules(
        [{ signal: 'inquiry/tor_detected', eq: true }],
        signalsOf([session('iqse_a', { network: torNull('ipv6_not_covered') })]),
      ),
    ).toEqual({ rules: [], cause: null });
  });

  it("derives sessions_not_evaluated from the sessions' own reasons", () => {
    const rule = [{ signal: 'inquiry/tor_detected', eq: true }] as const;
    expect(
      matchSignalReviewRules(
        rule,
        signalsOf([
          session('iqse_a', { network: torNull('list_stale') }),
          session('iqse_b', { network: torNull('ipv6_not_covered') }, 5),
        ]),
      ),
    ).toEqual({ rules: [0], cause: 'signal_unevaluated' });
    expect(
      matchSignalReviewRules(
        rule,
        signalsOf([
          session('iqse_a'),
          session('iqse_b', { network: torNull('ipv6_not_covered') }, 5),
        ]),
      ),
    ).toEqual({ rules: [], cause: null });
  });

  it("lets a rule's own on-null override the reason's default", () => {
    const stale = signalsOf([session('iqse_a', { network: torNull('list_stale') })]);
    const ipv6 = signalsOf([session('iqse_a', { network: torNull('ipv6_not_covered') })]);
    expect(
      matchSignalReviewRules(
        [{ signal: 'inquiry/tor_detected', eq: true, 'on-null': 'ignore' }],
        stale,
      ),
    ).toEqual({ rules: [], cause: null });
    expect(
      matchSignalReviewRules(
        [{ signal: 'inquiry/tor_detected', eq: true, 'on-null': 'needs_review' }],
        ipv6,
      ),
    ).toEqual({ rules: [0], cause: 'signal_unevaluated' });
  });

  it('records signal_rule when a value matched beside an unevaluated one', () => {
    const result = signalsOf([
      session('iqse_a', {
        network: torNull('list_stale'),
        bodies: automated.bodies,
      }),
    ]);
    expect(
      matchSignalReviewRules(
        [
          { signal: 'inquiry/tor_detected', eq: true },
          { signal: 'inquiry/bot_score', gte: 70 },
        ],
        result,
      ),
    ).toEqual({ rules: [0, 1], cause: 'signal_rule' });
  });

  it('never matches a signal the inquiry does not carry, or an operand of the wrong type', () => {
    const result = signalsOf([automated]);
    expect(
      matchSignalReviewRules(
        [
          { signal: 'inquiry/list_match_count', gte: 1 },
          { signal: 'inquiry/bot_score', eq: '90' },
          { signal: 'inquiry/network_threat_level', gte: 1 },
          { signal: 'inquiry/tor_detected', in: ['false'] },
        ],
        result,
      ),
    ).toEqual({ rules: [], cause: null });
  });
});
