/**
 * C90.2, C90.4: the inquiry's signal values from its sessions' stored facts, combined across
 * sessions, each with its `signal-details` entry. Pure: the `inquiry-signals` job (`api-signals`)
 * opens the sealed facts, calls {@link computeInquirySignals}, validates the result with the
 * contracts' schemas and freezes it.
 *
 * **Combining sessions** (C90.4, H05). Sessions are read in creation order (ties by id).
 * - **No session** (a server-API inquiry, or one that expired from `created`): `session_count` and
 *   `handoff_count` are 0, every other signal `null` with `signals_not_collected`.
 * - **A boolean** is `true` if any session is `true`; `false` only where the data can be
 *   exhaustive (`tor_detected`, `proxy_detected`) and every session is evaluated `false`;
 *   otherwise `null`. `datacenter_detected` and `vpn_detected` are never `false`.
 * - **A `null` combined value** names one reason: the sessions' common reason when no session
 *   gave a value and they all share it, else `sessions_not_evaluated`, whose `on-null` default is
 *   derived from the sessions' own reasons. `sessions[]` records each session's own reason.
 * - **`network_threat_level`**: `high` if any session is `high`; `null` if any session is `null`;
 *   otherwise the highest level, at the lowest confidence of the sessions at that level, with
 *   their reasons.
 * - **Country signals** read the first session whose country was evaluated; `country_comparison`
 *   is `null` with `ip_country_unreliable` when that session is Tor, a VPN ASN, a provider range
 *   or privacy relay, and `input_missing` without a government ID country to compare.
 * - **`max_session_distance`** is the farthest pair of session points (C95), `partial_sessions`
 *   when a session has no point, `insufficient_sessions` below two points; `sessions[]` names the
 *   two endpoints and every session without a point.
 * - **Behaviour signals** read the consented sessions only (V07), a rejected or declined handoff
 *   session excluded: `bot_score` is the highest score over the sessions that sent a payload and
 *   `behavior_threat_level` the highest level over those with enough behaviour, each from its
 *   session with `partial_sessions` when another consented session gave none;
 *   `automation_artefact_count` is the size of the distinct union of strong artefacts. A
 *   consented session's own reason: `collection_disabled` (the tier did not apply),
 *   `collector_missing` (no payload), `input_missing` (a payload with nothing this signal reads),
 *   `insufficient_behaviour`. With no consented session at all, `consent_not_given`.
 * - A session never evaluated for its network (no network row) reads `input_missing` for every
 *   network signal, so it can never let a `false` through.
 *
 * Sources (C90.3 provenance): the combined network flags serve the sources of every session's
 * network row, the country signals those of the session they read; each once, at most 32.
 */
import {
  DEFAULT_SIGNAL_NAMES,
  NETWORK_SIGNAL_CONSTANTS,
  getSignalDefinition,
  isHeuristicSignalTier,
  signalThresholdValues,
  type SignalDefinition,
  type SignalLevel,
  type SignalName,
} from '@openverify/core';
import { normalizeCountryCode } from '../country-codes.js';
import { sessionBehaviourLevel, type SessionBehaviourLevel } from './behaviour.js';
import {
  COUNTED_ARTEFACTS,
  sessionArtefacts,
  sessionBotScore,
  type CountedArtefact,
  type SessionBotScore,
} from './bot-score.js';
import {
  indicatorConfidence,
  integritySources,
  joinedIndicators,
  sessionIndicators,
  verdictReading,
  type DeviceIndicatorSignal,
  type PlayIntegritySignal,
} from './device-integrity.js';
import { maxSessionDistance, type SessionPoint } from './distance.js';
import { sessionEvidence, type SessionEvidence } from './evidence.js';
import type { InquirySignalsInput, SessionNetworkInput, SignalSessionInput } from './inputs.js';
import { constantValue, factNullReason } from './network-facts.js';
import { sessionThreatLevel } from './threat-level.js';
import type {
  InquirySignalsResult,
  SignalDetailEntry,
  SignalEvidenceReason,
  SignalNullReason,
  SignalSessionReason,
  SignalSourceRef,
  SignalValueEntry,
  SignalValueOf,
} from './vocabulary.js';

/** C90.2: the signals this module computes, in registry order (`list_match_count` is 7B's). */
export const COMPUTED_SIGNAL_NAMES = [
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
  // Workflow 10B (C210.4, C211.5; `device-integrity.ts`): never decisive alone (C210.5).
  'inquiry/device_emulated',
  'inquiry/device_rooted',
  'inquiry/device_hooked',
  'inquiry/device_integrity_level',
  'inquiry/app_recognized',
] as const satisfies readonly SignalName[];
export type ComputedSignalName = (typeof COMPUTED_SIGNAL_NAMES)[number];

/**
 * C90.6: the catalogue names `collect` selects, in registry order, among those this module
 * computes. `inquiry/list_match_count` is 7B's (merged when served, C90.5) and never computed here.
 */
export function resolveCollectedSignals(collect: 'default' | readonly string[]): SignalName[] {
  const wanted: ReadonlySet<string> = new Set(
    collect === 'default' ? DEFAULT_SIGNAL_NAMES : collect,
  );
  return COMPUTED_SIGNAL_NAMES.filter((name) => wanted.has(name));
}

/** The thresholds `signal-details` serves for `name` (C90.3: "the thresholds applied"). */
export function appliedSignalThresholds(name: SignalName): Readonly<Record<string, number>> {
  const entry = getSignalDefinition(name);
  return entry === undefined ? {} : signalThresholdValues(entry);
}

/** What one computation gives the detail builder. */
interface Computed {
  readonly value: SignalValueOf;
  readonly nullReason?: SignalNullReason;
  readonly confidence?: number | null;
  readonly reasons?: readonly SignalEvidenceReason[];
  readonly sessions?: readonly SignalSessionReason[];
  readonly sources?: readonly SignalSourceRef[];
}

/** One session's own outcome inside a combined value. */
type SessionOutcome<Value> =
  | { readonly sessionId: string; readonly value: Value; readonly reason: null }
  | { readonly sessionId: string; readonly value: null; readonly reason: SignalNullReason };

const outcome = <Value>(sessionId: string, value: Value): SessionOutcome<Value> => ({
  sessionId,
  value,
  reason: null,
});
const missing = <Value>(sessionId: string, reason: SignalNullReason): SessionOutcome<Value> => ({
  sessionId,
  value: null,
  reason,
});

const sessionReasons = (outcomes: readonly SessionOutcome<unknown>[]): SignalSessionReason[] =>
  outcomes.map(({ sessionId, reason }) => ({ 'session-id': sessionId, 'null-reason': reason }));

/** C90.4: the reason of a combined `null`: the common one when none gave a value, else derived. */
function combinedNullReason(outcomes: readonly SessionOutcome<unknown>[]): SignalNullReason {
  const reasons = new Set(outcomes.flatMap(({ reason }) => (reason === null ? [] : [reason])));
  const anyValue = outcomes.some(({ reason }) => reason === null);
  const [only] = reasons;
  return !anyValue && reasons.size === 1 && only !== undefined ? only : 'sessions_not_evaluated';
}

const partial = (outcomes: readonly SessionOutcome<unknown>[]): SignalEvidenceReason[] =>
  outcomes.some(({ reason }) => reason !== null) ? ['partial_sessions'] : [];

function uniqueSources(sources: readonly SignalSourceRef[]): SignalSourceRef[] {
  const seen = new Map<string, SignalSourceRef>();
  for (const source of sources) {
    seen.set(JSON.stringify(source), source);
  }
  return [...seen.values()].slice(0, 32);
}

const ANONYMITY: readonly (readonly [keyof SessionNetworkInput, SignalEvidenceReason])[] = [
  ['isTor', 'tor_exit_listed'],
  ['isVpn', 'vpn_asn'],
  ['isDatacenter', 'provider_range'],
];

/** V08: the session's IP country is not where the person is (Tor, VPN ASN, provider range, relay). */
const anonymised = (network: SessionNetworkInput): boolean =>
  network.isTor === true ||
  network.isVpn === true ||
  network.isDatacenter === true ||
  network.privacyRelay === true;

const LEVEL_RANK: Readonly<Record<SignalLevel, number>> = { low: 1, medium: 2, high: 3 };

/** A session's behaviour level that has a level. */
type LevelledBehaviour = Extract<SessionBehaviourLevel, { readonly nullReason: null }>;

/** The collector state of a consented session (C94.6, V07). */
type CollectorState =
  | { readonly sessionId: string; readonly evidence: SessionEvidence; readonly reason: null }
  | { readonly sessionId: string; readonly evidence: null; readonly reason: SignalNullReason };

class InquirySignals {
  private readonly input: InquirySignalsInput;
  private readonly sessions: readonly SignalSessionInput[];
  private readonly collector: readonly CollectorState[];

  constructor(input: InquirySignalsInput) {
    this.input = input;
    this.sessions = [...input.sessions].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
    );
    const consented = this.sessions.filter((session) => session.consented);
    this.collector =
      consented.length === 0
        ? this.sessions.map((session) => ({
            sessionId: session.id,
            evidence: null,
            reason: 'consent_not_given',
          }))
        : consented.map((session): CollectorState => {
            if (!session.signalsCollected.includes('session-integrity')) {
              return { sessionId: session.id, evidence: null, reason: 'collection_disabled' };
            }
            const evidence = sessionEvidence(session, input.environment);
            return evidence.sentPayload
              ? { sessionId: session.id, evidence, reason: null }
              : { sessionId: session.id, evidence: null, reason: 'collector_missing' };
          });
  }

  compute(name: ComputedSignalName): Computed {
    if (name === 'inquiry/session_count') {
      return { value: this.sessions.length };
    }
    if (name === 'inquiry/handoff_count') {
      return {
        value: this.sessions.filter((session) => session.handoffFromSessionId !== null).length,
      };
    }
    if (this.sessions.length === 0) {
      return { value: null, nullReason: 'signals_not_collected' };
    }
    switch (name) {
      // Workflow 10B (C210.4, C211.5): from the stored android-integrity member and the verdict.
      case 'inquiry/device_emulated':
      case 'inquiry/device_rooted':
      case 'inquiry/device_hooked':
        return this.indicators(name);
      case 'inquiry/device_integrity_level':
      case 'inquiry/app_recognized':
        return this.playIntegrity(name);
      case 'inquiry/bot_score':
        return this.botScore();
      case 'inquiry/behavior_threat_level':
        return this.behaviourLevel();
      case 'inquiry/automation_artefact_count':
        return this.artefactCount();
      case 'inquiry/network_threat_level':
        return this.threatLevel();
      case 'inquiry/tor_detected':
        return this.flag('isTor', 'is-tor', 'tor_exit_listed', null);
      case 'inquiry/datacenter_detected':
        return this.flag('isDatacenter', 'is-datacenter', 'provider_range', null, true);
      case 'inquiry/vpn_detected':
        return this.flag(
          'isVpn',
          'is-vpn',
          'vpn_asn',
          constantValue(NETWORK_SIGNAL_CONSTANTS, 'vpn-asn-confidence'),
          true,
        );
      case 'inquiry/proxy_detected':
        return this.flag('isProxy', 'is-proxy', 'proxy_flagged', null, false, 'adapter_negative');
      case 'inquiry/country_from_session':
        return this.countryFromSession();
      case 'inquiry/country_comparison':
        return this.countryComparison();
      case 'inquiry/max_session_distance':
        return this.maxDistance();
    }
  }

  /** Each consented session's outcome of one collector computation. */
  private collected<Value>(
    read: (evidence: SessionEvidence) => SessionOutcome<Value>,
  ): SessionOutcome<Value>[] {
    return this.collector.map((state) =>
      state.evidence === null
        ? missing<Value>(state.sessionId, state.reason)
        : read(state.evidence),
    );
  }

  private botScore(): Computed {
    const outcomes = this.collected<SessionBotScore>((evidence) => {
      const score = sessionBotScore(evidence);
      return score === null
        ? missing(evidence.sessionId, 'input_missing')
        : outcome(evidence.sessionId, score);
    });
    let best: SessionBotScore | null = null;
    for (const { value } of outcomes) {
      if (value !== null && (best === null || value.score > best.score)) {
        best = value;
      }
    }
    const sessions = sessionReasons(outcomes);
    if (best === null) {
      return { value: null, nullReason: combinedNullReason(outcomes), sessions };
    }
    return {
      value: best.score,
      confidence: best.confidence,
      reasons: [...best.reasons, ...partial(outcomes)],
      sessions,
    };
  }

  private behaviourLevel(): Computed {
    const outcomes = this.collected<LevelledBehaviour>((evidence) => {
      const level = sessionBehaviourLevel(evidence);
      return level.nullReason === null
        ? outcome(evidence.sessionId, level)
        : missing(evidence.sessionId, level.nullReason);
    });
    let best: LevelledBehaviour | null = null;
    for (const { value } of outcomes) {
      if (value !== null && (best === null || LEVEL_RANK[value.level] > LEVEL_RANK[best.level])) {
        best = value;
      }
    }
    const sessions = sessionReasons(outcomes);
    if (best === null) {
      return { value: null, nullReason: combinedNullReason(outcomes), sessions };
    }
    return {
      value: best.level,
      confidence: best.confidence,
      reasons: [...best.reasons, ...partial(outcomes)],
      sessions,
    };
  }

  private artefactCount(): Computed {
    const outcomes = this.collected((evidence) => {
      const artefacts = sessionArtefacts(evidence);
      return artefacts === null
        ? missing<typeof artefacts>(evidence.sessionId, 'input_missing')
        : outcome(evidence.sessionId, artefacts);
    });
    const sessions = sessionReasons(outcomes);
    if (outcomes.every(({ value }) => value === null)) {
      return { value: null, nullReason: combinedNullReason(outcomes), sessions };
    }
    const seen = new Set<CountedArtefact>(outcomes.flatMap(({ value }) => value ?? []));
    const union = COUNTED_ARTEFACTS.filter((artefact) => seen.has(artefact));
    return {
      value: union.length,
      reasons: [
        ...(union.length === 0 ? ['no_artefact_found' as const] : union),
        ...partial(outcomes),
      ],
      sessions,
    };
  }

  /** C210.4: a device heuristic, `true` from any consented session's codes, never `false`. */
  private indicators(signal: DeviceIndicatorSignal): Computed {
    const outcomes = this.collected<readonly string[]>((evidence) => {
      const found = sessionIndicators(evidence, signal);
      return found.reason === null
        ? outcome(evidence.sessionId, found.codes)
        : missing(evidence.sessionId, found.reason);
    });
    const sessions = sessionReasons(outcomes);
    const codes = joinedIndicators(
      signal,
      outcomes.flatMap(({ value }) => (value === null ? [] : [value])),
    );
    if (codes.length === 0) {
      return { value: null, nullReason: combinedNullReason(outcomes), sessions };
    }
    return { value: true, confidence: indicatorConfidence(codes), reasons: codes, sessions };
  }

  /** C211.5: a Play Integrity signal from the inquiry's verdict, else why there is none. */
  private playIntegrity(signal: PlayIntegritySignal): Computed {
    const facts = this.input.deviceIntegrity;
    if (facts === undefined) {
      return { value: null, nullReason: 'collector_missing' };
    }
    const sources = integritySources(facts);
    const provenance = sources.length === 0 ? {} : { sources };
    if (facts.verdict !== null) {
      const reading = verdictReading(signal, facts.verdict.projection);
      return reading.nullReason === null
        ? { value: reading.value, ...provenance }
        : { value: null, nullReason: reading.nullReason, ...provenance };
    }
    if (facts.provider === null) {
      return { value: null, nullReason: 'provider_not_configured' };
    }
    if (facts.tokenPending) {
      return { value: null, nullReason: 'collector_missing', ...provenance };
    }
    const collecting = this.collector.flatMap(({ evidence }) =>
      evidence === null ? [] : [evidence],
    );
    if (collecting.length === 0) {
      const gaps = this.collector.map(({ sessionId, reason }) =>
        missing<never>(sessionId, reason ?? 'collector_missing'),
      );
      return { value: null, nullReason: combinedNullReason(gaps), ...provenance };
    }
    return {
      value: null,
      nullReason: collecting.some(({ android }) => android)
        ? 'integrity_token_unavailable'
        : 'not_android',
      ...provenance,
    };
  }

  /** Each session's outcome of one network read; a session never evaluated is `input_missing`. */
  private networked<Value>(
    read: (network: SessionNetworkInput, session: SignalSessionInput) => SessionOutcome<Value>,
  ): SessionOutcome<Value>[] {
    return this.sessions.map((session) =>
      session.network === null
        ? missing<Value>(session.id, 'input_missing')
        : read(session.network, session),
    );
  }

  private allSources(): SignalSourceRef[] {
    return uniqueSources(this.sessions.flatMap((session) => session.network?.sources ?? []));
  }

  /** C90.4: a boolean network flag combined across sessions. */
  private flag(
    key: 'isTor' | 'isDatacenter' | 'isVpn' | 'isProxy',
    field: 'is-tor' | 'is-datacenter' | 'is-vpn' | 'is-proxy',
    trueReason: SignalEvidenceReason,
    trueConfidence: number | null,
    neverFalse = false,
    falseReason?: SignalEvidenceReason,
  ): Computed {
    const outcomes = this.networked<boolean>((network, session) => {
      const value = network[key];
      return value === null || (neverFalse && !value)
        ? missing<boolean>(session.id, factNullReason(network.reasons, field))
        : outcome(session.id, value);
    });
    const common = { sessions: sessionReasons(outcomes), sources: this.allSources() };
    if (outcomes.some(({ value }) => value === true)) {
      return {
        value: true,
        reasons: [trueReason],
        ...(trueConfidence === null ? {} : { confidence: trueConfidence }),
        ...common,
      };
    }
    if (outcomes.every(({ value }) => value === false)) {
      return { value: false, reasons: falseReason === undefined ? [] : [falseReason], ...common };
    }
    return { value: null, nullReason: combinedNullReason(outcomes), ...common };
  }

  private threatLevel(): Computed {
    const outcomes = this.networked((network, session) => {
      const level = sessionThreatLevel(network);
      return level.level === null
        ? missing<typeof level>(session.id, level.nullReason ?? 'list_unavailable')
        : outcome(session.id, level);
    });
    const common = { sessions: sessionReasons(outcomes), sources: this.allSources() };
    const levels = outcomes.flatMap(({ value }) => (value === null ? [] : [value]));
    const anyHigh = levels.some(({ level }) => level === 'high');
    if (!anyHigh && levels.length < outcomes.length) {
      return { value: null, nullReason: combinedNullReason(outcomes), ...common };
    }
    const top = levels.reduce<SignalLevel>(
      (highest, { level }) =>
        level !== null && LEVEL_RANK[level] > LEVEL_RANK[highest] ? level : highest,
      'low',
    );
    const atTop = levels.filter(({ level }) => level === top);
    return {
      value: top,
      confidence: Math.min(...atTop.map(({ confidence }) => confidence ?? 0)),
      reasons: [...new Set(atTop.flatMap(({ reasons }) => reasons))],
      ...common,
    };
  }

  /** The first session whose country was evaluated, and every session's own reason. */
  private firstCountry(): {
    readonly chosen: SignalSessionInput | null;
    readonly outcomes: SessionOutcome<string>[];
  } {
    const outcomes = this.networked<string>((network, session) =>
      network.countryCode === null
        ? missing<string>(session.id, factNullReason(network.reasons, 'country-code'))
        : outcome(session.id, network.countryCode),
    );
    const first = outcomes.find(({ value }) => value !== null);
    return {
      chosen: this.sessions.find((session) => session.id === first?.sessionId) ?? null,
      outcomes,
    };
  }

  private countryFromSession(): Computed {
    const { chosen, outcomes } = this.firstCountry();
    const sessions = sessionReasons(outcomes);
    const network = chosen?.network ?? null;
    if (network?.countryCode == null) {
      return { value: null, nullReason: combinedNullReason(outcomes), sessions };
    }
    return {
      value: network.countryCode,
      confidence: constantValue(NETWORK_SIGNAL_CONSTANTS, 'ip-country-confidence'),
      reasons: [
        'approximate',
        ...ANONYMITY.filter(([key]) => network[key] === true).map(([, reason]) => reason),
      ],
      sessions,
      sources: uniqueSources(network.sources),
    };
  }

  private countryComparison(): Computed {
    const { chosen, outcomes } = this.firstCountry();
    const sessions = sessionReasons(outcomes);
    const network = chosen?.network ?? null;
    if (network?.countryCode == null) {
      return { value: null, nullReason: combinedNullReason(outcomes), sessions };
    }
    const sources = uniqueSources(network.sources);
    if (anonymised(network)) {
      return { value: null, nullReason: 'ip_country_unreliable', sessions, sources };
    }
    const issuing = this.input.governmentIdCountry?.trim() ?? '';
    const key = (code: string) => normalizeCountryCode(code) ?? code.toUpperCase();
    const ipKey = key(network.countryCode);
    const idKey = issuing === '' ? '' : key(issuing);
    if (idKey === '' || idKey.length !== ipKey.length) {
      return { value: null, nullReason: 'input_missing', sessions, sources };
    }
    return {
      value: idKey === ipKey ? 'same' : 'different',
      confidence: constantValue(NETWORK_SIGNAL_CONSTANTS, 'ip-country-confidence'),
      reasons: ['approximate'],
      sessions,
      sources,
    };
  }

  private maxDistance(): Computed {
    const outcomes = this.networked<SessionPoint>((network, session) => {
      if (network.latitude !== null && network.longitude !== null) {
        return outcome(session.id, {
          sessionId: session.id,
          point: { latitude: network.latitude, longitude: network.longitude },
        });
      }
      return missing<SessionPoint>(
        session.id,
        network.countryCode === null
          ? factNullReason(network.reasons, 'location')
          : 'location_too_coarse',
      );
    });
    const points = outcomes.flatMap(({ value }) => (value === null ? [] : [value]));
    const farthest = maxSessionDistance(points);
    const sources = this.allSources();
    if (farthest === null) {
      return {
        value: null,
        nullReason: 'insufficient_sessions',
        sessions: sessionReasons(outcomes),
        sources,
      };
    }
    const named = outcomes.filter(
      ({ sessionId, reason }) => reason !== null || farthest.endpoints.includes(sessionId),
    );
    return {
      value: farthest.meters,
      reasons: ['approximate', ...partial(outcomes)],
      sessions: sessionReasons(named),
      sources,
    };
  }
}

function definitionOf(name: SignalName): SignalDefinition {
  const entry = getSignalDefinition(name);
  if (entry === undefined) {
    throw new Error(`${name} is not a registered signal`);
  }
  return entry;
}

function detailOf(name: SignalName, computed: Computed, computedAt: string): SignalDetailEntry {
  const entry = definitionOf(name);
  const heuristic = isHeuristicSignalTier(entry.tier);
  const thresholds = appliedSignalThresholds(name);
  const isNull = computed.value === null;
  if (heuristic && !isNull && typeof computed.confidence !== 'number') {
    throw new Error(`${name}: an H-tier value carries its confidence`);
  }
  const sources = computed.sources ?? [];
  const sessions = computed.sessions ?? [];
  return {
    tier: entry.tier,
    stage: entry.stage,
    version: entry.version,
    ...(heuristic ? { confidence: isNull ? null : (computed.confidence ?? null) } : {}),
    ...(heuristic || Object.keys(thresholds).length > 0 ? { thresholds } : {}),
    'null-reason': isNull ? (computed.nullReason ?? 'input_missing') : null,
    reasons: isNull ? [] : [...new Set(computed.reasons ?? [])],
    ...(sources.length > 0 ? { sources } : {}),
    ...(sessions.length > 0 ? { sessions } : {}),
    'computed-at': computedAt,
  };
}

/** C90.2, C90.4, C90.5: the inquiry's `signals` and `signal-details`. */
export function computeInquirySignals(input: InquirySignalsInput): InquirySignalsResult {
  const computedAt = input.computedAt.toISOString();
  const signals = new InquirySignals(input);
  const values: SignalValueEntry[] = [];
  const details: Record<string, SignalDetailEntry | string> = { 'computed-at': computedAt };
  for (const name of resolveCollectedSignals(input.collect)) {
    const computed = signals.compute(name as ComputedSignalName);
    values.push({ name, value: computed.value });
    details[name] = detailOf(name, computed, computedAt);
  }
  return {
    signals: values,
    details: details as InquirySignalsResult['details'],
  };
}
