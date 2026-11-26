/**
 * C94.8: `inquiry/behavior_threat_level` (H, `beta`): `low`, `medium` or `high` from one session's
 * behaviour aggregates and its untrusted input events, by {@link BEHAVIOUR_RULES}. The minimum
 * evidence and the low-band cap are `BEHAVIOUR_CONSTANTS` in the core signal registry; the
 * evidence weights and the caps are the bot score's (`BOT_SCORE_CONSTANTS`). No device artefact
 * (webdriver, driver globals, a headless marker) and no cross-layer rule reaches it.
 *
 * - **Minimum evidence:** at least `min-screens` (3) distinct screens with aggregates and
 *   `min-input-events` (20) input events in total; otherwise `null` with `insufficient_behaviour`
 *   (`input_missing` without any aggregates).
 * - `high` only with the strong behavioural artefact: untrusted input events (P24). Its
 *   confidence is the margin of `strong-artefact-floor` from `strong-band`.
 * - `medium` when the behaviour evidence (the bot score's behaviour rules at their weights,
 *   uncapped) reaches `medium-weak-cap` (60); its confidence is the margin of that sum from the cap.
 * - `low` otherwise, with `no_artefact_found` and the share of its evidence groups collected,
 *   capped by `low-confidence-cap` (0.5, H06).
 * - Each margin is scaled by the share of {@link BehaviourRules.groups} collected, as C43's
 *   `heuristicConfidence` does. A sandbox body's outcome gives `high` (`bot`) or `low` (`human`)
 *   at confidence 1 with `sandbox_outcome` (C90.9).
 */
import { BEHAVIOUR_CONSTANTS, BOT_SCORE_CONSTANTS, type SignalLevel } from '@openverify/core';
import { heuristicConfidence } from '../government-id/heuristic.js';
import { BOT_SCORE_RULES, evaluateEvidenceRules, type EvidenceGroup } from './bot-score.js';
import type { SessionEvidence } from './evidence.js';
import { constantValue } from './network-facts.js';
import type { SignalEvidenceReason } from './vocabulary.js';

/** One row of the behaviour table. */
export interface BehaviourLevelRule {
  readonly level: SignalLevel;
  readonly when: 'untrusted-input' | 'evidence-reaches-medium-weak-cap' | 'otherwise';
}

/** C94.8: the behaviour table: the levels, the evidence it reads and its minimum evidence. */
export interface BehaviourRules {
  readonly levels: readonly BehaviourLevelRule[];
  /** The evidence reasons the level reads (the bot score's behaviour rules). */
  readonly evidence: readonly SignalEvidenceReason[];
  /** `BEHAVIOUR_CONSTANTS` keys of the minimum evidence. */
  readonly minimum: readonly ('min-screens' | 'min-input-events')[];
  /** The evidence groups whose collected share sets the confidence. */
  readonly groups: readonly EvidenceGroup[];
}

export const BEHAVIOUR_RULES: BehaviourRules = Object.freeze({
  levels: Object.freeze([
    Object.freeze({ level: 'high', when: 'untrusted-input' }),
    Object.freeze({ level: 'medium', when: 'evidence-reaches-medium-weak-cap' }),
    Object.freeze({ level: 'low', when: 'otherwise' }),
  ] as const),
  evidence: Object.freeze(
    BOT_SCORE_RULES.filter((entry) => entry.behaviour).map((entry) => entry.reason),
  ),
  minimum: Object.freeze(['min-screens', 'min-input-events'] as const),
  groups: Object.freeze(['integrity', 'typing', 'pointer', 'screens'] as const),
});

/** One session's behaviour level, or why it has none. */
export type SessionBehaviourLevel =
  | {
      readonly level: SignalLevel;
      readonly confidence: number;
      readonly reasons: readonly SignalEvidenceReason[];
      readonly nullReason: null;
    }
  | {
      readonly level: null;
      readonly confidence: null;
      readonly reasons: readonly SignalEvidenceReason[];
      readonly nullReason: 'insufficient_behaviour' | 'input_missing';
    };

const bot = (key: string): number => constantValue(BOT_SCORE_CONSTANTS, key);
const behaviourConstant = (key: string): number => constantValue(BEHAVIOUR_CONSTANTS, key);
const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;

const nothing = (
  nullReason: 'insufficient_behaviour' | 'input_missing',
): SessionBehaviourLevel => ({ level: null, confidence: null, reasons: [], nullReason });

/** C94.8: one session's behaviour level. */
export function sessionBehaviourLevel(evidence: SessionEvidence): SessionBehaviourLevel {
  if (evidence.sandboxOutcome !== null) {
    return {
      level: evidence.sandboxOutcome === 'bot' ? 'high' : 'low',
      confidence: 1,
      reasons: ['sandbox_outcome'],
      nullReason: null,
    };
  }
  const { screens } = evidence;
  if (screens.length === 0) {
    return nothing('input_missing');
  }
  const distinctScreens = new Set(screens.map(({ screen }) => screen)).size;
  const inputEvents = screens.reduce(
    (total, { behaviour }) => total + behaviour['input-event-count'],
    0,
  );
  if (
    distinctScreens < behaviourConstant('min-screens') ||
    inputEvents < behaviourConstant('min-input-events')
  ) {
    return nothing('insufficient_behaviour');
  }
  const { fired, groups } = evaluateEvidenceRules(evidence);
  const behaviourFired = fired.filter((entry) => entry.behaviour);
  const reasons = behaviourFired.map((entry) => entry.reason);
  const coverage =
    groups.filter((group) => BEHAVIOUR_RULES.groups.includes(group)).length /
    BEHAVIOUR_RULES.groups.length;
  if (behaviourFired.some((entry) => entry.strength === 'strong')) {
    return {
      level: 'high',
      confidence: heuristicConfidence(
        bot('strong-artefact-floor') / 100,
        bot('strong-band') / 100,
        coverage,
      ),
      reasons,
      nullReason: null,
    };
  }
  const evidenceSum = behaviourFired.reduce((total, entry) => total + bot(entry.weight), 0);
  if (evidenceSum >= bot('medium-weak-cap')) {
    return {
      level: 'medium',
      confidence: heuristicConfidence(evidenceSum / 100, bot('medium-weak-cap') / 100, coverage),
      reasons,
      nullReason: null,
    };
  }
  return {
    level: 'low',
    confidence: Math.min(behaviourConstant('low-confidence-cap'), round4(coverage)),
    reasons: ['no_artefact_found', ...reasons],
    nullReason: null,
  };
}
