/**
 * Signals (plan C90.1, C90.2, ADR 0006): the registry of every inquiry signal, mirroring the check
 * registry. One entry per signal: its public wire name, layer, the tier of its evidence, stage,
 * version, value type, unit, collection tier, whether the default set collects it, whether a
 * template review rule may test it, the inputs it reads, and, for an H-tier or combined entry,
 * every threshold it applies as a {@link ConfigDefault} with its basis and source.
 *
 * Honesty (C90.3): an unknown is `null`, never `false`; a signal whose data is never exhaustive is
 * typed true-or-null (`neverFalse`); no signal passes, fails or declines anything. Every constant
 * here is `provisional`: no calibration report exists, and none is tuned on test data. A constant
 * that changes needs a version bump of every entry (or of the collector) that applies it, which a
 * golden test enforces.
 *
 * Owners: `contracts-7a` froze the catalogue and the constants (Workflow 7A Stage 1a); the
 * computations are `signal-logic`'s (`packages/checks/src/signals/`), which read these constants.
 * `inquiry/list_match_count` was added by `contracts-7b` as an amendment (F31).
 */
import { z } from 'zod';
import { provisionalDefault, type ConfigDefault } from './check-config/basis.js';
import type { CheckStage } from './enums.js';

/** C90.1: the layer a signal describes. */
export const SIGNAL_LAYERS = [
  'network',
  'device',
  'behaviour',
  'handoff',
  'list',
  'ensemble',
] as const;
export const signalLayerSchema = z.enum(SIGNAL_LAYERS);
export type SignalLayer = z.infer<typeof signalLayerSchema>;

/**
 * C90.1 (H14): ADR 0002's tiers and its combined tiers. `R/H` is R from one kind of evidence and H
 * from another; `signal-details.tier` is the tier of the evidence actually used.
 */
export const SIGNAL_TIERS = ['R', 'H', 'A', 'R/H', 'R+A', 'A/H', 'H/A'] as const;
export const signalTierSchema = z.enum(SIGNAL_TIERS);
export type SignalTier = z.infer<typeof signalTierSchema>;

/** Tiers that carry a confidence, reasons and the thresholds applied (ADR 0002 §3c). */
export const HEURISTIC_SIGNAL_TIERS: readonly SignalTier[] = Object.freeze([
  'H',
  'R/H',
  'A/H',
  'H/A',
]);

/** Whether `tier` is H or a combined tier with H (C90.3). */
export function isHeuristicSignalTier(tier: SignalTier): boolean {
  return HEURISTIC_SIGNAL_TIERS.includes(tier);
}

/** C90.1: the JSON type of a signal's value. */
export const SIGNAL_VALUE_TYPES = ['boolean', 'integer', 'number', 'enum', 'string'] as const;
export type SignalValueType = (typeof SIGNAL_VALUE_TYPES)[number];

/**
 * C90.2, C94.6 (V20): what a signal's collection depends on. `server` signals come only from
 * server-side facts (the address the API records under C10, the sessions, the lists) and are
 * computed whatever `session-integrity` says; the two collector tiers follow the collection
 * settings and the template's notice and consent keys.
 */
export const SIGNAL_COLLECTION_TIERS = [
  'server',
  'session-integrity',
  'device-recognition',
] as const;
export const signalCollectionTierSchema = z.enum(SIGNAL_COLLECTION_TIERS);
export type SignalCollectionTier = z.infer<typeof signalCollectionTierSchema>;

/** C94.6: the two browser and device collection tiers an environment switches. */
export const COLLECTOR_TIERS = ['session-integrity', 'device-recognition'] as const;
export type CollectorTier = (typeof COLLECTOR_TIERS)[number];

/** C90.2, C93.4: the threat and behaviour levels. */
export const SIGNAL_LEVELS = ['low', 'medium', 'high'] as const;
export type SignalLevel = (typeof SIGNAL_LEVELS)[number];

/** C90.2: the vocabulary of `inquiry/country_comparison` (ours). */
export const COUNTRY_COMPARISONS = ['same', 'different'] as const;

/** C90.1: a signal's public wire name, namespaced `inquiry/`, snake case after the slash. */
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
export const SIGNAL_NAME_PATTERN = /^inquiry\/[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
export type SignalName = `inquiry/${string}`;

export interface SignalDefinition {
  readonly name: SignalName;
  /** Whether the public product uses this name; the others are ours, and the docs say so. */
  readonly public: boolean;
  readonly layer: SignalLayer;
  readonly tier: SignalTier;
  /** Explicit on every entry; H-tier and combined entries are `beta` (ADR 0002 §2). */
  readonly stage: CheckStage;
  /** Bumped when the computation, an input or a threshold changes. */
  readonly version: number;
  readonly valueType: SignalValueType;
  /** The closed vocabulary of an `enum` signal; a `string` signal needs one too (C90.5). */
  readonly values: readonly string[] | null;
  /** The bounds of an `integer` or `number` signal. */
  readonly range: Readonly<{ min: number; max: number | null }> | null;
  /** `meters` for every distance (C95), otherwise `null`. */
  readonly unit: 'meters' | null;
  /**
   * C90.3: the data is never exhaustive for the question, so the value is `true` or `null` and
   * never `false` (the schemas type it so).
   */
  readonly neverFalse: boolean;
  /** An IP-derived value is approximate (C93.3, V08); `signal-details` says so in its reasons. */
  readonly approximate: boolean;
  readonly collectionTier: SignalCollectionTier;
  /** Whether `signal-config.collect: "default"` collects it. */
  readonly default: boolean;
  /** Whether a template review rule may test it (F31); refused at publish otherwise. */
  readonly reviewRule: boolean;
  /** The session facts, collector sections or lists it reads. */
  readonly inputs: readonly string[];
  /** Every constant an H-tier or combined entry applies, served in `signal-details.thresholds`. */
  readonly thresholds: Readonly<Record<string, ConfigDefault>>;
  /**
   * C150.9 (Phase 9 decision 68; a labelled C90.1 amendment): whether a flow branch may read it,
   * through a provisional snapshot computed from the session facts stored so far. True only when
   * every input exists before completion (network, device and session facts); false for any signal
   * fed by a verification or a screening. False unless an entry says otherwise, so a new signal is
   * refused in flows until someone decides. It changes no signal's version: the computation is the
   * same, only when a branch may read it.
   */
  readonly flowProvisional: boolean;
  /**
   * C210.5 (Workflow 10B; decision 32, a labelled C90.1 amendment): whether a route reading it may
   * lead to an adverse step (a flow's failure, a workflow's decline) with no verification outcome in
   * between. True unless an entry says otherwise; the device-integrity signals say false.
   */
  readonly decisiveAlone: boolean;
}

// ---------------------------------------------------------------------------------------------
// Constants (C93.4, C94.3, C94.8, C95.3). Every one is provisional, with its basis.

const NO_CALIBRATION = 'no calibration report exists (ADR 0002 §3f); not tuned on any test data';

/**
 * C94.3, C90.1 (H24): the browser collector's own cut-offs, tied to {@link COLLECTOR_VERSION}.
 * The collector reduces in the browser; the server never sees the intervals or timings.
 */
export const COLLECTOR_VERSION = 1;
export const COLLECTOR_CONSTANTS: Readonly<Record<string, ConfigDefault>> = Object.freeze({
  'typing-cadence-min-intervals': provisionalDefault(
    8,
    `C94.3 and docs/research/phase7-client-signals.md §3.3: at least 8 keydown intervals before a cadence class; fewer read "insufficient"; ${NO_CALIBRATION}`,
  ),
  'typing-cadence-uniform-cv': provisionalDefault(
    0.1,
    `C94.3: the coefficient of variation of the intervals below which a cadence reads "uniform" (scripted regularity); human typing varies far more; unmeasured; ${NO_CALIBRATION}`,
  ),
  'first-input-fast-seconds': provisionalDefault(
    0.25,
    'C94.3: the first fixed edge of first-input-bucket (<0.25s)',
  ),
  'first-input-quick-seconds': provisionalDefault(
    1,
    'C94.3: the second fixed edge of first-input-bucket (0.25-1s)',
  ),
  'first-input-slow-seconds': provisionalDefault(
    5,
    'C94.3: the third fixed edge of first-input-bucket (1-5s, then >5s)',
  ),
  'dwell-seconds-cap': provisionalDefault(
    3600,
    'C94.3: dwell-seconds is capped at 3,600 per screen',
  ),
});

/** C94.8: the `bot_score` constants that `signal-logic`'s `BOT_SCORE_RULES` applies. */
export const BOT_SCORE_CONSTANTS: Readonly<Record<string, ConfigDefault>> = Object.freeze({
  'strong-artefact-floor': provisionalDefault(
    90,
    `C94.8: one strong automation artefact (webdriver, driver globals, untrusted input events, a headless marker) sets the score to at least 90; ${NO_CALIBRATION}`,
  ),
  'medium-evidence-min': provisionalDefault(10, 'C94.8: each medium item adds 10 to 25'),
  'medium-evidence-max': provisionalDefault(25, 'C94.8: each medium item adds 10 to 25'),
  'weak-evidence-max': provisionalDefault(5, 'C94.8: each weak item adds 0 to 5'),
  'medium-weak-cap': provisionalDefault(
    60,
    'C94.8 (P24): medium and weak evidence together never exceed 60, so voice control, switch access and keyboard-only use stay out of the bot band',
  ),
  'strong-band': provisionalDefault(
    70,
    'C94.8 (P24): a score of 70 or more needs a strong artefact',
  ),
  'low-score-confidence-cap': provisionalDefault(
    0.5,
    'C94.8 (H06): below the medium band the confidence is the share of evidence groups collected, capped here: absence of evidence is not proof',
  ),
  'fast-screen-floor-seconds': provisionalDefault(
    2,
    `C94.8: a screen completed faster than this is medium evidence (FAST_SCREEN_FLOOR_SECONDS); unmeasured; ${NO_CALIBRATION}`,
  ),
  'many-focus-losses-min': provisionalDefault(
    10,
    'C94.8 weak evidence ("many focus losses"), summed over a session\'s screens; unmeasured; set high so that fetching a one-time code or a document from another app does not reach it; adds 5 points at most; no calibration report exists; not tuned on any test data',
  ),
  'long-hidden-seconds-min': provisionalDefault(
    300,
    'C94.8 weak evidence ("long hidden periods"), summed over a session\'s screens; unmeasured; five minutes, so that reading a message or finding a document does not reach it; adds 5 points at most; no calibration report exists; not tuned on any test data',
  ),
});

/** C94.8: the `behavior_threat_level` constants of `signal-logic`'s `BEHAVIOUR_RULES`. */
export const BEHAVIOUR_CONSTANTS: Readonly<Record<string, ConfigDefault>> = Object.freeze({
  'min-screens': provisionalDefault(
    3,
    'C94.8: at least 3 screens with aggregates, else insufficient_behaviour',
  ),
  'min-input-events': provisionalDefault(
    20,
    'C94.8: at least 20 input events in total, else insufficient_behaviour',
  ),
  'low-confidence-cap': provisionalDefault(
    0.5,
    'C94.8 (H06): a low level carries the same capped confidence as a low bot score',
  ),
});

/** C94.8: the bot-score constants the behaviour level applies besides its own. */
const BEHAVIOUR_BOT_SCORE_KEYS = [
  'strong-artefact-floor',
  'strong-band',
  'medium-evidence-max',
  'weak-evidence-max',
  'medium-weak-cap',
  'fast-screen-floor-seconds',
  'many-focus-losses-min',
  'long-hidden-seconds-min',
] as const;

/** C93.3, C93.4, C95.3: the network constants (`THREAT_LEVEL_RULES` reads the caps). */
export const NETWORK_SIGNAL_CONSTANTS: Readonly<Record<string, ConfigDefault>> = Object.freeze({
  'tor-exit-window-hours': provisionalDefault(
    24,
    'C93.3 and decision 11: an exit counts when TorDNSEL saw it within 24 h of the list; research §3.4 (a relay that left can stay listed for a while); unmeasured',
  ),
  'threat-low-confidence-cap': provisionalDefault(
    0.5,
    'C93.4 (H04): THREAT_LEVEL_LOW_CONFIDENCE_CAP without an ipReputation adapter: low means "no listed risk found", not clean',
  ),
  'threat-low-confidence-cap-with-adapter': provisionalDefault(
    0.8,
    'C93.4 (H04): THREAT_LEVEL_LOW_CONFIDENCE_CAP with a bound adapter; residential proxies and most VPNs stay invisible',
  ),
  'vpn-asn-confidence': provisionalDefault(
    0.6,
    `C93.3: the confidence of a VPN-ASN hit; an ASN-level list cannot tell VPN egress from other customers of the same network; ${NO_CALIBRATION}`,
  ),
  'hosting-asn-confidence': provisionalDefault(
    0.5,
    `C93.3 (H13): the confidence of a hosting-ASN hit; hosting networks also carry offices and residential resale; ${NO_CALIBRATION}`,
  ),
  'ip-country-confidence': provisionalDefault(
    0.8,
    `C90.2 (V08): the confidence of an IP country; DB-IP publishes no accuracy for its Lite country edition, and an IP country is wrong for VPNs, roaming and corporate egress; ${NO_CALIBRATION}`,
  ),
  'ip-city-uncertainty-meters': provisionalDefault(
    50_000,
    'C95.3 (H29): IP_CITY_UNCERTAINTY_METERS; unmeasured, chosen as a coarse city radius, because DB-IP Lite publishes no accuracy radius; a calibration task',
  ),
});

/** The constants a signal applies, by key, served in `signal-details.thresholds`. */
/**
 * C210.4 (Workflow 10B): the device-integrity heuristics' confidence, which grows with the number of
 * independent indicator families a signal's indicators come from (build properties, files and mounts,
 * the process). Provisional, ours: no calibration exists (ADR 0002 §3f) and every probe runs in an
 * environment an attacker may control (C210.6), so even three families stay below certainty.
 */
export const DEVICE_INTEGRITY_CONSTANTS: Readonly<Record<string, ConfigDefault>> = Object.freeze({
  'confidence-one-family': provisionalDefault(
    0.5,
    `C210.4: one indicator family; ${NO_CALIBRATION}`,
  ),
  'confidence-two-families': provisionalDefault(
    0.7,
    `C210.4: two independent families; ${NO_CALIBRATION}`,
  ),
  'confidence-three-families': provisionalDefault(
    0.85,
    `C210.4: three or more families; ${NO_CALIBRATION}`,
  ),
});

/** C211.5 (Workflow 10B): Play Integrity's device recognition levels, strongest first. */
export const DEVICE_INTEGRITY_LEVELS = ['strong', 'device', 'basic', 'none'] as const;

function pick(
  table: Readonly<Record<string, ConfigDefault>>,
  ...keys: string[]
): Readonly<Record<string, ConfigDefault>> {
  return Object.freeze(
    Object.fromEntries(
      keys.map((key) => {
        const value = table[key];
        if (value === undefined) {
          throw new Error(`unknown signal constant ${key}`);
        }
        return [key, value];
      }),
    ),
  );
}

type Entry = Omit<
  SignalDefinition,
  | 'name'
  | 'public'
  | 'values'
  | 'range'
  | 'unit'
  | 'neverFalse'
  | 'approximate'
  | 'default'
  | 'reviewRule'
  | 'thresholds'
  | 'flowProvisional'
  | 'decisiveAlone'
> &
  Partial<
    Pick<
      SignalDefinition,
      | 'values'
      | 'range'
      | 'unit'
      | 'neverFalse'
      | 'approximate'
      | 'default'
      | 'reviewRule'
      | 'thresholds'
      | 'flowProvisional'
      | 'decisiveAlone'
    >
  >;

function signal(name: SignalName, isPublic: boolean, fields: Entry): SignalDefinition {
  return Object.freeze({
    name,
    public: isPublic,
    values: null,
    range: null,
    unit: null,
    neverFalse: false,
    approximate: false,
    default: true,
    reviewRule: true,
    thresholds: Object.freeze({}),
    flowProvisional: false,
    decisiveAlone: true,
    ...fields,
    inputs: Object.freeze([...fields.inputs]),
    ...(fields.values === undefined || fields.values === null
      ? {}
      : { values: Object.freeze([...fields.values]) }),
  });
}

const COUNT = Object.freeze({ min: 0, max: null });

/**
 * C90.2: the Phase 7 catalogue in registry order, which is the order of the inquiry's `signals`
 * array. Thirteen entries; `contracts-7b` appends `inquiry/list_match_count`.
 */
export const SIGNAL_REGISTRY: readonly SignalDefinition[] = Object.freeze([
  signal('inquiry/bot_score', true, {
    flowProvisional: true,
    layer: 'behaviour',
    tier: 'H',
    stage: 'beta',
    // Workflow 10B Stage 1a amendment 17: version 3 reads Android's debugger facts.
    version: 3,
    valueType: 'integer',
    range: Object.freeze({ min: 0, max: 100 }),
    collectionTier: 'session-integrity',
    inputs: ['integrity', 'android-integrity', 'behaviour', 'request-headers'],
    thresholds: BOT_SCORE_CONSTANTS,
  }),
  signal('inquiry/behavior_threat_level', true, {
    flowProvisional: true,
    layer: 'behaviour',
    tier: 'H',
    stage: 'beta',
    version: 2,
    valueType: 'enum',
    values: SIGNAL_LEVELS,
    collectionTier: 'session-integrity',
    inputs: ['integrity', 'behaviour'],
    thresholds: Object.freeze({
      ...BEHAVIOUR_CONSTANTS,
      ...pick(BOT_SCORE_CONSTANTS, ...BEHAVIOUR_BOT_SCORE_KEYS),
    }),
  }),
  signal('inquiry/automation_artefact_count', false, {
    flowProvisional: true,
    layer: 'device',
    tier: 'R',
    stage: 'ga',
    // Workflow 10B Stage 1a amendment 17: version 2 counts a connected Android debugger.
    version: 2,
    valueType: 'integer',
    range: COUNT,
    collectionTier: 'session-integrity',
    inputs: ['integrity', 'android-integrity'],
  }),
  signal('inquiry/session_count', false, {
    flowProvisional: true,
    layer: 'ensemble',
    tier: 'R',
    stage: 'ga',
    version: 1,
    valueType: 'integer',
    range: COUNT,
    collectionTier: 'server',
    inputs: ['sessions'],
  }),
  signal('inquiry/network_threat_level', false, {
    flowProvisional: true,
    layer: 'network',
    tier: 'H',
    stage: 'beta',
    version: 1,
    valueType: 'enum',
    values: SIGNAL_LEVELS,
    collectionTier: 'server',
    inputs: ['network'],
    thresholds: pick(
      NETWORK_SIGNAL_CONSTANTS,
      'threat-low-confidence-cap',
      'threat-low-confidence-cap-with-adapter',
    ),
  }),
  signal('inquiry/tor_detected', false, {
    flowProvisional: true,
    layer: 'network',
    tier: 'R',
    stage: 'ga',
    version: 1,
    valueType: 'boolean',
    collectionTier: 'server',
    inputs: ['network', 'tor-exit-addresses'],
  }),
  signal('inquiry/datacenter_detected', false, {
    flowProvisional: true,
    layer: 'network',
    tier: 'R',
    stage: 'ga',
    version: 1,
    valueType: 'boolean',
    neverFalse: true,
    collectionTier: 'server',
    inputs: ['network', 'cloud-ranges'],
  }),
  signal('inquiry/vpn_detected', false, {
    flowProvisional: true,
    layer: 'network',
    tier: 'H',
    stage: 'beta',
    version: 1,
    valueType: 'boolean',
    neverFalse: true,
    collectionTier: 'server',
    inputs: ['network', 'asn-seeds'],
    thresholds: pick(NETWORK_SIGNAL_CONSTANTS, 'vpn-asn-confidence'),
  }),
  signal('inquiry/proxy_detected', false, {
    flowProvisional: true,
    layer: 'network',
    tier: 'A',
    stage: 'beta',
    version: 1,
    valueType: 'boolean',
    collectionTier: 'server',
    inputs: ['network', 'ipReputation'],
  }),
  signal('inquiry/country_from_session', true, {
    flowProvisional: true,
    layer: 'network',
    tier: 'H',
    stage: 'beta',
    version: 1,
    valueType: 'string',
    // An ISO 3166-1 alpha-2 code; the contracts schema checks the form (C90.5).
    values: Object.freeze(['iso-3166-1-alpha-2']),
    approximate: true,
    collectionTier: 'server',
    inputs: ['network', 'dbip-country-lite'],
    thresholds: pick(NETWORK_SIGNAL_CONSTANTS, 'ip-country-confidence'),
  }),
  // C150.9: not flow-provisional, because it reads the government ID's extraction.
  signal('inquiry/country_comparison', true, {
    layer: 'ensemble',
    tier: 'H',
    stage: 'beta',
    version: 1,
    valueType: 'enum',
    values: COUNTRY_COMPARISONS,
    approximate: true,
    collectionTier: 'server',
    inputs: ['network', 'dbip-country-lite', 'government-id-extraction'],
    thresholds: pick(NETWORK_SIGNAL_CONSTANTS, 'ip-country-confidence'),
  }),
  signal('inquiry/max_session_distance', false, {
    flowProvisional: true,
    layer: 'network',
    tier: 'R',
    stage: 'ga',
    version: 1,
    valueType: 'integer',
    range: COUNT,
    unit: 'meters',
    approximate: true,
    collectionTier: 'server',
    inputs: ['network', 'dbip-city-lite'],
    thresholds: pick(NETWORK_SIGNAL_CONSTANTS, 'ip-city-uncertainty-meters'),
  }),
  signal('inquiry/handoff_count', false, {
    flowProvisional: true,
    layer: 'handoff',
    tier: 'R',
    stage: 'ga',
    version: 1,
    valueType: 'integer',
    range: COUNT,
    collectionTier: 'server',
    inputs: ['sessions', 'handoffs'],
  }),
  // C90.2, C99.3 (F31, added by `contracts-7b`): the open `list-match` records of the inquiry. It
  // is never in the stored array: it lives on the `list_screenings` row and is merged when served
  // (V06). No review rule may test it; `on-list-match` covers it (C99.6).
  // C150.9: not flow-provisional, because no list screening finishes before completion (C150.2).
  // Workflow 10B (C210.4, C211.5; C90.1 and C90.2 amended): device integrity, never decisive alone
  // (C210.5). The heuristics are true with their indicator codes as reasons, or null; a clean probe
  // is never false ("not rooted"). Play Integrity's two are A-tier, decoded and judged on the server.
  signal('inquiry/device_emulated', false, {
    flowProvisional: true,
    decisiveAlone: false,
    layer: 'device',
    tier: 'H',
    stage: 'beta',
    version: 1,
    valueType: 'boolean',
    neverFalse: true,
    collectionTier: 'session-integrity',
    inputs: ['android-integrity'],
    thresholds: DEVICE_INTEGRITY_CONSTANTS,
  }),
  signal('inquiry/device_rooted', false, {
    flowProvisional: true,
    decisiveAlone: false,
    layer: 'device',
    tier: 'H',
    stage: 'beta',
    version: 1,
    valueType: 'boolean',
    neverFalse: true,
    collectionTier: 'session-integrity',
    inputs: ['android-integrity'],
    thresholds: DEVICE_INTEGRITY_CONSTANTS,
  }),
  signal('inquiry/device_hooked', false, {
    flowProvisional: true,
    decisiveAlone: false,
    layer: 'device',
    tier: 'H',
    stage: 'beta',
    version: 1,
    valueType: 'boolean',
    neverFalse: true,
    collectionTier: 'session-integrity',
    inputs: ['android-integrity'],
    thresholds: DEVICE_INTEGRITY_CONSTANTS,
  }),
  signal('inquiry/device_integrity_level', false, {
    flowProvisional: true,
    decisiveAlone: false,
    layer: 'device',
    tier: 'A',
    stage: 'beta',
    version: 1,
    valueType: 'enum',
    values: DEVICE_INTEGRITY_LEVELS,
    collectionTier: 'session-integrity',
    inputs: ['integrity-verdict'],
  }),
  signal('inquiry/app_recognized', false, {
    flowProvisional: true,
    decisiveAlone: false,
    layer: 'device',
    tier: 'A',
    stage: 'beta',
    version: 1,
    valueType: 'boolean',
    collectionTier: 'session-integrity',
    inputs: ['integrity-verdict'],
  }),
  signal('inquiry/list_match_count', false, {
    layer: 'list',
    tier: 'R',
    stage: 'ga',
    version: 1,
    valueType: 'integer',
    range: COUNT,
    collectionTier: 'server',
    reviewRule: false,
    inputs: ['lists'],
  }),
]);

/** Every registered signal name, in registry order. */
export const SIGNAL_NAMES: readonly SignalName[] = Object.freeze(
  SIGNAL_REGISTRY.map((entry) => entry.name),
);

const BY_NAME: ReadonlyMap<string, SignalDefinition> = new Map(
  SIGNAL_REGISTRY.map((entry) => [entry.name, entry]),
);

/** Whether `value` names a registered signal. */
export function isSignalName(value: unknown): value is SignalName {
  return typeof value === 'string' && BY_NAME.has(value);
}

/** The registry entry of `name`, or `undefined` for an unregistered name. */
export function getSignalDefinition(name: string): SignalDefinition | undefined {
  return BY_NAME.get(name);
}

/** The names `signal-config.collect: "default"` collects, in registry order. */
export const DEFAULT_SIGNAL_NAMES: readonly SignalName[] = Object.freeze(
  SIGNAL_REGISTRY.filter((entry) => entry.default).map((entry) => entry.name),
);

/** The threshold values an entry applies, as `signal-details.thresholds` serves them. */
export function signalThresholdValues(entry: SignalDefinition): Readonly<Record<string, number>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(entry.thresholds).map(([key, constant]) => [key, Number(constant.value)]),
    ),
  );
}

/**
 * C94.3: the strong automation artefacts `inquiry/automation_artefact_count` counts distinctly
 * across sessions; each is also its own evidence reason (`SIGNAL_EVIDENCE_REASONS`).
 */
export const STRONG_AUTOMATION_ARTEFACTS = [
  'webdriver',
  'driver_globals',
  'ua_headless_marker',
  'untrusted_events',
] as const;
export type StrongAutomationArtefact = (typeof STRONG_AUTOMATION_ARTEFACTS)[number];

/** C94.3: the integrity artefacts that are medium evidence only. */
export const OTHER_AUTOMATION_ARTEFACTS = [
  'zero_window_with_focus',
  'plugins_inconsistent',
  'mime_inconsistent',
  'native_function_tampered',
] as const;

/**
 * C210.5 (Workflow 10B; orchestrator decision 10B D2 (a)): the one predicate both publish rules share
 * (Phase 9's flow checks, Phase 8's workflow checks): the names among [names] whose entry is
 * `decisive-alone: false`, in the order given (filled by contracts-10b; applied by api-integrity in
 * `@openverify/flow-spec`'s and `@openverify/workflow-engine`'s publish analyses).
 */
export function signalsNotDecisiveAlone(names: Iterable<string>): SignalName[] {
  return [...names].filter(
    (name): name is SignalName => BY_NAME.get(name)?.decisiveAlone === false,
  );
}
