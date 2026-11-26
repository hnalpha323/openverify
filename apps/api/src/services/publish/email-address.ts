/**
 * C50.4, C54.1, C55.10: an `email-address` step publishes only with a mail server configured
 * (422 `otp_channel_not_configured`, `services/otp/hooks.ts`).
 */
import { otpChannelPublish } from '../otp/hooks.js';

export const emailAddressPublish = otpChannelPublish('email_otp');
