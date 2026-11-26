/**
 * `id_nfc_selfie_comparison` (R, fraud, model-based, `beta`, C62.6): the chip portrait (DG2,
 * decoded through vision's guard only after its hash verified, `subject=chip`) against the
 * inquiry's latest selfie centre, whose liveness the selfie step requires, by SFace cosine at
 * `threshold` (`FACE_MATCH_DEFAULTS`, not calibrated for chip portraits: provisional). This
 * binding is what stops a different person presenting a copied chip. Without a selfie:
 * `no_reference_data` (chip data alone does not identify the presenter). Judged on DG2's
 * integrity (C62.4). Embeddings never enter the result.
 */
import { FACE_MATCH_DEFAULTS, type CheckResult } from '@openverify/core';
import { phase5CheckConfig, phase5ResultOptions } from '../contact/phase5-config.js';
import { faceMatch, faceMatchConfidence } from '../face-match.js';
import { checkResult } from '../result.js';
import type { NfcContext } from './context.js';
import { INTEGRITY_NOT_ESTABLISHED, dataGroupIntegrity, onIntegrity } from './integrity.js';

const CHECK_ID = 'id_nfc_selfie_comparison';

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

export function idNfcSelfieComparison(context: NfcContext): CheckResult {
  const { input } = context;
  const config = phase5CheckConfig(context.template, CHECK_ID);
  const models = input.faceModels;
  const options = phase5ResultOptions(
    config,
    ['threshold'],
    models === undefined ? {} : { models },
  );
  const integrity = dataGroupIntegrity(input.passiveAuthentication, 2);
  const answer = (reason: string) =>
    checkResult(CHECK_ID, 'not_applicable', [reason], { integrity }, options);
  if (integrity === 'broken') {
    return answer(INTEGRITY_NOT_ESTABLISHED);
  }
  if (input.selfie.kind !== 'face') {
    return answer(input.selfie.kind === 'missing' ? 'no_reference_data' : 'execution_error');
  }
  const portrait = input.chipPortrait;
  if (portrait.kind !== 'face') {
    if (portrait.kind === 'error') {
      return answer('execution_error');
    }
    // DG2 left undecoded because its hash did not verify is no evidence either way (C62.4).
    return answer(
      portrait.kind === 'not_decoded' && integrity !== 'established'
        ? INTEGRITY_NOT_ESTABLISHED
        : 'input_missing',
    );
  }
  const threshold =
    typeof config.values.threshold === 'number'
      ? config.values.threshold
      : FACE_MATCH_DEFAULTS.threshold;
  const match = faceMatch(portrait.embedding, input.selfie.embedding, { threshold });
  const confidence = faceMatchConfidence(match.similarity, match.threshold);
  const verdict = onIntegrity(
    integrity,
    match.match
      ? { status: 'passed', reasons: [] }
      : { status: 'failed', reasons: ['face_mismatch'] },
  );
  return checkResult(
    CHECK_ID,
    verdict.status,
    verdict.reasons,
    {
      similarity: round4(match.similarity),
      threshold: match.threshold,
      'selfie-verification-id': input.selfie.verificationId,
      integrity,
    },
    { ...options, confidence },
  );
}
