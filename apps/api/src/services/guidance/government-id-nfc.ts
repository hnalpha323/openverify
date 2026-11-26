/**
 * C52.2, C54.1: the `government-id-nfc` verification's flow view: `guidance` is the empty object
 * the contract fixes (C52.2, Stage 1a decision 7: the step needs none yet; a client reads the chip
 * and asks for a challenge); `null` without an NFC step in the pinned flow.
 */
import type { VerificationGuidanceHook } from './index.js';

export const governmentIdNfcGuidance: VerificationGuidanceHook = {
  flowAttributes({ step }) {
    return Promise.resolve({ guidance: step?.type === 'nfc' ? {} : null });
  },
};
