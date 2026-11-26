/**
 * C54.1: canceling an `email-address` verification closes its open code (`services/otp/hooks.ts`).
 */
import { otpSubResources } from '../otp/hooks.js';

export const emailAddressSubResources = otpSubResources;
