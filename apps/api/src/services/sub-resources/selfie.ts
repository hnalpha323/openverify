/**
 * C40.2, C54.1: a canceled selfie's open capture errors (`canceled`) with `selfie.errored`, its
 * file rows deleted; their objects are deleted after commit. Unchanged from Phase 4.
 */
import { errorOpenSelfieCaptureInTx } from '../selfie-captures.js';
import type { SubResourceHook } from './index.js';

export const selfieSubResources: SubResourceHook = {
  onVerificationCanceled: (tx, events, verification) =>
    errorOpenSelfieCaptureInTx(tx, events, verification.environmentId, verification.id, 'canceled'),
};
