/**
 * C54.1: the government ID job behind the type hooks, unchanged from Phase 3: the evaluation of
 * `jobs/government-id.ts` with the C11 image thresholds, and the C31 extraction written in the
 * decision transaction before the `verification.*` event, which carries it.
 */
import { createGovernmentIdExtraction, fillVerificationDocument, type Db } from '@openverify/db';
import { evaluateGovernmentIdVerification, type ExtractionToStore } from '../government-id.js';
import {
  governmentIdThresholds,
  governmentIdWithThresholds,
  recordThresholds,
} from '../thresholds.js';
import type { VerificationTypeJob } from './index.js';

/**
 * Stores a government ID's C31 extraction (C31.7: fields sealed to the row, the blind index, the
 * pHash and its class group) and fills the verification's country and class where the user
 * chose none (C31.5).
 */
async function storeExtraction(
  tx: Db,
  environmentId: string,
  verificationId: string,
  extraction: ExtractionToStore,
): Promise<void> {
  await createGovernmentIdExtraction(tx, environmentId, {
    verificationId,
    fields: extraction.fields,
    fieldSources: extraction.fieldSources,
    identificationNumberIndex: extraction.identificationNumberIndex,
    frontPhash: extraction.frontPhash,
    idClassGroup: extraction.idClassGroup,
  });
  await fillVerificationDocument(tx, environmentId, verificationId, extraction.document);
}

export const governmentIdJob: VerificationTypeJob<ExtractionToStore | null> = {
  type: 'government_id',
  runnable: true,
  async evaluate(deps, job) {
    const thresholds = governmentIdThresholds(job.config);
    const evaluation = await evaluateGovernmentIdVerification(deps, {
      environmentId: job.environmentId,
      environmentKind: job.environmentKind,
      inquiry: job.inquiry,
      verificationId: job.verificationId,
      flow: job.flow,
      files: job.files,
      config: job.config,
      now: job.now,
      lastAttempt: job.lastAttempt,
      adjust: {
        analysis: (analysis) =>
          governmentIdWithThresholds(analysis, {
            ...thresholds.id_blur_detection,
            ...thresholds.id_glare_detection,
          }),
        results: (results) => recordThresholds(results, thresholds),
      },
    });
    return {
      results: evaluation.results,
      unreadable: evaluation.unreadable,
      state: evaluation.extraction,
    };
  },
  async persistInDecisionTx(tx, ctx) {
    if (ctx.state !== null) {
      await storeExtraction(tx, ctx.environmentId, ctx.verificationId, ctx.state);
    }
    return ctx.verificationEvent();
  },
  onProcessingFailed: () => Promise.resolve([]),
};
