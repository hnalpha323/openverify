/**
 * C52.2, C54.1: the `email-address` verification's flow view: the step's code length and the code
 * the user last received (`services/otp/guidance.ts`).
 */
import { otpFlowAttributes } from '../otp/guidance.js';
import type { VerificationGuidanceHook } from './index.js';

export const emailAddressGuidance: VerificationGuidanceHook = {
  flowAttributes: (ctx) => otpFlowAttributes(ctx, 'email'),
};
