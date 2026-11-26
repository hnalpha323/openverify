/** The shared context of the NFC checks: the input, the template and the evaluation instant. */
import type { VerificationTemplateConfig } from '@openverify/core';
import type { GovernmentIdNfcCheckInput } from './inputs.js';

export interface NfcContext {
  readonly input: GovernmentIdNfcCheckInput;
  readonly template: VerificationTemplateConfig;
  readonly now: Date;
}

export function nfcContext(
  input: GovernmentIdNfcCheckInput,
  template: VerificationTemplateConfig,
): NfcContext {
  return { input, template, now: input.now ?? new Date() };
}
