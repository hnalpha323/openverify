/**
 * The shared evaluation context of the contact checks (C56): the input, the template config and,
 * for email, the environment kind and the address's validated domain, built once per
 * verification by `evaluatePhoneNumberChecks` and `evaluateEmailAddressChecks`.
 */
import type { VerificationTemplateConfig } from '@openverify/core';
import type { EnvironmentKind } from '../data/feature-table.js';
import { validateEmailDestination } from './email-destination.js';
import type { EmailAddressCheckInput, PhoneNumberCheckInput } from './inputs.js';

export interface PhoneNumberContext {
  input: PhoneNumberCheckInput;
  template: VerificationTemplateConfig;
}

export interface EmailAddressContext {
  input: EmailAddressCheckInput;
  template: VerificationTemplateConfig;
  environment: EnvironmentKind;
  /**
   * The address's lower-case ASCII domain (`validateEmailDestination`), or `null` without an
   * address or with one the rule refuses.
   */
  domain: string | null;
}

export function phoneNumberContext(
  input: PhoneNumberCheckInput,
  template: VerificationTemplateConfig,
): PhoneNumberContext {
  return { input, template };
}

/** The email context: `production` unless the input names the environment. */
export function emailAddressContext(
  input: EmailAddressCheckInput,
  template: VerificationTemplateConfig,
): EmailAddressContext {
  const validated =
    input.emailAddress === null ? null : validateEmailDestination(input.emailAddress);
  return {
    input,
    template,
    environment: input.environment ?? 'production',
    domain: validated?.ok === true ? validated.domain : null,
  };
}
