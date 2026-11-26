/**
 * C94.8: `inquiry/bot_score` (H, `beta`): 0-100, higher meaning more bot-like, from one session's
 * evidence by {@link BOT_SCORE_RULES}. The weights, the caps and the two weak-evidence cut-offs are
 * `BOT_SCORE_CONSTANTS` in the core signal registry. Every one is provisional, and none is tuned on
 * test data.
 *
 * - **Strong** (one reason per artefact): `webdriver`; driver globals; untrusted input events; a
 *   headless marker, in the page's flag or in the request's own `User-Agent`. Any one sets the
 *   score to at least `strong-artefact-floor` (90): the floor plus the capped medium and weak sum,
 *   at most 100.
 * - **Medium**, each adding `medium-evidence-max` (25) or `medium-evidence-min` (10): the cross-
 *   layer rules (`consistency.ts`; the user agent against the hints at 25, which genuine browsers
 *   never produce, the language and time-zone rules at 10, which travellers and VPN users do);
 *   the four medium integrity artefacts at 10, which misfire on unusual genuine browsers; a
 *   `uniform` typing cadence with no correction on any screen (25); every screen with input
 *   completed faster than `fast-screen-floor-seconds` (25); and a mouse as the only pointer that
 *   never travelled before a click on any screen (25).
 * - **Weak**, each adding `weak-evidence-max` (5): paste or drop, and autofill, on a screen with
 *   identity fields ({@link IDENTITY_FIELD_STEP_TYPES}); at least `many-focus-losses-min` focus
 *   losses; at least `long-hidden-seconds-min` seconds hidden.
 * - **Caps (P24):** medium and weak evidence together never exceed `medium-weak-cap` (60), so a
 *   score of `strong-band` (70) or more needs a strong artefact. Uniform cadence, quick screens
 *   and no pointer travel are also voice control, switch access and keyboard-only use.
 * - **Confidence:** in the low band (no strong and no medium evidence) it is the share of the
 *   {@link EVIDENCE_GROUPS} collected, capped by `low-score-confidence-cap` (0.5), with
 *   `no_artefact_found`: absence of evidence is not proof (H06). Above it, the share times the
 *   margin from `strong-band`, as C43's `heuristicConfidence` computes it.
 * - **Sandbox (C90.9):** `bot` gives 95 and `human` 5, at confidence 1, with `sandbox_outcome`.
 * - **Android (Workflow 10B Stage 1a amendment 17; C94.7, C94.8 amended):** the `android-integrity`
 *   member is read through the integrity group: a connected debugger is medium evidence
 *   (`medium-evidence-min`) and an automation artefact for the count, a debuggable host app weak
 *   (`weak-evidence-max`); neither is strong, so neither alone reaches the strong band (P24). A body
 *   with neither reads the low band with `no_artefact_found` and its capped confidence, never human.
 */
import {
  BOT_SCORE_CONSTANTS,
  STRONG_AUTOMATION_ARTEFACTS,
  type StrongAutomationArtefact,
} from '@openverify/core';
import { heuristicConfidence } from '../government-id/heuristic.js';
import { crossLayerEvidence } from './consistency.js';
import type { SessionEvidence } from './evidence.js';
import { constantValue } from './network-facts.js';
import type { SignalEvidenceReason } from './vocabulary.js';

/** The evidence groups whose collected share sets the confidence (C94.8). */
export const EVIDENCE_GROUPS = [
  'integrity',
  'cross-layer',
  'typing',
  'pointer',
  'screens',
] as const;
export type EvidenceGroup = (typeof EVIDENCE_GROUPS)[number];

/** One evidence rule of the bot score (and, where `behaviour`, of the behaviour level). */
export interface EvidenceRule {
  readonly reason: SignalEvidenceReason;
  readonly strength: 'strong' | 'medium' | 'weak';
  readonly group: EvidenceGroup;
  /** The `BOT_SCORE_CONSTANTS` key of the rule's weight. */
  readonly weight:
    'strong-artefact-floor' | 'medium-evidence-max' | 'medium-evidence-min' | 'weak-evidence-max';
  /** Whether `behavior_threat_level` reads it: behaviour aggregates and untrusted input only. */
  readonly behaviour: boolean;
}

/**
 * C94.8: the flow-spec step types whose screens hold identity fields the person types (a name, a
 * birth date, a number, an address), for the weak paste and autofill rules.
 */
export const IDENTITY_FIELD_STEP_TYPES: readonly string[] = Object.freeze([
  'form',
  'phone_otp',
  'email_otp',
  'database',
  'aamva',
  'database_business',
]);

const rule = (
  reason: SignalEvidenceReason,
  strength: EvidenceRule['strength'],
  group: EvidenceGroup,
  weight: EvidenceRule['weight'],
  behaviour: boolean,
): EvidenceRule => Object.freeze({ reason, strength, group, weight, behaviour });

/** C94.8: the bot score's rules, strong first. */
export const BOT_SCORE_RULES: readonly EvidenceRule[] = Object.freeze([
  rule('webdriver', 'strong', 'integrity', 'strong-artefact-floor', false),
  rule('driver_globals', 'strong', 'integrity', 'strong-artefact-floor', false),
  rule('ua_headless_marker', 'strong', 'integrity', 'strong-artefact-floor', false),
  rule('untrusted_events', 'strong', 'integrity', 'strong-artefact-floor', true),
  rule('zero_window_with_focus', 'medium', 'integrity', 'medium-evidence-min', false),
  rule('plugins_inconsistent', 'medium', 'integrity', 'medium-evidence-min', false),
  rule('mime_inconsistent', 'medium', 'integrity', 'medium-evidence-min', false),
  rule('native_function_tampered', 'medium', 'integrity', 'medium-evidence-min', false),
  rule('android_debugger_connected', 'medium', 'integrity', 'medium-evidence-min', false),
  rule('ua_client_hints_mismatch', 'medium', 'cross-layer', 'medium-evidence-max', false),
  rule('language_mismatch', 'medium', 'cross-layer', 'medium-evidence-min', false),
  rule('timezone_country_mismatch', 'medium', 'cross-layer', 'medium-evidence-min', false),
  rule('uniform_typing_cadence', 'medium', 'typing', 'medium-evidence-max', true),
  rule('fast_screens', 'medium', 'screens', 'medium-evidence-max', true),
  rule('no_pointer_travel', 'medium', 'pointer', 'medium-evidence-max', true),
  rule('paste_into_identity_field', 'weak', 'screens', 'weak-evidence-max', true),
  rule('autofill_into_identity_field', 'weak', 'screens', 'weak-evidence-max', true),
  rule('many_focus_losses', 'weak', 'screens', 'weak-evidence-max', true),
  rule('long_hidden_periods', 'weak', 'screens', 'weak-evidence-max', true),
  rule('android_app_debuggable', 'weak', 'integrity', 'weak-evidence-max', false),
]);

/**
 * C94.3, C94.7: what `inquiry/automation_artefact_count` counts: the strong automation artefacts and,
 * on an Android session, a connected debugger (Workflow 10B Stage 1a amendment 17).
 */
export const COUNTED_ARTEFACTS = [
  ...STRONG_AUTOMATION_ARTEFACTS,
  'android_debugger_connected',
] as const;
export type CountedArtefact = (typeof COUNTED_ARTEFACTS)[number];

/** One session's bot score. */
export interface SessionBotScore {
  readonly score: number;
  readonly confidence: number;
  readonly reasons: readonly SignalEvidenceReason[];
  /** The artefacts seen (for `inquiry/automation_artefact_count`). */
  readonly artefacts: readonly CountedArtefact[];
  /** The evidence groups the session's payload let the rules read. */
  readonly groups: readonly EvidenceGroup[];
}

/** The rules that fired over one session's evidence, and the groups it let them read. */
export interface FiredEvidence {
  readonly fired: readonly EvidenceRule[];
  readonly groups: readonly EvidenceGroup[];
}

/** A headless browser naming itself in the request's own user agent (after BotD's rules). */
const HEADLESS_AGENT = /HeadlessChrome|PhantomJS|SlimerJS/;

const bot = (key: string): number => constantValue(BOT_SCORE_CONSTANTS, key);
const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;

/** C94.8: which rules fire over `evidence`, rule by rule. */
export function evaluateEvidenceRules(evidence: SessionEvidence): FiredEvidence {
  const { integrity, screens, androidIntegrity } = evidence;
  const crossLayer = crossLayerEvidence({
    userAgent: evidence.userAgent,
    integrity,
    requestHeaders: evidence.requestHeaders,
    ipCountry: evidence.ipCountry,
    at: evidence.at,
  });
  const behaviours = screens.map((screen) => screen.behaviour);
  const identity = screens.filter(
    (screen) => screen.screenType !== null && IDENTITY_FIELD_STEP_TYPES.includes(screen.screenType),
  );
  const withInput = behaviours.filter((screen) => screen['input-event-count'] > 0);
  const pointers = new Set(behaviours.flatMap((screen) => screen['pointer-types']));
  const sum = (key: 'focus-loss-count' | 'hidden-seconds'): number =>
    behaviours.reduce((total, screen) => total + screen[key], 0);
  const groups = EVIDENCE_GROUPS.filter((group) => {
    switch (group) {
      case 'integrity':
        return integrity !== null || androidIntegrity !== null;
      case 'cross-layer':
        return crossLayer.evaluated.length > 0;
      case 'typing':
        return behaviours.some((screen) => screen['typing-cadence'] !== 'insufficient');
      case 'pointer':
        return pointers.size > 0;
      case 'screens':
        return screens.length > 0;
    }
  });
  const fires: Readonly<Partial<Record<SignalEvidenceReason, boolean>>> = {
    webdriver: integrity?.webdriver === true,
    driver_globals: (integrity?.['driver-globals'].length ?? 0) > 0,
    ua_headless_marker:
      integrity !== null &&
      (integrity['ua-headless-marker'] || HEADLESS_AGENT.test(evidence.userAgent ?? '')),
    untrusted_events: (integrity?.['untrusted-event-count'] ?? 0) > 0,
    zero_window_with_focus: integrity?.['zero-window-with-focus'] === true,
    plugins_inconsistent: integrity?.['plugins-inconsistent'] === true,
    mime_inconsistent: integrity?.['mime-inconsistent'] === true,
    native_function_tampered: integrity?.['native-function-tampered'] === true,
    android_debugger_connected: androidIntegrity?.debuggerConnected === true,
    android_app_debuggable: androidIntegrity?.appDebuggable === true,
    ua_client_hints_mismatch: crossLayer.mismatches.includes('ua_client_hints_mismatch'),
    language_mismatch: crossLayer.mismatches.includes('language_mismatch'),
    timezone_country_mismatch: crossLayer.mismatches.includes('timezone_country_mismatch'),
    uniform_typing_cadence:
      behaviours.some((screen) => screen['typing-cadence'] === 'uniform') &&
      behaviours.every((screen) => screen['correction-count'] === 0),
    fast_screens:
      withInput.length > 0 &&
      withInput.every((screen) => screen['dwell-seconds'] < bot('fast-screen-floor-seconds')),
    no_pointer_travel:
      pointers.size === 1 &&
      pointers.has('mouse') &&
      behaviours.some((screen) => screen['pointer-before-click'] === 'false') &&
      behaviours.every((screen) => screen['pointer-before-click'] !== 'true'),
    paste_into_identity_field: identity.some(
      ({ behaviour }) => behaviour['paste-count'] + behaviour['drop-count'] > 0,
    ),
    autofill_into_identity_field: identity.some(({ behaviour }) => behaviour['autofill-count'] > 0),
    many_focus_losses: sum('focus-loss-count') >= bot('many-focus-losses-min'),
    long_hidden_periods: sum('hidden-seconds') >= bot('long-hidden-seconds-min'),
  };
  return { fired: BOT_SCORE_RULES.filter((entry) => fires[entry.reason] === true), groups };
}

const STRONG: ReadonlySet<string> = new Set<StrongAutomationArtefact>(STRONG_AUTOMATION_ARTEFACTS);

/** The counted artefacts among `fired`, in {@link COUNTED_ARTEFACTS}' order. */
function artefactsOf(fired: readonly EvidenceRule[]): CountedArtefact[] {
  return COUNTED_ARTEFACTS.filter((artefact) =>
    fired.some(
      (entry) =>
        entry.reason === artefact && (entry.strength === 'strong' || !STRONG.has(artefact)),
    ),
  );
}

/**
 * C94.8: one session's bot score, or `null` when its payload carries no group the score reads (an
 * Android body: `input_missing`).
 */
export function sessionBotScore(evidence: SessionEvidence): SessionBotScore | null {
  const { fired, groups } = evaluateEvidenceRules(evidence);
  const artefacts = artefactsOf(fired);
  if (evidence.sandboxOutcome !== null) {
    return {
      score: evidence.sandboxOutcome === 'bot' ? 95 : 5,
      confidence: 1,
      reasons: ['sandbox_outcome'],
      artefacts,
      groups,
    };
  }
  if (groups.length === 0) {
    return null;
  }
  const coverage = groups.length / EVIDENCE_GROUPS.length;
  const strong = fired.some((entry) => entry.strength === 'strong');
  const medium = fired.some((entry) => entry.strength === 'medium');
  const evidenceSum = Math.min(
    bot('medium-weak-cap'),
    fired
      .filter((entry) => entry.strength !== 'strong')
      .reduce((total, entry) => total + bot(entry.weight), 0),
  );
  const score = strong ? Math.min(100, bot('strong-artefact-floor') + evidenceSum) : evidenceSum;
  if (!strong && !medium) {
    return {
      score,
      confidence: Math.min(bot('low-score-confidence-cap'), round4(coverage)),
      reasons: ['no_artefact_found', ...fired.map((entry) => entry.reason)],
      artefacts,
      groups,
    };
  }
  return {
    score,
    confidence: heuristicConfidence(score / 100, bot('strong-band') / 100, coverage),
    reasons: fired.map((entry) => entry.reason),
    artefacts,
    groups,
  };
}

/**
 * C94.3, C90.2: the distinct counted artefacts of one session, or `null` when it sent no integrity
 * member (web) and no `android-integrity` member (Android).
 */
export function sessionArtefacts(evidence: SessionEvidence): readonly CountedArtefact[] | null {
  return evidence.integrity === null && evidence.androidIntegrity === null
    ? null
    : artefactsOf(evaluateEvidenceRules(evidence).fired);
}
