/**
 * C54.5, C66: the reason codes of the `verification/email-address` checks in words (C51.2, C56),
 * for operators: the one-time code reasons the phone type shares (`lib/otp-words.ts`), the
 * disposable-domain reasons and the mail-domain (MX) reasons. `input_missing` and
 * `provider_not_configured` keep the shared words.
 */
import { OTP_REASON_WORDS } from '../otp-words';
import type { ReasonWords } from './types';

export const EMAIL_ADDRESS_REASON_WORDS: ReasonWords = Object.freeze({
  ...OTP_REASON_WORDS,
  disposable_domain: {
    words: 'Disposable email domain',
    explanation:
      "The address's domain, or a domain above it, is on the disposable-domain list or the template's deny list.",
  },
  list_unavailable: {
    words: 'No disposable-domain list',
    explanation:
      'The pinned disposable-domain list is not installed and no template list matched, so nothing was judged; a reviewer decides when the check is required.',
  },
  domain_not_found: {
    words: 'Email domain does not exist',
    explanation:
      "The address's domain does not exist in DNS (NXDOMAIN), or is a reserved sandbox name that takes no mail.",
  },
  domain_rejects_mail: {
    words: 'Email domain takes no mail',
    explanation: 'The domain publishes a null MX record (RFC 7505): it says it accepts no mail.',
  },
  no_mail_server: {
    words: 'Email domain has no mail server',
    explanation:
      'The domain has neither an MX record nor an address record that a mail server could use.',
  },
  execution_error: {
    words: 'Could not run',
    explanation:
      'The DNS lookup failed after its retries; a reviewer decides when the check is required.',
  },
});
