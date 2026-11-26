/**
 * Test support for the signal logic: a seeded random source for the property tests, and builders
 * of synthetic sessions, bodies and network facts. Every address-free fact is fictional: ASNs from
 * 64496-64511, the sandbox country `ZZ`, points in open ocean (C111.1). Not exported from the
 * package entry.
 */
import { createHash } from 'node:crypto';
import type {
  BehaviourInput,
  IntegrityInput,
  SessionNetworkInput,
  SignalBodyInput,
  SignalSessionInput,
} from './inputs.js';

/** A deterministic uniform source in [0, 1) from a seed string (mulberry32 over a SHA-256 seed). */
export function seededRandom(seed: string): () => number {
  let state = createHash('sha256').update(seed).digest().readUInt32LE(0);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** A clean integrity member: nothing automated seen. */
export function integrity(overrides: Partial<IntegrityInput> = {}): IntegrityInput {
  return {
    webdriver: false,
    'driver-globals': [],
    'ua-headless-marker': false,
    'zero-window-with-focus': false,
    'plugins-inconsistent': false,
    'mime-inconsistent': false,
    'native-function-tampered': false,
    'untrusted-event-count': 0,
    'client-hints': null,
    timezone: null,
    languages: [],
    ...overrides,
  };
}

/** One screen of ordinary human behaviour: some typing with corrections, a mouse, 40 seconds. */
export function behaviour(overrides: Partial<BehaviourInput> = {}): BehaviourInput {
  return {
    'paste-count': 0,
    'drop-count': 0,
    'autofill-count': 0,
    'correction-count': 2,
    'focus-loss-count': 0,
    'hidden-count': 0,
    'input-event-count': 12,
    'dwell-seconds': 40,
    'hidden-seconds': 0,
    'first-input-bucket': '1-5s',
    'typing-cadence': 'variable',
    'pointer-types': ['mouse'],
    'pointer-before-click': 'true',
    ...overrides,
  };
}

/** A web body for `screen`. */
export function webBody(
  sequence: number,
  overrides: Partial<SignalBodyInput> = {},
): SignalBodyInput {
  return {
    screen: `step_${String(sequence)}`,
    screenType: 'form',
    sequence,
    platform: 'web',
    ...overrides,
  };
}

/** Network facts of a public IPv4 address on fresh lists with nothing listed (no adapter). */
export function cleanNetwork(overrides: Partial<SessionNetworkInput> = {}): SessionNetworkInput {
  return {
    isTor: false,
    isDatacenter: null,
    isVpn: null,
    isProxy: null,
    hostingAsn: null,
    privacyRelay: null,
    countryCode: 'ZZ',
    latitude: null,
    longitude: null,
    asn: 64_501,
    reasons: [
      { field: 'is-datacenter', reason: 'not_in_known_ranges' },
      { field: 'is-vpn', reason: 'not_in_known_ranges' },
      { field: 'hosting-asn', reason: 'not_in_known_ranges' },
      { field: 'is-proxy', reason: 'provider_not_configured' },
      { field: 'location', reason: 'list_unavailable' },
      { field: 'privacy-relay', reason: 'list_unavailable' },
    ],
    sources: [],
    ...overrides,
  };
}

export const AT = new Date('2026-10-30T12:00:00.000Z');

/** A consented web session with the session-integrity tier, at `AT` plus `minutes`. */
export function session(
  id: string,
  overrides: Partial<SignalSessionInput> = {},
  minutes = 0,
): SignalSessionInput {
  return {
    id,
    createdAt: new Date(AT.getTime() + minutes * 60_000),
    consented: true,
    signalsCollected: ['session-integrity'],
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    network: cleanNetwork(),
    bodies: [],
    handoffFromSessionId: null,
    ...overrides,
  };
}
