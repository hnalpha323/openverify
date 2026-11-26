/**
 * C278.4 and KP11-46 (the access-request section's record test): the page names what C253's export
 * does not cover (`ACCOUNT_EXPORT_NOT_COVERED`), the "review before disclosure" part, the export's
 * lifetime (`account-export-ttl-days` with its bounds), the `account-export` rate policy failing
 * closed, the counterparty's records excluded, and KP11-27's limit, each read from the contracts.
 */
import {
  ACCOUNT_EXPORT_NOT_COVERED,
  ACCOUNT_EXPORT_TTL_DAYS,
  RATE_LIMIT_DEFAULTS,
  RATE_LIMIT_POLICY_WINDOWS,
} from '@openverify/contracts';
import type { CheckFinding, Repository } from '../types.js';
import { ACCESS_REQUESTS_PAGE } from './pages.js';

/** A policy window in words, as the page writes it. */
function windowWords(seconds: number): string {
  if (seconds === 3600) return 'an hour';
  if (seconds === 60) return 'a minute';
  return `per ${String(seconds)} seconds`;
}

/** The phrases the page must hold, computed from the contracts. */
export function accessRequestPhrases(): readonly string[] {
  const ttl = ACCOUNT_EXPORT_TTL_DAYS;
  const limit = RATE_LIMIT_DEFAULTS['account-export'];
  const window = RATE_LIMIT_POLICY_WINDOWS['account-export'];
  return [
    'C253',
    ...ACCOUNT_EXPORT_NOT_COVERED.map((kind) => `\`${kind}\``),
    '`operator-review`',
    'review before disclosure',
    `\`account-export-ttl-days\` (${String(ttl.min)} to ${String(ttl.max)} days, default ${String(ttl.default)})`,
    `${String(limit)} exports ${windowWords(window)} per environment`,
    '`account_export_unavailable`',
    '`listSharesTouching`',
    'KP11-27',
  ];
}

/** The phrases the page lacks. */
export function accessRequestFindings(repo: Repository): readonly CheckFinding[] {
  if (!repo.exists(ACCESS_REQUESTS_PAGE)) {
    return [
      {
        rule: 'compliance-access-requests',
        path: ACCESS_REQUESTS_PAGE,
        message: 'is missing (C278.4)',
        severity: 'error',
      },
    ];
  }
  const text = repo.readText(ACCESS_REQUESTS_PAGE).replace(/\s+/g, ' ');
  return accessRequestPhrases()
    .filter((phrase) => !text.includes(phrase))
    .map((phrase) => ({
      rule: 'compliance-access-requests',
      path: ACCESS_REQUESTS_PAGE,
      message: `lacks ${phrase} (C278.4, KP11-46)`,
      severity: 'error' as const,
    }));
}
