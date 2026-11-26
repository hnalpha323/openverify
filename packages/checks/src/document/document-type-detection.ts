/**
 * `document_type_detection` (R, model-based, user behaviour, required; C60.5, C60.6): the classified
 * class is one the step accepts. Fails `document_type_not_accepted` only for one of the five classes
 * outside the step's `documentTypes`, or `other` on a document positively identified as an
 * identity document in a covered language; any other `other` or `unknown` answers
 * `document_type_unknown` (review). vision's refusals fail with their own hint: too large, too many
 * pages, password-protected, unreadable (also a document with no text at all). The confidence is
 * the top class probability, uncalibrated.
 */
import { DOCUMENT_TYPES, type CheckResult } from '@openverify/core';
import { phase5CheckConfig, phase5ResultOptions } from '../contact/phase5-config.js';
import { checkResult } from '../result.js';
import { DOCUMENT_CLASSIFIER_CONSTANTS } from './constants.js';
import { documentOcrModels, type DocumentContext } from './context.js';
import type { DocumentClass, DocumentVisionRefusal } from './inputs.js';

const ID = 'document_type_detection';

/** The hint each vision refusal fails with (C60.6). */
const REFUSAL_REASONS: Readonly<Record<DocumentVisionRefusal, string>> = {
  too_large: 'document_too_large',
  too_many_pages: 'document_too_many_pages',
  password_protected: 'document_password_protected',
  unreadable: 'document_unreadable',
};

export function documentTypeDetection(context: DocumentContext): CheckResult {
  const config = phase5CheckConfig(context.template, ID);
  const { temperature, otherScore, minMargin } = DOCUMENT_CLASSIFIER_CONSTANTS;
  const models = documentOcrModels(context);
  const options = phase5ResultOptions(config, ['min-confidence'], {
    thresholds: { temperature, 'other-score': otherScore, 'min-margin': minMargin },
    thresholdBasis: {
      temperature: 'provisional',
      'other-score': 'provisional',
      'min-margin': 'provisional',
    },
    ...(models === undefined ? {} : { models }),
  });
  if (context.visionFailed) {
    return checkResult(ID, 'not_applicable', ['execution_error'], {}, options);
  }
  if (context.refusal !== null) {
    return checkResult(ID, 'failed', [REFUSAL_REASONS[context.refusal]], {}, options);
  }
  const { classifier } = context;
  if (classifier === null) {
    return checkResult(ID, 'not_applicable', ['input_missing'], {}, options);
  }
  const metadata = {
    classification: classifier.classification,
    language: classifier.language,
    script: classifier.script,
    'identity-document': classifier.identityDocument,
    features: [...classifier.features],
    'accepted-types': [...context.input.acceptedTypes],
    ...(classifier.probabilities === null
      ? {}
      : { probabilities: { ...classifier.probabilities } }),
    ...(classifier.unknownReason === null ? {} : { 'unknown-reason': classifier.unknownReason }),
  };
  const scored = { ...options, confidence: classifier.confidence };
  if (classifier.unknownReason === 'no-text') {
    return checkResult(ID, 'failed', ['document_unreadable'], metadata, scored);
  }
  const { classification } = classifier;
  if ((DOCUMENT_TYPES as readonly string[]).includes(classification)) {
    return context.input.acceptedTypes.includes(classification as DocumentClass)
      ? checkResult(ID, 'passed', [], metadata, scored)
      : checkResult(ID, 'failed', ['document_type_not_accepted'], metadata, scored);
  }
  if (classification === 'other' && classifier.identityDocument) {
    return checkResult(ID, 'failed', ['document_type_not_accepted'], metadata, scored);
  }
  return checkResult(ID, 'not_applicable', ['document_type_unknown'], metadata, scored);
}
