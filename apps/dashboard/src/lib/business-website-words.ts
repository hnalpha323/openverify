/**
 * C61.3–C61.5, C66: the business website vocabulary in words, for operators: how the host's
 * resolution was read, why a domain age is unavailable, and what a business website pass means.
 * The test (`business-website-words.test.ts`) reads the routes and the unavailable reasons from
 * the evaluators' own source. Every lookup reads own entries of a `Map`.
 */
import type { WordsText } from './selfie-words';

/** C66: what a business website pass means, as `docs/checks/business.md` says it (its test checks every sentence against that page). */
export const BUSINESS_WEBSITE_PASS_MEANING =
  "The website's host resolves to a public internet address. That is the required core. The advisory domain age says how long ago the domain was registered, where its registry answers RDAP. Neither says who runs the site, that it belongs to the business, or that it is safe: the malicious-website check (disabled by default) needs the operator's own feeds.";

const ROUTES: ReadonlyMap<string, WordsText> = new Map<string, WordsText>([
  [
    'reserved',
    {
      words: 'Reserved name, sandbox rule',
      explanation:
        'In a sandbox environment, names under .example and .test resolve and names under .invalid do not, without a DNS query.',
    },
  ],
  ['dns', { words: 'DNS A and AAAA records' }],
  ['nxdomain', { words: 'DNS: no such name' }],
  ['no-address', { words: 'DNS: no address records' }],
]);

const AGE_FLAGS: ReadonlyMap<string, WordsText> = new Map<string, WordsText>([
  [
    'subdomain',
    {
      words: 'A platform’s subdomain',
      explanation:
        'Only a shorter name answered RDAP, so the site is not aged by the platform it lives on.',
    },
  ],
  [
    'no-rdap-service',
    {
      words: 'No RDAP service for the domain',
      explanation: 'The domain’s registry offers no RDAP service in IANA’s bootstrap file.',
    },
  ],
  ['not-found', { words: 'No RDAP record' }],
  [
    'no-registration-date',
    {
      words: 'No registration date',
      explanation: 'The registry’s answer gives no registration event.',
    },
  ],
  [
    'future-date',
    {
      words: 'Registration date in the future',
      explanation: 'The date is more than a day ahead, so it is not used.',
    },
  ],
]);

/** `business_website_resolution_detection`'s `route` in words. */
export function resolutionRouteText(route: string): WordsText | undefined {
  return ROUTES.get(route);
}

/** A flag of an unavailable domain age (`business_website_domain_age_detection`) in words. */
export function domainAgeFlagText(flag: string): WordsText | undefined {
  return AGE_FLAGS.get(flag);
}
