/**
 * C61.3-C61.5: the business website checks: resolution to a public address (the website's
 * required core), the registered domain's age, the operator's feeds and backlinks. No check
 * fetches the site, and none passes without its answer.
 */
import type { CheckId, CheckResult } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { evaluateBusinessWebsiteChecks } from './evaluate.js';
import type { BusinessWebsiteCheckInput, MaliciousWebsiteLookup } from './inputs.js';
import {
  DNS_PROVIDER,
  NOW,
  RDAP_PROVIDER,
  SANDBOX_PROVIDER,
  result,
  templateOf,
  websiteInput,
} from './testing.js';

function resultOf(
  checkId: CheckId,
  input: BusinessWebsiteCheckInput,
  config?: Record<string, unknown>,
): CheckResult {
  const results = evaluateBusinessWebsiteChecks(
    input,
    templateOf([checkId], config === undefined ? {} : { [checkId]: config }),
  );
  const [only] = results;
  if (only === undefined || results.length !== 1) {
    throw new Error('expected one result');
  }
  return only;
}

const daysBefore = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

describe('business_website_resolution_detection', () => {
  const ID = 'business_website_resolution_detection';
  const resolving = (addresses: readonly string[]) =>
    websiteInput({ resolution: result({ kind: 'addresses', addresses }, DNS_PROVIDER) });

  it('passes a host that resolves to a public address, counting addresses only', () => {
    const passed = resultOf(ID, resolving(['1.1.1.1', '2606:4700:4700::1111']));
    expect(passed.status).toBe('passed');
    expect(passed.metadata).toEqual({
      route: 'dns',
      'address-count': 2,
      'public-address-count': 2,
    });
    expect(passed.provenance.provider).toEqual(DNS_PROVIDER);
  });

  it('fails NXDOMAIN, no address, or only private addresses (domain_not_resolving)', () => {
    expect(
      resultOf(ID, websiteInput({ resolution: result({ kind: 'not_found' }, DNS_PROVIDER) }))
        .reasons,
    ).toEqual(['domain_not_resolving']);
    expect(
      resultOf(ID, websiteInput({ resolution: result({ kind: 'no_address' }, DNS_PROVIDER) }))
        .reasons,
    ).toEqual(['domain_not_resolving']);
    const internal = resultOf(ID, resolving(['10.0.0.8']));
    expect(internal.reasons).toEqual(['domain_not_resolving']);
    expect(internal.metadata).toEqual({
      route: 'dns',
      'address-count': 1,
      'public-address-count': 0,
    });
  });

  it('answers execution_error when the resolver failed, provider_not_configured without one', () => {
    expect(resultOf(ID, websiteInput({ resolution: { kind: 'error' } })).reasons).toEqual([
      'execution_error',
    ]);
    expect(resultOf(ID, websiteInput()).reasons).toEqual(['provider_not_configured']);
    expect(resultOf(ID, websiteInput({ resolution: { kind: 'not_configured' } })).reasons).toEqual([
      'provider_not_configured',
    ]);
  });

  it('decides the reserved names of a sandbox environment without a query', () => {
    const sandbox = (url: string) =>
      websiteInput({ environment: 'sandbox', values: { 'website-url': url } });
    const old = resultOf(ID, sandbox('https://old.example/'));
    expect(old.status).toBe('passed');
    expect(old.metadata).toEqual({ route: 'reserved' });
    expect(resultOf(ID, sandbox('https://gone.invalid/')).reasons).toEqual([
      'domain_not_resolving',
    ]);
    expect(
      resultOf(ID, websiteInput({ values: { 'website-url': 'https://old.example/' } })).reasons,
    ).toEqual(['provider_not_configured']);
  });

  it('answers input_missing without a valid URL', () => {
    expect(resultOf(ID, websiteInput({ values: null })).reasons).toEqual(['input_missing']);
    expect(resultOf(ID, websiteInput({ values: { 'website-url': 'not a url' } })).reasons).toEqual([
      'input_missing',
    ]);
  });
});

describe('business_website_domain_age_detection', () => {
  const ID = 'business_website_domain_age_detection';
  const aged = (days: number) =>
    websiteInput({
      domainAge: result(
        { outcome: 'registered', registeredAt: daysBefore(days), domain: 'utopiaorchard.example' },
        RDAP_PROVIDER,
      ),
    });

  it('passes a domain registered before min-domain-age-days (90 by default)', () => {
    const old = resultOf(ID, aged(7300));
    expect(old.status).toBe('passed');
    expect(old.metadata).toEqual({
      'registered-at': daysBefore(7300).toISOString().slice(0, 10),
      'age-days': 7300,
    });
    expect(old.provenance.thresholds).toEqual({ 'min-domain-age-days': 90 });
    expect(old.provenance['threshold-basis']).toEqual({ 'min-domain-age-days': 'provisional' });
  });

  it('fails one registered since (domain_recently_registered), and honours the configured age', () => {
    expect(resultOf(ID, aged(3)).reasons).toEqual(['domain_recently_registered']);
    expect(resultOf(ID, aged(3), { 'min-domain-age-days': 1 }).status).toBe('passed');
  });

  it('answers domain_age_unavailable for a subdomain, a TLD without RDAP, or a future date', () => {
    const unavailable = (
      reason: 'subdomain' | 'no_rdap_service' | 'not_found' | 'no_registration_date',
    ) =>
      resultOf(
        ID,
        websiteInput({ domainAge: result({ outcome: 'unavailable', reason }, RDAP_PROVIDER) }),
      );
    const subdomain = unavailable('subdomain');
    expect(subdomain.reasons).toEqual(['domain_age_unavailable']);
    expect(subdomain.metadata).toEqual({ flags: ['subdomain'] });
    expect(unavailable('no_rdap_service').metadata).toEqual({ flags: ['no-rdap-service'] });
    expect(unavailable('not_found').reasons).toEqual(['domain_age_unavailable']);
    expect(unavailable('no_registration_date').reasons).toEqual(['domain_age_unavailable']);
    const future = resultOf(ID, aged(-5));
    expect(future.reasons).toEqual(['domain_age_unavailable']);
    expect(future.metadata).toEqual({ flags: ['future-date'] });
  });

  it('never passes without RDAP: unbound, failed, or no host', () => {
    expect(resultOf(ID, websiteInput()).reasons).toEqual(['provider_not_configured']);
    expect(resultOf(ID, websiteInput({ domainAge: { kind: 'error' } })).reasons).toEqual([
      'execution_error',
    ]);
    expect(resultOf(ID, { ...aged(7300), values: null }).reasons).toEqual(['input_missing']);
  });
});

describe('business_website_malicious_website_detection', () => {
  const ID = 'business_website_malicious_website_detection';
  const feeds = (lookup: MaliciousWebsiteLookup) =>
    websiteInput({ maliciousWebsite: result(lookup, SANDBOX_PROVIDER) });

  it('passes a host no configured feed lists', () => {
    const clean = resultOf(ID, feeds({ outcome: 'not_listed', feeds: ['feed-a', 'feed-b'] }));
    expect(clean.status).toBe('passed');
    expect(clean.metadata).toEqual({ 'feed-count': 2 });
    expect(clean.provenance.provider).toEqual(SANDBOX_PROVIDER);
  });

  it('fails a listed host with each category it is listed for, in a fixed order', () => {
    expect(
      resultOf(ID, feeds({ outcome: 'listed', categories: ['phishing'], feeds: ['feed-a'] }))
        .reasons,
    ).toEqual(['phishing']);
    expect(
      resultOf(
        ID,
        feeds({
          outcome: 'listed',
          categories: ['spam_source', 'malware', 'spam_source'],
          feeds: ['feed-a', 'feed-b'],
        }),
      ).reasons,
    ).toEqual(['malware', 'spam_source']);
  });

  it('answers provider_not_configured without a feed, execution_error for a stale one', () => {
    expect(resultOf(ID, feeds({ outcome: 'no_feeds' })).reasons).toEqual([
      'provider_not_configured',
    ]);
    expect(resultOf(ID, feeds({ outcome: 'stale', feeds: ['feed-a'] })).reasons).toEqual([
      'execution_error',
    ]);
    expect(resultOf(ID, websiteInput()).reasons).toEqual(['provider_not_configured']);
    expect(resultOf(ID, websiteInput({ maliciousWebsite: { kind: 'error' } })).reasons).toEqual([
      'execution_error',
    ]);
    expect(resultOf(ID, { ...feeds({ outcome: 'no_feeds' }), values: null }).reasons).toEqual([
      'input_missing',
    ]);
  });
});

describe('business_website_backlink_detection', () => {
  const ID = 'business_website_backlink_detection';
  const counted = (count: number) =>
    websiteInput({ backlink: result({ count }, SANDBOX_PROVIDER) });

  it('passes a count reaching min-backlinks (10 by default), with the public metadata names', () => {
    const many = resultOf(ID, counted(250));
    expect(many.status).toBe('passed');
    expect(many.metadata).toEqual({ 'backlink-count': 250, 'backlink-threshold': 10 });
    expect(many.provenance['threshold-basis']).toEqual({ 'min-backlinks': 'provisional' });
  });

  it('fails a lower count (backlinks_below_threshold), and honours the configured minimum', () => {
    expect(resultOf(ID, counted(3)).reasons).toEqual(['backlinks_below_threshold']);
    expect(resultOf(ID, counted(0), { 'min-backlinks': 0 }).status).toBe('passed');
  });

  it('never passes without a provider or a host', () => {
    expect(resultOf(ID, websiteInput()).reasons).toEqual(['provider_not_configured']);
    expect(resultOf(ID, websiteInput({ backlink: { kind: 'error' } })).reasons).toEqual([
      'execution_error',
    ]);
    expect(
      resultOf(ID, { ...counted(250), values: { 'website-url': 'ftp://old.example' } }).reasons,
    ).toEqual(['input_missing']);
  });
});
