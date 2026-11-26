/**
 * C54.1: canceling a `phone-number` verification closes its open code (`services/otp/hooks.ts`).
 */
import { otpSubResources } from '../otp/hooks.js';

export const phoneNumberSubResources = otpSubResources;
