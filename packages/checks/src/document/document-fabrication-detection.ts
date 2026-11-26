/**
 * `document_fabrication_detection` (H, fraud, advisory, `beta`; C60.6): the fabrication score of
 * `fabrication.ts` against `max-fabrication-score`. Fails above it with the reasons of the cues
 * contributing at least 0.1; `components` in metadata; the confidence is the score's margin from
 * the threshold, capped at 0.6. Without measurements (vision refused the document, or measured no
 * cue) it answers `input_missing`; when vision failed, `execution_error`.
 */
import type { CheckResult } from '@openverify/core';
import { phase5CheckConfig, phase5ResultOptions } from '../contact/phase5-config.js';
import { checkResult } from '../result.js';
import type { DocumentContext } from './context.js';
import {
  FABRICATION_SIGNALS,
  FABRICATION_WEAK_CUE_CAP,
  assessDocumentFabrication,
  documentFabricationConfidence,
  documentFabricationSignals,
} from './fabrication.js';

const ID = 'document_fabrication_detection';

const FABRICATION_REASON_OF: ReadonlyMap<string, readonly string[]> = new Map(
  FABRICATION_SIGNALS.map((signal) => [signal.id, [signal.reason]]),
);

export function documentFabricationDetection(context: DocumentContext): CheckResult {
  const config = phase5CheckConfig(context.template, ID);
  const options = phase5ResultOptions(config, ['max-fabrication-score'], {
    thresholds: { 'weak-cue-cap': FABRICATION_WEAK_CUE_CAP },
    thresholdBasis: { 'weak-cue-cap': 'provisional' },
  });
  if (context.visionFailed) {
    return checkResult(ID, 'not_applicable', ['execution_error'], {}, options);
  }
  const { analysis } = context;
  if (analysis === null) {
    return checkResult(ID, 'not_applicable', ['input_missing'], {}, options);
  }
  const assessment = assessDocumentFabrication(
    documentFabricationSignals(analysis, context.extraction),
  );
  const metadata = {
    score: assessment.score,
    components: assessment.components.map((component) => ({ ...component })),
  };
  // Weak cues alone cannot fail and so cannot show the absence of a fabrication either.
  if (!assessment.components.some((component) => component.strength !== 'weak')) {
    return checkResult(ID, 'not_applicable', ['input_missing'], metadata, options);
  }
  const threshold = config.values['max-fabrication-score'];
  const limit = typeof threshold === 'number' ? threshold : 0.5;
  const scored = { ...options, confidence: documentFabricationConfidence(assessment.score, limit) };
  if (assessment.score <= limit) {
    return checkResult(ID, 'passed', [], metadata, scored);
  }
  const [largest] = [...assessment.components].sort((a, b) => b.contribution - a.contribution);
  const reasons =
    assessment.reasons.length > 0
      ? assessment.reasons
      : (FABRICATION_REASON_OF.get(largest?.id ?? '') ?? []);
  return checkResult(ID, 'failed', reasons, metadata, scored);
}
