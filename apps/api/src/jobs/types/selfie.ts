/**
 * C54.1: the selfie job behind the type hooks, unchanged from Phase 4: the evaluation of
 * `jobs/selfie.ts` with the Phase 2 quality thresholds; in the decision transaction, the
 * `verification.*` event, then the consumed capture `processed` with `selfie.processed` (C40.5,
 * C40.8) and, for a passed, live selfie compared with its ID whose matching consent holds, the
 * face data (C42.2); and a submitted capture errored when processing cannot finish (C40.8).
 */
import {
  listSelfieCaptures,
  markSelfieCaptureFailed,
  markSelfieCaptureProcessed,
  writeFaceData,
  type SelfieCapture,
} from '@openverify/db';
import type { CheckResult } from '@openverify/core';
import type { StagedEvent } from '../../events/index.js';
import { stageSelfieCaptureEvent } from '../selfie-events.js';
import {
  evaluateSelfieVerification,
  matchingConsentHolds,
  type FaceDataToStore,
} from '../selfie.js';
import { recordThresholds, selfieThresholds } from '../thresholds.js';
import type { VerificationTypeJob } from './index.js';

/** The selfie's newest submitted capture (C40.9) and the face data a passed decision may store. */
export interface SelfieDecisionState {
  capture: SelfieCapture | null;
  faceData: FaceDataToStore | null;
}

/**
 * C42.2: a template is kept only when both `selfie_liveness_detection` and `selfie_id_comparison`
 * answered `passed`, whatever their `required` flag; a template version that does not enable both
 * never stores templates.
 */
function keepsFaceData(results: readonly CheckResult[]): boolean {
  const passed = (name: string) =>
    results.some((result) => result.name === name && result.status === 'passed');
  return passed('selfie_liveness_detection') && passed('selfie_id_comparison');
}

export const selfieJob: VerificationTypeJob<SelfieDecisionState> = {
  type: 'selfie',
  runnable: true,
  async evaluate(deps, job) {
    const evaluation = await evaluateSelfieVerification(deps, {
      environmentId: job.environmentId,
      environmentKind: job.environmentKind,
      inquiry: job.inquiry,
      verificationId: job.verificationId,
      flow: job.flow,
      files: job.files,
      config: job.config,
      now: job.now,
      lastAttempt: job.lastAttempt,
    });
    return {
      results: recordThresholds(evaluation.results, {
        selfie_image_quality_detection: selfieThresholds(job.config),
      }),
      unreadable: evaluation.unreadable,
      state: { capture: evaluation.capture, faceData: evaluation.faceData },
    };
  },
  async persistInDecisionTx(tx, ctx) {
    const staged = await ctx.verificationEvent();
    const { capture, faceData } = ctx.state;
    if (ctx.status !== 'submitted' && capture !== null) {
      // C40.5, C40.8: the decided selfie's capture is processed, its device cleared in the same
      // update, and `selfie.processed` follows the verification event.
      const processed = await markSelfieCaptureProcessed(
        tx,
        ctx.environmentId,
        capture.id,
        ctx.now,
      );
      if (processed !== null) {
        staged.push(
          await stageSelfieCaptureEvent(tx, ctx.deps.events, 'selfie.processed', processed),
        );
      }
    }
    if (
      ctx.status === 'passed' &&
      faceData !== null &&
      keepsFaceData(ctx.results) &&
      ctx.inquiryStatus !== 'declined' &&
      ctx.inquiryStatus !== 'failed' &&
      (await matchingConsentHolds(
        tx,
        {
          environmentId: ctx.environmentId,
          inquiryId: ctx.inquiry.id,
          sessionId: capture?.createdBySessionId ?? null,
        },
        ctx.flow,
      ))
    ) {
      // C42.2, under the inquiry lock: a passed, live selfie compared with its ID, of an inquiry
      // that is not declined or failed, whose matching consent still holds.
      await writeFaceData(tx, ctx.environmentId, {
        verificationId: ctx.verificationId,
        inquiryId: ctx.inquiry.id,
        ...faceData,
      });
    }
    return staged;
  },
  async onProcessingFailed(tx, ctx) {
    // C40.8: its submitted capture errors (`processing_failed`), its device cleared in the same
    // update, and `selfie.errored` follows `verification.failed`.
    const staged: StagedEvent[] = [];
    const submitted = (
      await listSelfieCaptures(tx, ctx.environmentId, { verificationId: ctx.verificationId })
    ).filter((capture) => capture.status === 'submitted');
    for (const capture of submitted) {
      const errored = await markSelfieCaptureFailed(tx, ctx.environmentId, capture.id);
      if (errored !== null) {
        staged.push(await stageSelfieCaptureEvent(tx, ctx.deps.events, 'selfie.errored', errored));
      }
    }
    return staged;
  },
};
