/**
 * `email_address_disposable_detection` (R, fraud, advisory by default, C56): the address's domain
 * and each parent against the CC0 disposable list and the template's `allow-domains` and
 * `deny-domains`, the most specific match deciding (`matchDisposableDomain`).
 *
 * A denied or listed domain fails `disposable_domain`; an allowed or unlisted one passes; no list
 * file and no operator match answers `list_unavailable` (never a pass without the list); no valid
 * address answers `input_missing`. Provenance names the list file by its id and SHA-256 (as its
 * `models` entry); metadata says what matched and how far up, never the domain.
 */
import type { CheckResult } from '@openverify/core';
import { checkResult } from '../result.js';
import type { EmailAddressContext } from './context.js';
import { matchDisposableDomain } from './disposable-domains.js';
import { phase5CheckConfig, phase5ResultOptions, stringListIn } from './phase5-config.js';

const CHECK_ID = 'email_address_disposable_detection';
const KEYS = ['allow-domains', 'deny-domains'] as const;

export function emailAddressDisposableDetection(context: EmailAddressContext): CheckResult {
  const config = phase5CheckConfig(context.template, CHECK_ID);
  const options = phase5ResultOptions(config, KEYS);
  if (context.domain === null) {
    return checkResult(CHECK_ID, 'not_applicable', ['input_missing'], {}, options);
  }
  const list = context.input.disposableList ?? null;
  const match = matchDisposableDomain(context.domain, {
    listed: list?.domains ?? null,
    allow: stringListIn(config, 'allow-domains'),
    deny: stringListIn(config, 'deny-domains'),
  });
  const withList = list === null ? options : { ...options, models: [list.source] };
  if (match === null) {
    return list === null
      ? checkResult(CHECK_ID, 'not_applicable', ['list_unavailable'], {}, options)
      : checkResult(CHECK_ID, 'passed', [], { match: 'none' }, withList);
  }
  const metadata = { match: match.kind, 'match-depth': match.depth };
  return match.kind === 'allowed'
    ? checkResult(CHECK_ID, 'passed', [], metadata, withList)
    : checkResult(CHECK_ID, 'failed', ['disposable_domain'], metadata, withList);
}
