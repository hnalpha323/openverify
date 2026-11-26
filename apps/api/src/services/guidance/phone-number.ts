/**
 * C52.2, C54.1: the `phone-number` verification's flow view: the step's allowed countries and code
 * length, and the code the user last received (`services/otp/guidance.ts`).
 */
import { otpFlowAttributes } from '../otp/guidance.js';
import type { VerificationGuidanceHook } from './index.js';

export const phoneNumberGuidance: VerificationGuidanceHook = {
  flowAttributes: (ctx) => otpFlowAttributes(ctx, 'sms'),
};
