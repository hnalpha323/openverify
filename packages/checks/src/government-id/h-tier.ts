/** The shape every H-tier result shares (ADR 0002 §3c): beta, a confidence, the threshold. */
import type { CheckId, CheckModel, CheckResult } from '@openverify/core';
import { checkResult } from '../result.js';
import { checkConfigOf, type GovernmentIdContext } from './context.js';
import { heuristicConfidence } from './heuristic.js';
import type { HeuristicScore } from './scores.js';
import { numberOf } from './values.js';

/** The fallback threshold when neither the template nor the defaults set one. */
const DEFAULT_THRESHOLD = 0.5;

export interface HeuristicJudgement<Score extends HeuristicScore> {
  checkId: CheckId;
  key: string;
  measured: Score | null;
  /** The reasons of a failure, given its score and threshold. */
  reasons: (score: Score, threshold: number) => string[];
  metadata?: (score: Score, threshold: number) => Record<string, unknown>;
  models?: readonly CheckModel[] | undefined;
}

/**
 * A heuristic result: `failed` when the score is above the threshold, `passed` otherwise, both
 * with a confidence; `not_applicable`/`input_missing` (confidence `null`) when nothing could be
 * measured.
 */
export function judgeHeuristic<Score extends HeuristicScore>(
  context: GovernmentIdContext,
  judgement: HeuristicJudgement<Score>,
): CheckResult {
  const { checkId, key, measured, models } = judgement;
  const threshold = numberOf(checkConfigOf(context, checkId), key) ?? DEFAULT_THRESHOLD;
  const options = {
    thresholds: { [key]: threshold },
    ...(models === undefined ? {} : { models }),
  };
  if (measured === null) {
    return checkResult(checkId, 'not_applicable', ['input_missing'], {}, options);
  }
  const failed = measured.score > threshold;
  return checkResult(
    checkId,
    failed ? 'failed' : 'passed',
    failed ? judgement.reasons(measured, threshold) : [],
    {
      score: measured.score,
      components: measured.components,
      coverage: Math.round(measured.coverage * 10_000) / 10_000,
      ...judgement.metadata?.(measured, threshold),
    },
    { ...options, confidence: heuristicConfidence(measured.score, threshold, measured.coverage) },
  );
}
