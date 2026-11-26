/**
 * C50.4, C54.1, C55.10: a `phone-number` step publishes only with an SMS sender bound for the
 * environment's kind (422 `otp_channel_not_configured`, `services/otp/hooks.ts`).
 */
import { otpChannelPublish } from '../otp/hooks.js';

export const phoneNumberPublish = otpChannelPublish('phone_otp');
