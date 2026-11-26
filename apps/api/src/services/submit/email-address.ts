/**
 * C52.6, C54.1: the `email-address` submit: a confirmed code, or an unconfirmed one only after a
 * limit refusal or with no code and no send left (C55.6); the open code is closed
 * (`services/otp/hooks.ts`).
 */
import { otpSubmitGuard } from '../otp/hooks.js';

export const emailAddressSubmit = otpSubmitGuard();
