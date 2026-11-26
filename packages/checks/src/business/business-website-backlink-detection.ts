/**
 * `business_website_backlink_detection` (A, fraud, disabled by default; C61.5): the backlink count
 * reaches `min-backlinks`, else `backlinks_below_threshold`; metadata `backlink-count` and
 * `backlink-threshold`. Sandbox only in Phase 5.
 */
import type { CheckResult } from '@openverify/core';
import { phase5CheckConfig, phase5ResultOptions } from '../contact/phase5-config.js';
import { checkResult } from '../result.js';
import type { BusinessWebsiteContext } from './context.js';

const ID = 'business_website_backlink_detection';

export function businessWebsiteBacklinkDetection(context: BusinessWebsiteContext): CheckResult {
  const config = phase5CheckConfig(context.template, ID);
  const options = phase5ResultOptions(config, ['min-backlinks']);
  if (context.host === null) {
    return checkResult(ID, 'not_applicable', ['input_missing'], {}, options);
  }
  const outcome = context.input.backlink;
  if (outcome === undefined || outcome.kind === 'not_configured') {
    return checkResult(ID, 'not_applicable', ['provider_not_configured'], {}, options);
  }
  if (outcome.kind === 'error') {
    return checkResult(ID, 'not_applicable', ['execution_error'], {}, options);
  }
  const minimum = config.values['min-backlinks'];
  const threshold = typeof minimum === 'number' ? minimum : 0;
  const metadata = { 'backlink-count': outcome.result.count, 'backlink-threshold': threshold };
  const withProvider = { ...options, provider: outcome.provider };
  return outcome.result.count >= threshold
    ? checkResult(ID, 'passed', [], metadata, withProvider)
    : checkResult(ID, 'failed', ['backlinks_below_threshold'], metadata, withProvider);
}
