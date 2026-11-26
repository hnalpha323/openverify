/**
 * C54.1: the job of a type whose builder has not landed yet. It is not runnable, so the flow API
 * refuses to create such a verification and the job never judges one; its evaluator refuses
 * (`unsupported_verification`, a permanent failure) rather than answer anything, and its decision
 * hook writes nothing of its own. Each type's builder replaces its file's stub with the real job.
 */
import type { SupportedVerificationType } from '@openverify/contracts';
import { PermanentJobError } from '../errors.js';
import type { VerificationTypeJob } from './index.js';

export function unbuiltTypeJob(type: SupportedVerificationType): VerificationTypeJob<null> {
  return {
    type,
    runnable: false,
    evaluate: () => Promise.reject(new PermanentJobError('unsupported_verification')),
    persistInDecisionTx: (_tx, ctx) => ctx.verificationEvent(),
    onProcessingFailed: () => Promise.resolve([]),
  };
}
