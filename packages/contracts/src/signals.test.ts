import { describe, expect, it } from 'vitest';
import {
  ON_NULL_DEFAULTS,
  SIGNAL_EVIDENCE_REASONS,
  SIGNAL_NULL_REASONS,
  SIGNAL_REVIEW_CAUSES,
  derivedOnNullDefault,
  signalAttributeIssues,
  signalDetailSchema,
  signalDetailsSchema,
  signalValueSchema,
  type SignalNullReason,
} from './signals.js';

const AT = '2026-10-30T12:00:00.000Z';
const SESSION = 'iqse_01J00000000000000000000000';

/** An R-tier entry of a computed value. */
const rDetail = (overrides: Record<string, unknown> = {}) => ({
  tier: 'R',
  stage: 'ga',
  version: 1,
  'null-reason': null,
  reasons: [],
  'computed-at': AT,
  ...overrides,
});

/** An H-tier entry of a computed value. */
const hDetail = (overrides: Record<string, unknown> = {}) => ({
  tier: 'H',
  stage: 'beta',
  version: 1,
  confidence: 0.4,
  'null-reason': null,
  reasons: ['no_artefact_found'],
  thresholds: { 'low-score-confidence-cap': 0.5 },
  'computed-at': AT,
  ...overrides,
});

describe('SIGNAL_NULL_REASONS (C90.3, H11)', () => {
  it('freezes the 7A reasons by group, then the 7B list reasons, then the flow reason (C150.9)', () => {
    expect(SIGNAL_NULL_REASONS).toEqual([
      'signals_not_collected',
      'collector_missing',
      'collection_disabled',
      'consent_not_given',
      'list_unavailable',
      'list_stale',
      'provider_not_configured',
      'not_in_known_ranges',
      'not_in_provider_data',
      'client_address_untrusted',
      'address_not_public',
      'ipv6_not_covered',
      'location_too_coarse',
      'input_missing',
      'fingerprint_randomised',
      'insufficient_behaviour',
      'insufficient_sessions',
      'sessions_not_evaluated',
      'ip_country_unreliable',
      'list_screening_pending',
      'list_unscreened',
      'no_lists_selected',
      'not_yet_collected',
      // Workflow 10B (C210.4, C211.5): device integrity
      'no_indicator_found',
      'not_android',
      'integrity_token_unavailable',
      'integrity_unevaluated',
      'integrity_decode_failed',
    ]);
  });

  it('keeps the evidence reasons apart, with one code per automation artefact', () => {
    expect(SIGNAL_EVIDENCE_REASONS).toEqual(
      expect.arrayContaining([
        'hosting_asn',
        'vpn_asn',
        'vpn_list_not_exhaustive',
        'proxy_not_evaluated',
        'no_artefact_found',
        'partial_sessions',
        'sandbox_outcome',
        'webdriver',
        'driver_globals',
        'ua_headless_marker',
        'untrusted_events',
        'approximate',
      ]),
    );
    const nullReasons = new Set<string>(SIGNAL_NULL_REASONS);
    expect(SIGNAL_EVIDENCE_REASONS.filter((reason) => nullReasons.has(reason))).toEqual([]);
    expect(new Set(SIGNAL_EVIDENCE_REASONS).size).toBe(SIGNAL_EVIDENCE_REASONS.length);
  });

  it('names the review causes of on-signal (C90.7)', () => {
    expect(SIGNAL_REVIEW_CAUSES).toEqual([
      'signal_rule',
      'signal_unevaluated',
      'inquiry_already_decided',
    ]);
  });
});

describe('ON_NULL_DEFAULTS (C90.7, V01)', () => {
  it('classifies every null reason, and nothing else', () => {
    expect(Object.keys(ON_NULL_DEFAULTS).sort()).toEqual([...SIGNAL_NULL_REASONS].sort());
  });

  it('sends a data or collection gap to review and ignores a fact about the subject', () => {
    const by = (action: string) =>
      SIGNAL_NULL_REASONS.filter((reason) => ON_NULL_DEFAULTS[reason] === action);
    expect(by('needs_review')).toEqual([
      'collector_missing',
      'list_unavailable',
      'list_stale',
      'provider_not_configured',
      'client_address_untrusted',
      'integrity_unevaluated',
      'integrity_decode_failed',
    ]);
    expect(by('derived')).toEqual(['sessions_not_evaluated']);
    expect(by('ignore')).toHaveLength(20);
  });

  it('holds the list reasons, which only inquiry/list_match_count carries (H02, H11)', () => {
    expect(SIGNAL_NULL_REASONS.slice(-9, -6)).toEqual([
      'list_screening_pending',
      'list_unscreened',
      'no_lists_selected',
    ]);
    // No review rule can test the list count (F31): on-list-match covers it, so the default is
    // never read. Classified, so a new reason cannot be left out.
    for (const reason of [
      'list_screening_pending',
      'list_unscreened',
      'no_lists_selected',
    ] as const) {
      expect(ON_NULL_DEFAULTS[reason]).toBe('ignore');
    }
  });

  it('derives sessions_not_evaluated from the sessions’ own reasons', () => {
    expect(derivedOnNullDefault(['ipv6_not_covered', 'address_not_public'])).toBe('ignore');
    expect(derivedOnNullDefault(['ipv6_not_covered', 'list_stale'])).toBe('needs_review');
    expect(derivedOnNullDefault([])).toBe('ignore');
    expect(derivedOnNullDefault(['sessions_not_evaluated'])).toBe('ignore');
  });
});

describe('signal-details (C90.5, H12)', () => {
  it('requires a confidence, reasons and thresholds of an H-tier entry', () => {
    expect(signalDetailSchema.safeParse(hDetail()).success).toBe(true);
    for (const missing of ['confidence', 'thresholds', 'reasons']) {
      const entry = Object.fromEntries(
        Object.entries(hDetail()).filter(([key]) => key !== missing),
      );
      expect(signalDetailSchema.safeParse(entry).success, missing).toBe(false);
    }
    expect(signalDetailSchema.safeParse(hDetail({ confidence: 1.2 })).success).toBe(false);
  });

  it('refuses a confidence on an R or A entry, and unknown reasons', () => {
    expect(signalDetailSchema.safeParse(rDetail()).success).toBe(true);
    expect(signalDetailSchema.safeParse(rDetail({ confidence: 1 })).success).toBe(false);
    expect(signalDetailSchema.safeParse(rDetail({ reasons: ['looks_fine'] })).success).toBe(false);
    expect(signalDetailSchema.safeParse(rDetail({ 'null-reason': 'unknown' })).success).toBe(false);
  });

  it('carries sources and per-session reasons', () => {
    expect(
      signalDetailSchema.safeParse(
        rDetail({
          sources: [
            {
              kind: 'sync',
              'source-id': 'tor-exit-addresses',
              'sync-id': '42',
              'published-at': AT,
              sha256: 'a'.repeat(64),
            },
            { kind: 'provider', provider: 'sandbox', sandbox: true },
          ],
          sessions: [{ 'session-id': SESSION, 'null-reason': 'ipv6_not_covered' }],
        }),
      ).success,
    ).toBe(true);
  });

  it('is a map of signal names plus computed-at and review', () => {
    expect(signalDetailsSchema.safeParse({ 'computed-at': null }).success).toBe(true);
    expect(
      signalDetailsSchema.safeParse({
        'computed-at': AT,
        review: { cause: 'signal_rule', rules: [0] },
        'inquiry/bot_score': hDetail(),
      }).success,
    ).toBe(true);
    expect(signalDetailsSchema.safeParse({ 'computed-at': AT, bot_score: hDetail() }).success).toBe(
      false,
    );
    expect(
      signalDetailsSchema.safeParse({ 'computed-at': AT, 'inquiry/bot_score': { tier: 'H' } })
        .success,
    ).toBe(false);
  });
});

describe('signals against signal-details (C90.3, C90.5)', () => {
  const nullDetail = (reason: SignalNullReason, overrides: Record<string, unknown> = {}) =>
    rDetail({ 'null-reason': reason, ...overrides });

  it('accepts values that fit their registry type, each with its details', () => {
    expect(
      signalAttributeIssues(
        [
          { name: 'inquiry/bot_score', value: 5 },
          { name: 'inquiry/tor_detected', value: false },
          { name: 'inquiry/datacenter_detected', value: null },
          { name: 'inquiry/country_from_session', value: 'ZZ' },
        ],
        {
          'computed-at': AT,
          'inquiry/bot_score': hDetail(),
          'inquiry/tor_detected': rDetail(),
          'inquiry/datacenter_detected': nullDetail('not_in_known_ranges'),
          'inquiry/country_from_session': hDetail({ confidence: 0.8, reasons: ['approximate'] }),
        },
      ),
    ).toEqual([]);
  });

  it('refuses a false for a never-false flag', () => {
    expect(
      signalAttributeIssues([{ name: 'inquiry/vpn_detected', value: false }], {
        'computed-at': AT,
        'inquiry/vpn_detected': hDetail(),
      }),
    ).toEqual([{ path: ['signals', 0, 'value'], message: 'never false: true or null' }]);
  });

  it('refuses a null without its reason, and a reason beside a value', () => {
    expect(
      signalAttributeIssues([{ name: 'inquiry/tor_detected', value: null }], {
        'computed-at': AT,
        'inquiry/tor_detected': rDetail(),
      }),
    ).toHaveLength(1);
    expect(
      signalAttributeIssues([{ name: 'inquiry/tor_detected', value: true }], {
        'computed-at': AT,
        'inquiry/tor_detected': nullDetail('list_stale'),
      }),
    ).toHaveLength(1);
  });

  it('refuses an H value without confidence, an out-of-range score, an unknown name and a repeat', () => {
    expect(
      signalAttributeIssues([{ name: 'inquiry/bot_score', value: 40 }], {
        'computed-at': AT,
        'inquiry/bot_score': hDetail({ confidence: null }),
      }),
    ).toHaveLength(1);
    expect(
      signalAttributeIssues([{ name: 'inquiry/bot_score', value: 101 }], {
        'computed-at': AT,
        'inquiry/bot_score': hDetail(),
      }),
    ).toHaveLength(1);
    expect(
      signalAttributeIssues([{ name: 'inquiry/unknown', value: 1 }], { 'computed-at': AT }),
    ).toHaveLength(1);
    expect(
      signalAttributeIssues(
        [
          { name: 'inquiry/tor_detected', value: true },
          { name: 'inquiry/bot_score', value: 1 },
        ],
        { 'computed-at': AT, 'inquiry/tor_detected': rDetail(), 'inquiry/bot_score': hDetail() },
      ),
    ).toHaveLength(1);
  });

  it('needs the details of every signal, with the registry’s tier class', () => {
    expect(
      signalAttributeIssues([{ name: 'inquiry/bot_score', value: 1 }], { 'computed-at': AT }),
    ).toHaveLength(1);
    expect(
      signalAttributeIssues([{ name: 'inquiry/bot_score', value: 1 }], {
        'computed-at': AT,
        'inquiry/bot_score': rDetail(),
      }),
    ).toHaveLength(1);
  });

  it('serves hidden or uncomputed signals as [] beside computed-at alone (C90.8)', () => {
    expect(signalAttributeIssues([], { 'computed-at': null })).toEqual([]);
    expect(
      signalAttributeIssues([], { 'computed-at': AT, 'inquiry/bot_score': hDetail() }),
    ).toEqual([
      { path: ['signal-details', 'inquiry/bot_score'], message: expect.any(String) as unknown },
    ]);
  });

  it('caps a string value at 64 characters', () => {
    expect(signalValueSchema.safeParse({ name: 'inquiry/x', value: 'a'.repeat(65) }).success).toBe(
      false,
    );
  });
});

describe('not_yet_collected (C150.9, V06; a labelled C90 amendment)', () => {
  it('is a flow-only null reason in the ignore class, after the list reasons', () => {
    // Workflow 10B's five device-integrity reasons follow it.
    expect(SIGNAL_NULL_REASONS.at(-6)).toBe('not_yet_collected');
    expect((ON_NULL_DEFAULTS as Readonly<Record<string, string>>).not_yet_collected).toBe('ignore');
  });
});
