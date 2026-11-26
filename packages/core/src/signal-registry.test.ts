import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  BEHAVIOUR_CONSTANTS,
  BOT_SCORE_CONSTANTS,
  COLLECTOR_CONSTANTS,
  COLLECTOR_VERSION,
  DEFAULT_SIGNAL_NAMES,
  NETWORK_SIGNAL_CONSTANTS,
  SIGNAL_NAMES,
  SIGNAL_NAME_PATTERN,
  SIGNAL_REGISTRY,
  STRONG_AUTOMATION_ARTEFACTS,
  getSignalDefinition,
  isHeuristicSignalTier,
  isSignalName,
  signalThresholdValues,
  type SignalDefinition,
} from './signal-registry.js';

/** The canonical JSON of a constant table: keys sorted, values and bases only. */
function digest(table: Readonly<Record<string, { value: unknown; basis: string }>>): string {
  const canonical = JSON.stringify(
    Object.keys(table)
      .sort()
      .map((key) => [key, table[key]?.value, table[key]?.basis]),
  );
  return createHash('sha256').update(canonical).digest('hex');
}

const entry = (name: string): SignalDefinition => {
  const found = getSignalDefinition(name);
  if (found === undefined) {
    throw new Error(`no ${name}`);
  }
  return found;
};

describe('the signal registry (C90.1, C90.2)', () => {
  it('holds the thirteen 7A signals and the 7B list count in the catalogue order', () => {
    expect(SIGNAL_NAMES).toEqual([
      'inquiry/bot_score',
      'inquiry/behavior_threat_level',
      'inquiry/automation_artefact_count',
      'inquiry/session_count',
      'inquiry/network_threat_level',
      'inquiry/tor_detected',
      'inquiry/datacenter_detected',
      'inquiry/vpn_detected',
      'inquiry/proxy_detected',
      'inquiry/country_from_session',
      'inquiry/country_comparison',
      'inquiry/max_session_distance',
      'inquiry/handoff_count',
      // Workflow 10B (C210.4, C211.5)
      'inquiry/device_emulated',
      'inquiry/device_rooted',
      'inquiry/device_hooked',
      'inquiry/device_integrity_level',
      'inquiry/app_recognized',
      'inquiry/list_match_count',
    ]);
  });

  it('has unique names in the inquiry/ namespace, snake case after the slash', () => {
    expect(new Set(SIGNAL_NAMES).size).toBe(SIGNAL_NAMES.length);
    for (const name of SIGNAL_NAMES) {
      expect(name).toMatch(SIGNAL_NAME_PATTERN);
    }
    expect(isSignalName('inquiry/bot_score')).toBe(true);
    expect(isSignalName('inquiry/list_match_count')).toBe(true);
    expect(isSignalName('inquiry/not_a_signal')).toBe(false);
    expect(isSignalName(7)).toBe(false);
    expect(getSignalDefinition('inquiry/unknown')).toBeUndefined();
  });

  it('marks the public names, and only those, as public', () => {
    expect(SIGNAL_REGISTRY.filter((signal) => signal.public).map((signal) => signal.name)).toEqual([
      'inquiry/bot_score',
      'inquiry/behavior_threat_level',
      'inquiry/country_from_session',
      'inquiry/country_comparison',
    ]);
  });

  it('records the catalogue table: tier, stage and collection tier of each signal', () => {
    expect(
      SIGNAL_REGISTRY.map(({ name, tier, stage, collectionTier, layer }) => [
        name.slice('inquiry/'.length),
        tier,
        stage,
        collectionTier,
        layer,
      ]),
    ).toEqual([
      ['bot_score', 'H', 'beta', 'session-integrity', 'behaviour'],
      ['behavior_threat_level', 'H', 'beta', 'session-integrity', 'behaviour'],
      ['automation_artefact_count', 'R', 'ga', 'session-integrity', 'device'],
      ['session_count', 'R', 'ga', 'server', 'ensemble'],
      ['network_threat_level', 'H', 'beta', 'server', 'network'],
      ['tor_detected', 'R', 'ga', 'server', 'network'],
      ['datacenter_detected', 'R', 'ga', 'server', 'network'],
      ['vpn_detected', 'H', 'beta', 'server', 'network'],
      ['proxy_detected', 'A', 'beta', 'server', 'network'],
      ['country_from_session', 'H', 'beta', 'server', 'network'],
      ['country_comparison', 'H', 'beta', 'server', 'ensemble'],
      ['max_session_distance', 'R', 'ga', 'server', 'network'],
      ['handoff_count', 'R', 'ga', 'server', 'handoff'],
      ['device_emulated', 'H', 'beta', 'session-integrity', 'device'],
      ['device_rooted', 'H', 'beta', 'session-integrity', 'device'],
      ['device_hooked', 'H', 'beta', 'session-integrity', 'device'],
      ['device_integrity_level', 'A', 'beta', 'session-integrity', 'device'],
      ['app_recognized', 'A', 'beta', 'session-integrity', 'device'],
      ['list_match_count', 'R', 'ga', 'server', 'list'],
    ]);
  });

  it('keeps every H-tier or combined entry beta, with thresholds (ADR 0002 §2)', () => {
    for (const signal of SIGNAL_REGISTRY) {
      if (isHeuristicSignalTier(signal.tier)) {
        expect(signal.stage, signal.name).toBe('beta');
        expect(Object.keys(signal.thresholds).length, signal.name).toBeGreaterThan(0);
      }
    }
    expect(isHeuristicSignalTier('R/H')).toBe(true);
    expect(isHeuristicSignalTier('R+A')).toBe(false);
  });

  it('gives every distance a unit, and only distances', () => {
    expect(SIGNAL_REGISTRY.filter((signal) => signal.unit !== null).map((s) => s.name)).toEqual([
      'inquiry/max_session_distance',
    ]);
    expect(entry('inquiry/max_session_distance').unit).toBe('meters');
  });

  it('types the never-false flags true-or-null (C90.3)', () => {
    expect(SIGNAL_REGISTRY.filter((signal) => signal.neverFalse).map((s) => s.name)).toEqual([
      'inquiry/datacenter_detected',
      'inquiry/vpn_detected',
      // Workflow 10B (C210.4): a clean probe is never "not rooted".
      'inquiry/device_emulated',
      'inquiry/device_rooted',
      'inquiry/device_hooked',
    ]);
  });

  it('closes the vocabulary of every enum and string signal (C90.5)', () => {
    for (const signal of SIGNAL_REGISTRY) {
      if (signal.valueType === 'enum' || signal.valueType === 'string') {
        expect(signal.values, signal.name).not.toBeNull();
      }
    }
    expect(entry('inquiry/behavior_threat_level').values).toEqual(['low', 'medium', 'high']);
    expect(entry('inquiry/country_comparison').values).toEqual(['same', 'different']);
    expect(entry('inquiry/bot_score').range).toEqual({ min: 0, max: 100 });
    expect(entry('inquiry/session_count').range).toEqual({ min: 0, max: null });
  });

  it('collects every signal by default, and lets a review rule test each but the list count (F31)', () => {
    expect(DEFAULT_SIGNAL_NAMES).toEqual(SIGNAL_NAMES);
    expect(SIGNAL_REGISTRY.filter((signal) => !signal.reviewRule).map((s) => s.name)).toEqual([
      'inquiry/list_match_count',
    ]);
  });

  it('registers the list count as a count of the lists, never false and never tuned (C90.2, C99.3)', () => {
    expect(entry('inquiry/list_match_count')).toMatchObject({
      public: false,
      tier: 'R',
      stage: 'ga',
      version: 1,
      valueType: 'integer',
      range: { min: 0, max: null },
      inputs: ['lists'],
      thresholds: {},
    });
  });

  it('marks the IP-derived values approximate (V08)', () => {
    expect(SIGNAL_REGISTRY.filter((signal) => signal.approximate).map((s) => s.name)).toEqual([
      'inquiry/country_from_session',
      'inquiry/country_comparison',
      'inquiry/max_session_distance',
    ]);
  });

  it('serves each threshold as its value', () => {
    expect(signalThresholdValues(entry('inquiry/vpn_detected'))).toEqual({
      'vpn-asn-confidence': 0.6,
    });
    expect(signalThresholdValues(entry('inquiry/max_session_distance'))).toEqual({
      'ip-city-uncertainty-meters': 50_000,
    });
  });

  it('lists the strong automation artefacts the count reads (C94.3)', () => {
    expect(STRONG_AUTOMATION_ARTEFACTS).toEqual([
      'webdriver',
      'driver_globals',
      'ua_headless_marker',
      'untrusted_events',
    ]);
  });
});

describe('the signal constants (C93.4, C94.3, C94.8, C95.3)', () => {
  it('are provisional, each with a source', () => {
    for (const table of [
      COLLECTOR_CONSTANTS,
      BOT_SCORE_CONSTANTS,
      BEHAVIOUR_CONSTANTS,
      NETWORK_SIGNAL_CONSTANTS,
    ]) {
      expect(Object.keys(table).length).toBeGreaterThan(0);
      for (const constant of Object.values(table)) {
        expect(constant.basis).toBe('provisional');
        expect(constant.source.length).toBeGreaterThan(10);
      }
    }
  });

  it('hold the plan values', () => {
    const values = (table: Readonly<Record<string, { value: unknown }>>) =>
      Object.fromEntries(Object.entries(table).map(([key, constant]) => [key, constant.value]));
    expect(values(BOT_SCORE_CONSTANTS)).toEqual({
      'strong-artefact-floor': 90,
      'medium-evidence-min': 10,
      'medium-evidence-max': 25,
      'weak-evidence-max': 5,
      'medium-weak-cap': 60,
      'strong-band': 70,
      'low-score-confidence-cap': 0.5,
      'fast-screen-floor-seconds': 2,
      'many-focus-losses-min': 10,
      'long-hidden-seconds-min': 300,
    });
    expect(values(BEHAVIOUR_CONSTANTS)).toEqual({
      'min-screens': 3,
      'min-input-events': 20,
      'low-confidence-cap': 0.5,
    });
    expect(values(NETWORK_SIGNAL_CONSTANTS)).toEqual({
      'tor-exit-window-hours': 24,
      'threat-low-confidence-cap': 0.5,
      'threat-low-confidence-cap-with-adapter': 0.8,
      'vpn-asn-confidence': 0.6,
      'hosting-asn-confidence': 0.5,
      'ip-country-confidence': 0.8,
      'ip-city-uncertainty-meters': 50_000,
    });
    expect(values(COLLECTOR_CONSTANTS)).toEqual({
      'typing-cadence-min-intervals': 8,
      'typing-cadence-uniform-cv': 0.1,
      'first-input-fast-seconds': 0.25,
      'first-input-quick-seconds': 1,
      'first-input-slow-seconds': 5,
      'dwell-seconds-cap': 3600,
    });
  });

  /**
   * H24: a threshold or collector constant that changes without a version bump fails here. When
   * a constant changes, bump the version of every entry that applies it (or COLLECTOR_VERSION) and
   * re-pin the digest beside the new version.
   */
  it('holds every cut-off a signal applies: the two weak rules join the bot score (K7A-12)', () => {
    expect(BOT_SCORE_CONSTANTS['many-focus-losses-min']).toMatchObject({
      value: 10,
      basis: 'provisional',
    });
    expect(BOT_SCORE_CONSTANTS['long-hidden-seconds-min']).toMatchObject({
      value: 300,
      basis: 'provisional',
    });
    const behaviour = SIGNAL_REGISTRY.find(
      (signal) => signal.name === 'inquiry/behavior_threat_level',
    );
    expect(behaviour?.inputs).toEqual(['integrity', 'behaviour']);
    // Workflow 10B Stage 1a amendment 17: the Android debugger facts feed these two, not the level.
    expect(SIGNAL_REGISTRY.find((signal) => signal.name === 'inquiry/bot_score')?.inputs).toEqual([
      'integrity',
      'android-integrity',
      'behaviour',
      'request-headers',
    ]);
    expect(
      SIGNAL_REGISTRY.find((signal) => signal.name === 'inquiry/automation_artefact_count')?.inputs,
    ).toEqual(['integrity', 'android-integrity']);
    expect(Object.keys(behaviour?.thresholds ?? {})).toEqual(
      expect.arrayContaining([
        'strong-artefact-floor',
        'medium-weak-cap',
        'many-focus-losses-min',
        'long-hidden-seconds-min',
      ]),
    );
  });

  it('keeps the Tor window in the registry, provisional, and bumps no signal (K7A-13)', () => {
    expect(NETWORK_SIGNAL_CONSTANTS['tor-exit-window-hours']).toMatchObject({
      value: 24,
      basis: 'provisional',
    });
  });

  it('pins every entry and the collector by version (golden)', () => {
    expect(
      Object.fromEntries(
        SIGNAL_REGISTRY.map((signal) => [
          signal.name,
          `${String(signal.version)}:${digest(signal.thresholds).slice(0, 16)}`,
        ]),
      ),
    ).toEqual({
      'inquiry/bot_score': '3:a61c4116a2fe9831',
      'inquiry/behavior_threat_level': '2:6ce009f1845e220e',
      'inquiry/automation_artefact_count': '2:4f53cda18c2baa0c',
      'inquiry/session_count': '1:4f53cda18c2baa0c',
      'inquiry/network_threat_level': '1:c2bd81091806782c',
      'inquiry/tor_detected': '1:4f53cda18c2baa0c',
      'inquiry/datacenter_detected': '1:4f53cda18c2baa0c',
      'inquiry/vpn_detected': '1:4bd43a70cf78d520',
      'inquiry/proxy_detected': '1:4f53cda18c2baa0c',
      'inquiry/country_from_session': '1:ebe03e91a308d9f0',
      'inquiry/country_comparison': '1:ebe03e91a308d9f0',
      'inquiry/max_session_distance': '1:f2199f2e71cae629',
      'inquiry/handoff_count': '1:4f53cda18c2baa0c',
      'inquiry/list_match_count': '1:4f53cda18c2baa0c',
      'inquiry/device_emulated': '1:b5395570056f847d',
      'inquiry/device_rooted': '1:b5395570056f847d',
      'inquiry/device_hooked': '1:b5395570056f847d',
      'inquiry/device_integrity_level': '1:4f53cda18c2baa0c',
      'inquiry/app_recognized': '1:4f53cda18c2baa0c',
    });
    expect(`${String(COLLECTOR_VERSION)}:${digest(COLLECTOR_CONSTANTS).slice(0, 16)}`).toBe(
      '1:930228de3879e65f',
    );
  });
});
