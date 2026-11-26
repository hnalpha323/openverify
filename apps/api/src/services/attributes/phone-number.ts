/**
 * C52.8, C54.1: the `phone-number` verification's attributes: `phone-number` (E.164, PII),
 * `confirmed-at`, `sends` and `failed-attempts` (`services/otp/hooks.ts`).
 */
import { otpAttributeHook } from '../otp/hooks.js';

export const phoneNumberAttributes = otpAttributeHook('phone-number');
