/**
 * C52.8, C54.1: the `email-address` verification's attributes: `email-address` (PII),
 * `confirmed-at`, `sends` and `failed-attempts` (`services/otp/hooks.ts`).
 */
import { otpAttributeHook } from '../otp/hooks.js';

export const emailAddressAttributes = otpAttributeHook('email-address');
