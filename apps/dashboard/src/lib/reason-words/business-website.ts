/**
 * C51.2, C61.3–C61.5, C66: the reason codes of the `verification/business-website` checks in
 * words, for operators. Nothing here says who runs the site: resolution is a DNS answer, the age
 * is the registry's registration date, and a listing is the operator's own feeds.
 */
import type { ReasonWords } from './types';

const LISTED = 'A malicious-website feed the operator configured lists this host.';

export const BUSINESS_WEBSITE_REASON_WORDS: ReasonWords = Object.freeze({
  // business_website_resolution_detection (C61.3).
  domain_not_resolving: {
    words: 'Domain does not resolve',
    explanation:
      'The host has no public internet address, often a mistyped URL the user can correct.',
  },
  // business_website_domain_age_detection (C61.4).
  domain_recently_registered: {
    words: 'Domain registered recently',
    explanation:
      'The registry’s registration date is more recent than the template’s minimum domain age.',
  },
  domain_age_unavailable: {
    words: 'Domain age unavailable',
    explanation:
      'RDAP gave no registration date for this host: a site on a platform’s subdomain, a TLD without RDAP, or no record.',
  },
  // business_website_malicious_website_detection (C61.5).
  malware: { words: 'Listed for malware', explanation: LISTED },
  phishing: { words: 'Listed for phishing', explanation: LISTED },
  spam_source: { words: 'Listed as a spam source', explanation: LISTED },
  // business_website_backlink_detection (C61.5).
  backlinks_below_threshold: {
    words: 'Too few backlinks',
    explanation: 'Fewer sites link to this one than the template’s minimum.',
  },
  // Any website check without an answer.
  provider_not_configured: {
    words: 'Not configured',
    explanation:
      'No provider is bound to this check in this environment, or no malicious-website feed is loaded.',
  },
  execution_error: {
    words: 'Could not run',
    explanation:
      'A lookup failed or timed out after the job’s retries, or a malicious-website feed is out of date.',
  },
});
