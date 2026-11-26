import {
  BOT_SCORE_CONSTANTS,
  DEFAULT_SIGNAL_NAMES,
  SIGNAL_REGISTRY,
  getSignalDefinition,
  isHeuristicSignalTier,
  signalThresholdValues,
  type SignalName,
} from '@openverify/core';
import { describe, expect, it } from 'vitest';
import {
  appliedSignalThresholds,
  computeInquirySignals,
  resolveCollectedSignals,
} from './compute.js';
import type {
  InquirySignalsInput,
  SessionNetworkInput,
  SignalBodyInput,
  SignalSessionInput,
} from './inputs.js';
import {
  AT,
  behaviour,
  cleanNetwork,
  integrity,
  seededRandom,
  session,
  webBody,
} from './testing.js';
import {
  SIGNAL_EVIDENCE_REASONS,
  SIGNAL_NULL_REASONS,
  type InquirySignalsResult,
  type SignalDetailEntry,
} from './vocabulary.js';

const COMPUTED_AT = new Date('2026-10-30T12:30:00.000Z');
const COMPUTED_AT_ISO = COMPUTED_AT.toISOString();

const run = (overrides: Partial<InquirySignalsInput> = {}): InquirySignalsResult =>
  computeInquirySignals({
    environment: 'production',
    collect: 'default',
    computedAt: COMPUTED_AT,
    sessions: [],
    governmentIdCountry: null,
    ...overrides,
  });

const valueOf = (result: InquirySignalsResult, name: string) =>
  result.signals.find((signal) => signal.name === name)?.value;
const detailOf = (result: InquirySignalsResult, name: SignalName): SignalDetailEntry | undefined =>
  result.details[name];

/** Three screens of ordinary behaviour, the first with a clean integrity member. */
const humanBodies = (): SignalBodyInput[] => [
  webBody(1, { integrity: integrity(), behaviour: behaviour() }),
  webBody(2, { behaviour: behaviour() }),
  webBody(3, { behaviour: behaviour() }),
];

const human = (id: string, overrides: Partial<SignalSessionInput> = {}, minutes = 0) =>
  session(id, { bodies: humanBodies(), ...overrides }, minutes);

const withTor = (isTor: boolean | null, reason?: 'ipv6_not_covered' | 'list_stale') =>
  cleanNetwork({
    isTor,
    reasons: [
      ...cleanNetwork().reasons,
      ...(reason === undefined ? [] : [{ field: 'is-tor' as const, reason }]),
    ],
  });

const at = (latitude: number, longitude: number): Partial<SessionNetworkInput> => ({
  latitude,
  longitude,
});

/** The C90.3 and C90.5 rules the contracts' `signalAttributeIssues` enforces, restated. */
function expectHonest(result: InquirySignalsResult): void {
  const names = result.signals.map(({ name }) => name);
  // C150.9 (V06): `not_yet_collected` is a provisional snapshot's reason alone; the inquiry's own
  // signal-details stay as C90.5 has them.
  for (const name of names) {
    expect(detailOf(result, name)?.['null-reason'], name).not.toBe('not_yet_collected');
  }
  expect(Object.keys(result.details).sort()).toEqual([...names, 'computed-at'].sort());
  expect(result.details['computed-at']).toBe(COMPUTED_AT_ISO);
  const order = SIGNAL_REGISTRY.map(({ name }) => name);
  expect(names).toEqual(order.filter((name) => names.includes(name)));
  for (const { name, value } of result.signals) {
    const entry = getSignalDefinition(name);
    const detail = detailOf(result, name);
    expect(entry).toBeDefined();
    expect(detail).toBeDefined();
    if (entry === undefined || detail === undefined) {
      return;
    }
    expect(value === null, `${name}: a null value names its reason, and only a null value`).toBe(
      detail['null-reason'] !== null,
    );
    if (entry.neverFalse) {
      expect(value, `${name} is never false`).not.toBe(false);
    }
    expect(detail.tier).toBe(entry.tier);
    expect(detail.stage).toBe(entry.stage);
    expect(detail.version).toBe(entry.version);
    expect(detail['computed-at']).toBe(COMPUTED_AT_ISO);
    if (isHeuristicSignalTier(entry.tier)) {
      expect(detail.thresholds, `${name} serves its thresholds`).toEqual(
        appliedSignalThresholds(name),
      );
      expect(detail.confidence === null, `${name}: a confidence beside every value`).toBe(
        value === null,
      );
      if (typeof detail.confidence === 'number') {
        expect(detail.confidence).toBeGreaterThanOrEqual(0);
        expect(detail.confidence).toBeLessThanOrEqual(1);
      }
    } else {
      expect(detail).not.toHaveProperty('confidence');
    }
    if (detail['null-reason'] !== null) {
      expect(SIGNAL_NULL_REASONS).toContain(detail['null-reason']);
    }
    for (const reason of detail.reasons) {
      expect(SIGNAL_EVIDENCE_REASONS).toContain(reason);
    }
    expect(new Set(detail.reasons).size).toBe(detail.reasons.length);
    if (entry.valueType === 'integer' && value !== null) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(entry.range?.min ?? 0);
      if (entry.range?.max !== null && entry.range?.max !== undefined) {
        expect(value).toBeLessThanOrEqual(entry.range.max);
      }
    }
    if (entry.valueType === 'enum' && value !== null) {
      expect(entry.values).toContain(value);
    }
    expect(detail.sessions?.length ?? 0).toBeLessThanOrEqual(100);
    expect(detail.sources?.length ?? 0).toBeLessThanOrEqual(32);
  }
}

describe('resolveCollectedSignals (C90.6)', () => {
  it('collects the default set in registry order, without the list count (C90.5, V06)', () => {
    expect(resolveCollectedSignals('default')).toEqual(
      DEFAULT_SIGNAL_NAMES.filter((name) => name !== 'inquiry/list_match_count'),
    );
  });

  it('keeps the named signals in registry order, never one it does not compute', () => {
    expect(
      resolveCollectedSignals([
        'inquiry/tor_detected',
        'inquiry/bot_score',
        'inquiry/list_match_count',
        'inquiry/not_a_signal',
      ]),
    ).toEqual(['inquiry/bot_score', 'inquiry/tor_detected']);
  });
});

describe('appliedSignalThresholds (C90.3)', () => {
  it("serves the registry entry's constants", () => {
    expect(appliedSignalThresholds('inquiry/network_threat_level')).toEqual({
      'threat-low-confidence-cap': 0.5,
      'threat-low-confidence-cap-with-adapter': 0.8,
    });
    expect(appliedSignalThresholds('inquiry/max_session_distance')).toEqual({
      'ip-city-uncertainty-meters': 50_000,
    });
    expect(appliedSignalThresholds('inquiry/tor_detected')).toEqual({});
  });

  it('adds the rule constants the bot score and the behaviour level apply', () => {
    const bot = getSignalDefinition('inquiry/bot_score');
    expect(bot).toBeDefined();
    expect(appliedSignalThresholds('inquiry/bot_score')).toEqual({
      ...(bot === undefined ? {} : signalThresholdValues(bot)),
      'many-focus-losses-min': 10,
      'long-hidden-seconds-min': 300,
    });
    expect(appliedSignalThresholds('inquiry/behavior_threat_level')).toEqual({
      'min-screens': 3,
      'min-input-events': 20,
      'low-confidence-cap': 0.5,
      'strong-artefact-floor': Number(BOT_SCORE_CONSTANTS['strong-artefact-floor']?.value),
      'strong-band': 70,
      'medium-evidence-max': 25,
      'weak-evidence-max': 5,
      'medium-weak-cap': 60,
      'fast-screen-floor-seconds': 2,
      'many-focus-losses-min': 10,
      'long-hidden-seconds-min': 300,
    });
  });
});

describe('computeInquirySignals (C90.2, C90.4, C90.5)', () => {
  it('computes every registered signal but the 7B list count', () => {
    const result = run({ sessions: [human('iqse_a')] });
    expect(result.signals.map(({ name }) => name)).toEqual(
      SIGNAL_REGISTRY.map(({ name }) => name).filter((name) => name !== 'inquiry/list_match_count'),
    );
    expectHonest(result);
  });

  it('golden: an inquiry with no flow session (a server-API inquiry, or expired from created)', () => {
    const result = run();
    expectHonest(result);
    expect(Object.fromEntries(result.signals.map(({ name, value }) => [name, value]))).toEqual({
      'inquiry/bot_score': null,
      'inquiry/behavior_threat_level': null,
      'inquiry/automation_artefact_count': null,
      'inquiry/session_count': 0,
      'inquiry/network_threat_level': null,
      'inquiry/tor_detected': null,
      'inquiry/datacenter_detected': null,
      'inquiry/vpn_detected': null,
      'inquiry/proxy_detected': null,
      'inquiry/country_from_session': null,
      'inquiry/country_comparison': null,
      'inquiry/max_session_distance': null,
      'inquiry/handoff_count': 0,
      'inquiry/device_emulated': null,
      'inquiry/device_rooted': null,
      'inquiry/device_hooked': null,
      'inquiry/device_integrity_level': null,
      'inquiry/app_recognized': null,
    });
    for (const { name, value } of result.signals) {
      if (value === null) {
        expect(detailOf(result, name)?.['null-reason']).toBe('signals_not_collected');
      }
    }
    expect(detailOf(result, 'inquiry/tor_detected')).toEqual({
      tier: 'R',
      stage: 'ga',
      version: 1,
      'null-reason': 'signals_not_collected',
      reasons: [],
      'computed-at': COMPUTED_AT_ISO,
    });
  });

  it('golden: one consented web session on fresh lists with nothing listed', () => {
    const result = run({ sessions: [human('iqse_a')] });
    expectHonest(result);
    expect(Object.fromEntries(result.signals.map(({ name, value }) => [name, value]))).toEqual({
      'inquiry/bot_score': 0,
      'inquiry/behavior_threat_level': 'low',
      'inquiry/automation_artefact_count': 0,
      'inquiry/session_count': 1,
      'inquiry/network_threat_level': 'low',
      'inquiry/tor_detected': false,
      'inquiry/datacenter_detected': null,
      'inquiry/vpn_detected': null,
      'inquiry/proxy_detected': null,
      'inquiry/country_from_session': 'ZZ',
      'inquiry/country_comparison': null,
      'inquiry/max_session_distance': null,
      'inquiry/handoff_count': 0,
      'inquiry/device_emulated': null,
      'inquiry/device_rooted': null,
      'inquiry/device_hooked': null,
      'inquiry/device_integrity_level': null,
      'inquiry/app_recognized': null,
    });
    const sessions = (reason: string | null) => [{ 'session-id': 'iqse_a', 'null-reason': reason }];
    expect(detailOf(result, 'inquiry/bot_score')).toEqual({
      tier: 'H',
      stage: 'beta',
      version: 3,
      confidence: 0.5,
      thresholds: appliedSignalThresholds('inquiry/bot_score'),
      'null-reason': null,
      reasons: ['no_artefact_found'],
      sessions: sessions(null),
      'computed-at': COMPUTED_AT_ISO,
    });
    expect(detailOf(result, 'inquiry/behavior_threat_level')).toMatchObject({
      confidence: 0.5,
      reasons: ['no_artefact_found'],
    });
    expect(detailOf(result, 'inquiry/automation_artefact_count')).toMatchObject({
      reasons: ['no_artefact_found'],
      sessions: sessions(null),
    });
    expect(detailOf(result, 'inquiry/network_threat_level')).toMatchObject({
      confidence: 0.5,
      reasons: ['vpn_list_not_exhaustive', 'proxy_not_evaluated'],
    });
    expect(detailOf(result, 'inquiry/tor_detected')).toEqual({
      tier: 'R',
      stage: 'ga',
      version: 1,
      'null-reason': null,
      reasons: [],
      sessions: sessions(null),
      'computed-at': COMPUTED_AT_ISO,
    });
    expect(detailOf(result, 'inquiry/datacenter_detected')).toMatchObject({
      'null-reason': 'not_in_known_ranges',
      sessions: sessions('not_in_known_ranges'),
    });
    expect(detailOf(result, 'inquiry/vpn_detected')).toMatchObject({
      confidence: null,
      'null-reason': 'not_in_known_ranges',
    });
    expect(detailOf(result, 'inquiry/proxy_detected')).toMatchObject({
      'null-reason': 'provider_not_configured',
    });
    expect(detailOf(result, 'inquiry/country_from_session')).toMatchObject({
      confidence: 0.8,
      reasons: ['approximate'],
      thresholds: { 'ip-country-confidence': 0.8 },
    });
    expect(detailOf(result, 'inquiry/country_comparison')).toMatchObject({
      confidence: null,
      'null-reason': 'input_missing',
    });
    expect(detailOf(result, 'inquiry/max_session_distance')).toMatchObject({
      'null-reason': 'insufficient_sessions',
      thresholds: { 'ip-city-uncertainty-meters': 50_000 },
      sessions: sessions('location_too_coarse'),
    });
  });

  describe('combining sessions (C90.4, H05)', () => {
    it('golden: an IPv4 session beside an IPv6 one: Tor and the threat level are not evaluated', () => {
      const result = run({
        sessions: [
          human('iqse_a'),
          human('iqse_b', { network: withTor(null, 'ipv6_not_covered') }, 5),
        ],
      });
      expectHonest(result);
      expect(valueOf(result, 'inquiry/tor_detected')).toBeNull();
      expect(detailOf(result, 'inquiry/tor_detected')).toMatchObject({
        'null-reason': 'sessions_not_evaluated',
        sessions: [
          { 'session-id': 'iqse_a', 'null-reason': null },
          { 'session-id': 'iqse_b', 'null-reason': 'ipv6_not_covered' },
        ],
      });
      expect(valueOf(result, 'inquiry/network_threat_level')).toBeNull();
      expect(detailOf(result, 'inquiry/network_threat_level')).toMatchObject({
        'null-reason': 'sessions_not_evaluated',
        confidence: null,
      });
    });

    it('golden: a stale exit list beside a fresh one is not evaluated, naming the stale session', () => {
      const result = run({
        sessions: [human('iqse_a'), human('iqse_b', { network: withTor(null, 'list_stale') }, 5)],
      });
      expect(detailOf(result, 'inquiry/tor_detected')).toMatchObject({
        'null-reason': 'sessions_not_evaluated',
        sessions: [
          { 'session-id': 'iqse_a', 'null-reason': null },
          { 'session-id': 'iqse_b', 'null-reason': 'list_stale' },
        ],
      });
    });

    it('golden: IPv6-only sessions name their own reason', () => {
      const result = run({
        sessions: [human('iqse_a', { network: withTor(null, 'ipv6_not_covered') })],
      });
      expect(detailOf(result, 'inquiry/tor_detected')).toMatchObject({
        'null-reason': 'ipv6_not_covered',
      });
      expect(detailOf(result, 'inquiry/network_threat_level')).toMatchObject({
        'null-reason': 'ipv6_not_covered',
      });
    });

    it('golden: one Tor session makes the inquiry Tor and its threat high', () => {
      const result = run({
        sessions: [
          human('iqse_a', { network: withTor(null, 'ipv6_not_covered') }),
          human('iqse_b', { network: withTor(true) }, 5),
        ],
      });
      expectHonest(result);
      expect(valueOf(result, 'inquiry/tor_detected')).toBe(true);
      expect(detailOf(result, 'inquiry/tor_detected')).toMatchObject({
        reasons: ['tor_exit_listed'],
      });
      expect(valueOf(result, 'inquiry/network_threat_level')).toBe('high');
      expect(detailOf(result, 'inquiry/network_threat_level')).toMatchObject({
        confidence: 1,
        reasons: ['tor_exit_listed'],
      });
    });

    it('golden: false only when every session was evaluated false', () => {
      const result = run({ sessions: [human('iqse_a'), human('iqse_b', {}, 5)] });
      expect(valueOf(result, 'inquiry/tor_detected')).toBe(false);
      expect(valueOf(result, 'inquiry/network_threat_level')).toBe('low');
    });

    it('golden: the threat level is the highest, its confidence the lowest of that level', () => {
      const adapter = cleanNetwork({ isProxy: false });
      const vpn = cleanNetwork({ isVpn: true });
      expect(
        detailOf(
          run({ sessions: [human('iqse_a', { network: adapter }), human('iqse_b', {}, 5)] }),
          'inquiry/network_threat_level',
        ),
      ).toMatchObject({
        confidence: 0.5,
        reasons: ['vpn_list_not_exhaustive', 'proxy_not_evaluated'],
      });
      const medium = run({ sessions: [human('iqse_a'), human('iqse_b', { network: vpn }, 5)] });
      expect(valueOf(medium, 'inquiry/network_threat_level')).toBe('medium');
      expect(detailOf(medium, 'inquiry/network_threat_level')).toMatchObject({
        confidence: 0.6,
        reasons: ['vpn_asn'],
      });
    });

    it('golden: a silent consented session beside one that sent a payload: partial_sessions', () => {
      const result = run({
        sessions: [human('iqse_a'), session('iqse_b', {}, 5)],
      });
      expectHonest(result);
      expect(valueOf(result, 'inquiry/bot_score')).toBe(0);
      expect(detailOf(result, 'inquiry/bot_score')).toMatchObject({
        reasons: ['no_artefact_found', 'partial_sessions'],
        sessions: [
          { 'session-id': 'iqse_a', 'null-reason': null },
          { 'session-id': 'iqse_b', 'null-reason': 'collector_missing' },
        ],
      });
      expect(detailOf(result, 'inquiry/automation_artefact_count')).toMatchObject({
        reasons: ['no_artefact_found', 'partial_sessions'],
      });
    });

    it('golden: the bot score is the highest over sessions that sent a payload', () => {
      const automated = [
        webBody(1, { integrity: integrity({ webdriver: true }), behaviour: behaviour() }),
      ];
      const result = run({
        sessions: [human('iqse_a'), session('iqse_b', { bodies: automated }, 5)],
      });
      expect(valueOf(result, 'inquiry/bot_score')).toBe(90);
      expect(detailOf(result, 'inquiry/bot_score')).toMatchObject({ reasons: ['webdriver'] });
      expect(valueOf(result, 'inquiry/automation_artefact_count')).toBe(1);
      expect(detailOf(result, 'inquiry/automation_artefact_count')).toMatchObject({
        reasons: ['webdriver'],
      });
    });

    it('counts the distinct artefacts over sessions', () => {
      const one = [
        webBody(1, { integrity: integrity({ webdriver: true, 'untrusted-event-count': 2 }) }),
      ];
      const two = [
        webBody(1, { integrity: integrity({ webdriver: true, 'driver-globals': ['phantom'] }) }),
      ];
      const result = run({
        sessions: [session('iqse_a', { bodies: one }), session('iqse_b', { bodies: two }, 5)],
      });
      expect(valueOf(result, 'inquiry/automation_artefact_count')).toBe(3);
      expect(detailOf(result, 'inquiry/automation_artefact_count')).toMatchObject({
        reasons: ['webdriver', 'driver_globals', 'untrusted_events'],
      });
    });

    it('golden: no payload from any consented session: collector_missing', () => {
      const result = run({ sessions: [session('iqse_a')] });
      for (const name of [
        'inquiry/bot_score',
        'inquiry/behavior_threat_level',
        'inquiry/automation_artefact_count',
      ] as const) {
        expect(valueOf(result, name)).toBeNull();
        expect(detailOf(result, name)).toMatchObject({
          'null-reason': 'collector_missing',
          sessions: [{ 'session-id': 'iqse_a', 'null-reason': 'collector_missing' }],
        });
      }
    });

    it('golden: the tier switched off, or no consent: collection_disabled, consent_not_given', () => {
      expect(
        detailOf(
          run({ sessions: [human('iqse_a', { signalsCollected: [] })] }),
          'inquiry/bot_score',
        ),
      ).toMatchObject({ 'null-reason': 'collection_disabled' });
      expect(
        detailOf(run({ sessions: [human('iqse_a', { consented: false })] }), 'inquiry/bot_score'),
      ).toMatchObject({
        'null-reason': 'consent_not_given',
        sessions: [{ 'session-id': 'iqse_a', 'null-reason': 'consent_not_given' }],
      });
    });

    it('reads only consented sessions for the behaviour signals (a rejected handoff phone is not)', () => {
      const automated = [webBody(1, { integrity: integrity({ webdriver: true }) })];
      const result = run({
        sessions: [
          human('iqse_a'),
          session(
            'iqse_b',
            { bodies: automated, consented: false, handoffFromSessionId: 'iqse_a' },
            5,
          ),
        ],
      });
      expect(valueOf(result, 'inquiry/bot_score')).toBe(0);
      expect(detailOf(result, 'inquiry/bot_score')).toMatchObject({
        sessions: [{ 'session-id': 'iqse_a', 'null-reason': null }],
      });
      expect(valueOf(result, 'inquiry/session_count')).toBe(2);
      expect(valueOf(result, 'inquiry/handoff_count')).toBe(1);
    });

    it('golden: mixed reasons for the behaviour signals are sessions_not_evaluated', () => {
      const result = run({
        sessions: [session('iqse_a', { signalsCollected: [] }), session('iqse_b', {}, 5)],
      });
      expect(detailOf(result, 'inquiry/bot_score')).toMatchObject({
        'null-reason': 'sessions_not_evaluated',
        sessions: [
          { 'session-id': 'iqse_a', 'null-reason': 'collection_disabled' },
          { 'session-id': 'iqse_b', 'null-reason': 'collector_missing' },
        ],
      });
    });

    it('golden: an Android session: the debugger facts reach the bot score and the artefact count, never the behaviour level (10B Stage 1a amendment 17)', () => {
      const android = session('iqse_a', {
        userAgent: 'OpenVerify-Android/0.1.0',
        bodies: [
          {
            screen: 'consent',
            screenType: 'consent',
            sequence: 1,
            platform: 'android',
            androidIntegrity: { 'debugger-connected': false, 'app-debuggable': false },
            deviceClass: 'smartphone',
          },
        ],
      });
      const result = run({ sessions: [android] });
      expectHonest(result);
      expect(valueOf(result, 'inquiry/bot_score')).toBe(0);
      expect(detailOf(result, 'inquiry/bot_score')).toMatchObject({
        version: 3,
        reasons: ['no_artefact_found'],
      });
      expect(valueOf(result, 'inquiry/automation_artefact_count')).toBe(0);
      expect(detailOf(result, 'inquiry/automation_artefact_count')).toMatchObject({
        version: 2,
        reasons: ['no_artefact_found'],
      });
      expect(detailOf(result, 'inquiry/behavior_threat_level')).toMatchObject({
        'null-reason': 'input_missing',
      });
      const debugged = run({
        sessions: [
          session('iqse_b', {
            bodies: [
              {
                screen: 'consent',
                screenType: 'consent',
                sequence: 1,
                platform: 'android',
                androidIntegrity: { 'debugger-connected': true, 'app-debuggable': false },
              },
            ],
          }),
        ],
      });
      expect(valueOf(debugged, 'inquiry/automation_artefact_count')).toBe(1);
      expect(detailOf(debugged, 'inquiry/automation_artefact_count')?.reasons).toEqual([
        'android_debugger_connected',
      ]);
    });

    it('golden: too little behaviour: insufficient_behaviour', () => {
      const result = run({
        sessions: [session('iqse_a', { bodies: [webBody(1, { behaviour: behaviour() })] })],
      });
      expect(detailOf(result, 'inquiry/behavior_threat_level')).toMatchObject({
        'null-reason': 'insufficient_behaviour',
      });
    });

    it('golden: a session never evaluated for its network blocks every false', () => {
      const result = run({ sessions: [human('iqse_a'), human('iqse_b', { network: null }, 5)] });
      expect(valueOf(result, 'inquiry/tor_detected')).toBeNull();
      expect(detailOf(result, 'inquiry/tor_detected')).toMatchObject({
        'null-reason': 'sessions_not_evaluated',
        sessions: [
          { 'session-id': 'iqse_a', 'null-reason': null },
          { 'session-id': 'iqse_b', 'null-reason': 'input_missing' },
        ],
      });
    });
  });

  describe('the network flags (C93.3)', () => {
    it('golden: a provider range in any session is true; never false', () => {
      const result = run({
        sessions: [
          human('iqse_a'),
          human('iqse_b', { network: cleanNetwork({ isDatacenter: true }) }, 5),
        ],
      });
      expect(valueOf(result, 'inquiry/datacenter_detected')).toBe(true);
      expect(detailOf(result, 'inquiry/datacenter_detected')).toMatchObject({
        reasons: ['provider_range'],
      });
    });

    it('golden: a VPN ASN is true at its confidence', () => {
      const result = run({
        sessions: [human('iqse_a', { network: cleanNetwork({ isVpn: true }) })],
      });
      expect(valueOf(result, 'inquiry/vpn_detected')).toBe(true);
      expect(detailOf(result, 'inquiry/vpn_detected')).toMatchObject({
        confidence: 0.6,
        reasons: ['vpn_asn'],
        thresholds: { 'vpn-asn-confidence': 0.6 },
      });
    });

    it("golden: the proxy flag is the adapter's: true, a recorded negative everywhere, or null", () => {
      const provider = { kind: 'provider', provider: 'sandbox', sandbox: true } as const;
      const negative = cleanNetwork({ isProxy: false, sources: [provider] });
      const both = run({
        sessions: [
          human('iqse_a', { network: negative }),
          human('iqse_b', { network: negative }, 5),
        ],
      });
      expect(valueOf(both, 'inquiry/proxy_detected')).toBe(false);
      expect(detailOf(both, 'inquiry/proxy_detected')).toMatchObject({
        reasons: ['adapter_negative'],
        sources: [provider],
      });
      const flagged = run({
        sessions: [
          human('iqse_a', { network: negative }),
          human('iqse_b', { network: cleanNetwork({ isProxy: true }) }, 5),
        ],
      });
      expect(valueOf(flagged, 'inquiry/proxy_detected')).toBe(true);
      expect(detailOf(flagged, 'inquiry/proxy_detected')).toMatchObject({
        reasons: ['proxy_flagged'],
      });
    });

    it('serves the sources the sessions read, once each', () => {
      const tor = {
        kind: 'sync',
        'source-id': 'tor-exit-addresses',
        'sync-id': 'nsy_01J0000000000000000000000',
        'published-at': '2026-10-30T11:00:00.000Z',
        sha256: 'a'.repeat(64),
      } as const;
      const result = run({
        sessions: [
          human('iqse_a', { network: cleanNetwork({ sources: [tor] }) }),
          human('iqse_b', { network: cleanNetwork({ sources: [tor] }) }, 5),
        ],
      });
      expect(detailOf(result, 'inquiry/tor_detected')).toMatchObject({ sources: [tor] });
    });
  });

  describe('the country signals (C90.2, V08)', () => {
    const country = (countryCode: string, extra: Partial<SessionNetworkInput> = {}) =>
      cleanNetwork({ countryCode, ...extra });

    it('golden: the first session whose country was evaluated, against the ID country', () => {
      const sessions = [
        human('iqse_b', { network: country('DE') }, 5),
        human('iqse_a', { network: country('FR') }),
      ];
      const same = run({ sessions, governmentIdCountry: 'FRA' });
      expect(valueOf(same, 'inquiry/country_from_session')).toBe('FR');
      expect(valueOf(same, 'inquiry/country_comparison')).toBe('same');
      expect(detailOf(same, 'inquiry/country_comparison')).toMatchObject({
        confidence: 0.8,
        reasons: ['approximate'],
      });
      expect(
        valueOf(run({ sessions, governmentIdCountry: 'D' }), 'inquiry/country_comparison'),
      ).toBe('different');
      expect(
        valueOf(run({ sessions, governmentIdCountry: 'fr' }), 'inquiry/country_comparison'),
      ).toBe('same');
    });

    it('golden: skips a session whose country is unknown', () => {
      const result = run({
        sessions: [
          human('iqse_a', { network: null }),
          human('iqse_b', { network: country('DE') }, 5),
        ],
      });
      expect(valueOf(result, 'inquiry/country_from_session')).toBe('DE');
    });

    it('golden: an anonymised first session makes the comparison unreliable', () => {
      const result = run({
        sessions: [human('iqse_a', { network: country('FR', { isVpn: true }) })],
        governmentIdCountry: 'FRA',
      });
      expect(valueOf(result, 'inquiry/country_from_session')).toBe('FR');
      expect(detailOf(result, 'inquiry/country_from_session')).toMatchObject({
        reasons: ['approximate', 'vpn_asn'],
      });
      expect(detailOf(result, 'inquiry/country_comparison')).toMatchObject({
        'null-reason': 'ip_country_unreliable',
      });
    });

    it('golden: no country at all, or nothing to compare with', () => {
      const unknown = cleanNetwork({
        countryCode: null,
        reasons: [{ field: 'country-code', reason: 'list_stale' }],
      });
      const result = run({
        sessions: [human('iqse_a', { network: unknown })],
        governmentIdCountry: 'FRA',
      });
      expect(detailOf(result, 'inquiry/country_from_session')).toMatchObject({
        'null-reason': 'list_stale',
      });
      expect(detailOf(result, 'inquiry/country_comparison')).toMatchObject({
        'null-reason': 'list_stale',
      });
      expect(
        detailOf(
          run({ sessions: [human('iqse_a')], governmentIdCountry: 'FRA' }),
          'inquiry/country_comparison',
        ),
      ).toMatchObject({ 'null-reason': 'input_missing' });
    });
  });

  describe('the session distance (C95.4)', () => {
    it('golden: the farthest pair of points, approximate, with its endpoints', () => {
      const result = run({
        sessions: [
          human('iqse_a', { network: cleanNetwork(at(-40, -120)) }),
          human('iqse_b', { network: cleanNetwork(at(-41, -121)) }, 5),
        ],
      });
      expectHonest(result);
      expect(valueOf(result, 'inquiry/max_session_distance')).toBe(139_689);
      expect(detailOf(result, 'inquiry/max_session_distance')).toMatchObject({
        reasons: ['approximate'],
        sessions: [
          { 'session-id': 'iqse_a', 'null-reason': null },
          { 'session-id': 'iqse_b', 'null-reason': null },
        ],
      });
    });

    it('golden: a session without a point is partial, named with its reason', () => {
      const result = run({
        sessions: [
          human('iqse_a', { network: cleanNetwork(at(-40, -120)) }),
          human('iqse_b', { network: cleanNetwork(at(-41, -121)) }, 5),
          human('iqse_c', {}, 10),
        ],
      });
      expect(valueOf(result, 'inquiry/max_session_distance')).toBe(139_689);
      expect(detailOf(result, 'inquiry/max_session_distance')).toMatchObject({
        reasons: ['approximate', 'partial_sessions'],
        sessions: [
          { 'session-id': 'iqse_a', 'null-reason': null },
          { 'session-id': 'iqse_b', 'null-reason': null },
          { 'session-id': 'iqse_c', 'null-reason': 'location_too_coarse' },
        ],
      });
    });

    it('golden: below two points: insufficient_sessions', () => {
      const result = run({
        sessions: [
          human('iqse_a', { network: cleanNetwork(at(-40, -120)) }),
          human('iqse_b', {}, 5),
        ],
      });
      expect(detailOf(result, 'inquiry/max_session_distance')).toMatchObject({
        'null-reason': 'insufficient_sessions',
        sessions: [
          { 'session-id': 'iqse_a', 'null-reason': null },
          { 'session-id': 'iqse_b', 'null-reason': 'location_too_coarse' },
        ],
      });
    });
  });

  it('golden: the sandbox outcome in a sandbox environment (C90.9)', () => {
    const bodies = [...humanBodies(), webBody(4, { sandboxOutcome: 'bot' })];
    const result = run({ environment: 'sandbox', sessions: [session('iqse_a', { bodies })] });
    expect(valueOf(result, 'inquiry/bot_score')).toBe(95);
    expect(valueOf(result, 'inquiry/behavior_threat_level')).toBe('high');
    expect(detailOf(result, 'inquiry/bot_score')).toMatchObject({
      confidence: 1,
      reasons: ['sandbox_outcome'],
    });
    expect(valueOf(run({ sessions: [session('iqse_a', { bodies })] }), 'inquiry/bot_score')).toBe(
      0,
    );
  });

  it('computes only the signals the template collects, in registry order', () => {
    const result = run({
      sessions: [human('iqse_a')],
      collect: ['inquiry/tor_detected', 'inquiry/bot_score'],
    });
    expect(result.signals.map(({ name }) => name)).toEqual([
      'inquiry/bot_score',
      'inquiry/tor_detected',
    ]);
    expectHonest(result);
  });

  it('keeps every rule of C90.3 over random sessions (property)', () => {
    const random = seededRandom('inquiry-signals-honesty');
    const pick = <Value>(values: readonly Value[]): Value =>
      values[Math.floor(random() * values.length)] as Value;
    for (let run_ = 0; run_ < 150; run_ += 1) {
      const sessions = Array.from({ length: Math.floor(random() * 4) }, (_, index) =>
        session(
          `iqse_${String(index)}`,
          {
            consented: random() < 0.8,
            signalsCollected: random() < 0.8 ? ['session-integrity'] : [],
            network: pick([
              null,
              cleanNetwork(),
              withTor(true),
              withTor(null, 'ipv6_not_covered'),
              withTor(null, 'list_stale'),
              cleanNetwork({ isVpn: true, ...at(-40, -120) }),
              cleanNetwork({ isProxy: false, isDatacenter: true, ...at(-35.5, -150) }),
            ]),
            bodies: pick([
              [],
              humanBodies(),
              [webBody(1, { integrity: integrity({ webdriver: true }) })],
            ]),
            handoffFromSessionId: random() < 0.2 ? 'iqse_0' : null,
          },
          index,
        ),
      );
      const result = computeInquirySignals({
        environment: pick(['sandbox', 'production'] as const),
        collect: 'default',
        computedAt: COMPUTED_AT,
        sessions,
        governmentIdCountry: pick([null, 'FRA', 'ZZ']),
      });
      expectHonest(result);
      expect(valueOf(result, 'inquiry/session_count')).toBe(sessions.length);
    }
    expect(AT.getTime()).toBeLessThan(COMPUTED_AT.getTime());
  });
});
