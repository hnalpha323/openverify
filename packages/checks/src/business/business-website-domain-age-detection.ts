/**
 * `business_website_domain_age_detection` (R, fraud, advisory; C61.4, H13): the registered domain is
 * at least `min-domain-age-days` old by its RDAP registration date, else `domain_recently_registered`.
 * RDAP answering only for a shorter name (a platform's subdomain), a TLD without RDAP, no record or
 * no registration date answer `domain_age_unavailable` (flag `subdomain` for the first), never a pass.
 */
import type { CheckResult } from '@openverify/core';
import { phase5CheckConfig, phase5ResultOptions } from '../contact/phase5-config.js';
import { checkResult } from '../result.js';
import type { BusinessWebsiteContext } from './context.js';

const ID = 'business_website_domain_age_detection';

const DAY_MS = 86_400_000;

export function businessWebsiteDomainAgeDetection(context: BusinessWebsiteContext): CheckResult {
  const config = phase5CheckConfig(context.template, ID);
  const options = phase5ResultOptions(config, ['min-domain-age-days']);
  if (context.host === null) {
    return checkResult(ID, 'not_applicable', ['input_missing'], {}, options);
  }
  const outcome = context.input.domainAge;
  if (outcome === undefined || outcome.kind === 'not_configured') {
    return checkResult(ID, 'not_applicable', ['provider_not_configured'], {}, options);
  }
  if (outcome.kind === 'error') {
    return checkResult(ID, 'not_applicable', ['execution_error'], {}, options);
  }
  const withProvider = { ...options, provider: outcome.provider };
  const answer = outcome.result;
  if (answer.outcome === 'unavailable') {
    // C61.4: a shorter name answering is a platform's, not the site's (flag `subdomain`).
    return checkResult(
      ID,
      'not_applicable',
      ['domain_age_unavailable'],
      { flags: [answer.reason.replaceAll('_', '-')] },
      withProvider,
    );
  }
  const elapsed = context.now.getTime() - answer.registeredAt.getTime();
  if (Number.isNaN(elapsed) || elapsed < -DAY_MS) {
    return checkResult(
      ID,
      'not_applicable',
      ['domain_age_unavailable'],
      { flags: ['future-date'] },
      withProvider,
    );
  }
  const age = Math.max(0, Math.floor(elapsed / DAY_MS));
  const metadata = {
    'registered-at': answer.registeredAt.toISOString().slice(0, 10),
    'age-days': age,
  };
  const minimum = config.values['min-domain-age-days'];
  return age >= (typeof minimum === 'number' ? minimum : 0)
    ? checkResult(ID, 'passed', [], metadata, withProvider)
    : checkResult(ID, 'failed', ['domain_recently_registered'], metadata, withProvider);
}
