/**
 * `id_inconsistent_repeat_detection` (R, fraud, model-based): an earlier extraction with the same
 * blind index (C34) shows another identity: another first or last name, another birth date, or
 * another face (the earlier front re-embedded while its files exist; its similarity below
 * `face-threshold`). A field either extraction did not read is never a difference; without the
 * earlier files the faces are not compared (`face-compared: false`, C31.9). Without the lookup or
 * an identification number, `input_missing`.
 */
import { FACE_MATCH_DEFAULTS, type CheckResult, type ExtractionField } from '@openverify/core';
import { fieldsAgree, namesAgree } from '../extraction/agreement.js';
import { checkResult } from '../result.js';
import { checkConfigOf, modelsOf, type GovernmentIdContext } from './context.js';
import { numberOf } from './values.js';

const CHECK_ID = 'id_inconsistent_repeat_detection';
const COMPARED: readonly ('name-first' | 'name-last' | 'birthdate')[] = [
  'name-first',
  'name-last',
  'birthdate',
];
const DEFAULT_FACE_THRESHOLD = FACE_MATCH_DEFAULTS.threshold;

export function idInconsistentRepeatDetection(context: GovernmentIdContext): CheckResult {
  const threshold =
    numberOf(checkConfigOf(context, CHECK_ID), 'face-threshold') ?? DEFAULT_FACE_THRESHOLD;
  const models = modelsOf(context, ['faceRecognizer']);
  const options = {
    thresholds: { 'face-threshold': threshold },
    ...(models === undefined ? {} : { models }),
  };
  const history = context.input.history?.inconsistentRepeat;
  const { fields } = context.extraction.consolidated;
  if (history === undefined || fields['identification-number'] === null) {
    return checkResult(CHECK_ID, 'not_applicable', ['input_missing'], {}, options);
  }
  const disagreeing = new Set<ExtractionField | 'face'>();
  const inconsistent: string[] = [];
  for (const candidate of history.candidates) {
    const differences: (ExtractionField | 'face')[] = [];
    for (const field of COMPARED) {
      const current = fields[field];
      const earlier = candidate.fields[field];
      if (current === null || earlier === null) {
        continue;
      }
      const agree =
        field === 'birthdate'
          ? fieldsAgree(field, current, earlier)
          : namesAgree(current, earlier, { allowMissingTokens: true });
      if (!agree) {
        differences.push(field);
      }
    }
    if (candidate.faceSimilarity !== null && candidate.faceSimilarity < threshold) {
      differences.push('face');
    }
    if (differences.length > 0) {
      inconsistent.push(candidate.verificationId);
      differences.forEach((difference) => disagreeing.add(difference));
    }
  }
  const faceCompared = history.candidates.some((candidate) => candidate.faceSimilarity !== null);
  if (inconsistent.length === 0) {
    return checkResult(
      CHECK_ID,
      'passed',
      [],
      { candidates: history.candidates.length, 'face-compared': faceCompared },
      options,
    );
  }
  return checkResult(
    CHECK_ID,
    'failed',
    ['inconsistent_repeat_detected'],
    {
      candidates: history.candidates.length,
      'face-compared': faceCompared,
      'disagreeing-fields': [...COMPARED, 'face' as const].filter((field) =>
        disagreeing.has(field),
      ),
      'inconsistent-verification-ids': inconsistent,
    },
    options,
  );
}
