/**
 * C61.6: the sandbox malicious-website provider: malicious.example and its subdomains are listed for
 * phishing by the sandbox feed, every other host is not listed.
 */
import { describe, expect, it } from 'vitest';
import {
  SANDBOX_FEED_ID,
  SANDBOX_MALICIOUS_DOMAIN,
  createSandboxMaliciousWebsiteProvider,
} from './sandbox.js';

const check = (host: string) =>
  createSandboxMaliciousWebsiteProvider().check({ host, url: `https://${host}/` });

describe('the sandbox malicious-website provider (C61.6)', () => {
  it('is the sandbox provider, with one feed', () => {
    expect(createSandboxMaliciousWebsiteProvider()).toMatchObject({ id: 'sandbox', sandbox: true });
    expect([SANDBOX_MALICIOUS_DOMAIN, SANDBOX_FEED_ID]).toEqual(['malicious.example', 'sandbox']);
  });

  it('lists malicious.example and its subdomains for phishing', async () => {
    for (const host of ['malicious.example', 'login.malicious.example']) {
      expect(await check(host)).toEqual({
        outcome: 'listed',
        categories: ['phishing'],
        feeds: ['sandbox'],
      });
    }
  });

  it('lists no other host', async () => {
    for (const host of ['old.example', 'notmalicious.example', 'malicious.example.test']) {
      expect(await check(host)).toEqual({ outcome: 'not_listed', feeds: ['sandbox'] });
    }
  });
});
