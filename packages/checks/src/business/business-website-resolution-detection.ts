/**
 * `business_website_resolution_detection` (R, user behaviour, required, ours; C61.3, H14): the
 * URL's host resolves to a public A or AAAA address (no HTTP fetch). NXDOMAIN, no address or only
 * private ones fail `domain_not_resolving` (a mistyped URL); a resolver that failed answers
 * `execution_error`, none bound `provider_not_configured`. In a sandbox environment `*.example` and
 * `*.test` resolve and `*.invalid` does not, with no query. Metadata counts addresses, never one.
 */
import type { CheckResult } from '@openverify/core';
import { checkResult } from '../result.js';
import type { BusinessWebsiteContext } from './context.js';
import { isPublicIpAddress, sandboxWebsiteHostRule } from './website.js';

const ID = 'business_website_resolution_detection';

export function businessWebsiteResolutionDetection(context: BusinessWebsiteContext): CheckResult {
  const { host } = context;
  if (host === null) {
    return checkResult(ID, 'not_applicable', ['input_missing']);
  }
  const reserved = sandboxWebsiteHostRule(host, context.environment);
  if (reserved !== null) {
    return reserved === 'resolves'
      ? checkResult(ID, 'passed', [], { route: 'reserved' })
      : checkResult(ID, 'failed', ['domain_not_resolving'], { route: 'reserved' });
  }
  const outcome = context.input.resolution;
  if (outcome === undefined || outcome.kind === 'not_configured') {
    return checkResult(ID, 'not_applicable', ['provider_not_configured']);
  }
  if (outcome.kind === 'error') {
    return checkResult(ID, 'not_applicable', ['execution_error']);
  }
  const options = { provider: outcome.provider };
  const answer = outcome.result;
  if (answer.kind !== 'addresses') {
    return checkResult(
      ID,
      'failed',
      ['domain_not_resolving'],
      { route: answer.kind === 'not_found' ? 'nxdomain' : 'no-address' },
      options,
    );
  }
  const publicCount = answer.addresses.filter((address) => isPublicIpAddress(address)).length;
  const metadata = {
    route: 'dns',
    'address-count': answer.addresses.length,
    'public-address-count': publicCount,
  };
  return publicCount > 0
    ? checkResult(ID, 'passed', [], metadata, options)
    : checkResult(ID, 'failed', ['domain_not_resolving'], metadata, options);
}
