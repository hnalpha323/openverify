/**
 * C61.6: the sandbox malicious-website provider (sandbox environments only). It calls nothing:
 * `malicious.example` and its subdomains are listed for `phishing` by the sandbox feed, and every
 * other host is not listed.
 */
import type { MaliciousWebsiteProvider } from '../../ports.js';

/** The sandbox's listed domain and its one feed. */
export const SANDBOX_MALICIOUS_DOMAIN = 'malicious.example';
export const SANDBOX_FEED_ID = 'sandbox';

/** The sandbox provider (C61.6): it calls nothing. */
export function createSandboxMaliciousWebsiteProvider(): MaliciousWebsiteProvider {
  return {
    id: 'sandbox',
    sandbox: true,
    check: ({ host }) =>
      Promise.resolve(
        host === SANDBOX_MALICIOUS_DOMAIN || host.endsWith(`.${SANDBOX_MALICIOUS_DOMAIN}`)
          ? { outcome: 'listed', categories: ['phishing'], feeds: [SANDBOX_FEED_ID] }
          : { outcome: 'not_listed', feeds: [SANDBOX_FEED_ID] },
      ),
  };
}
