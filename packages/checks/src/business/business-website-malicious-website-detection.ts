/**
 * `business_website_malicious_website_detection` (A, fraud, disabled by default; C61.5): the site is
 * not listed on the operator's feeds. A listing fails with each category it is listed for
 * (`malware`, `phishing`, `spam_source`); no feed loaded answers `provider_not_configured` and a stale
 * feed `execution_error`. A pass means only that no configured feed lists the host.
 */
import type { CheckResult } from '@openverify/core';
import { checkResult } from '../result.js';
import type { BusinessWebsiteContext } from './context.js';

const ID = 'business_website_malicious_website_detection';

/** The listing categories, in the order a failure names them (C51.2). */
const CATEGORIES = ['malware', 'phishing', 'spam_source'] as const;

export function businessWebsiteMaliciousWebsiteDetection(
  context: BusinessWebsiteContext,
): CheckResult {
  if (context.host === null) {
    return checkResult(ID, 'not_applicable', ['input_missing']);
  }
  const outcome = context.input.maliciousWebsite;
  if (outcome === undefined || outcome.kind === 'not_configured') {
    return checkResult(ID, 'not_applicable', ['provider_not_configured']);
  }
  if (outcome.kind === 'error') {
    return checkResult(ID, 'not_applicable', ['execution_error']);
  }
  const options = { provider: outcome.provider };
  const answer = outcome.result;
  switch (answer.outcome) {
    case 'no_feeds':
      return checkResult(ID, 'not_applicable', ['provider_not_configured'], {}, options);
    case 'stale':
      return checkResult(
        ID,
        'not_applicable',
        ['execution_error'],
        { 'feed-count': answer.feeds.length },
        options,
      );
    case 'not_listed':
      return checkResult(ID, 'passed', [], { 'feed-count': answer.feeds.length }, options);
    case 'listed':
      return checkResult(
        ID,
        'failed',
        CATEGORIES.filter((category) => answer.categories.includes(category)),
        { 'feed-count': answer.feeds.length },
        options,
      );
  }
}
