import {
  ACCOUNT_EXPORT_NOT_COVERED,
  ACCOUNT_EXPORT_TTL_DAYS,
  RATE_LIMIT_DEFAULTS,
} from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { REPOSITORY_ROOT, createMemoryRepository, createRepository } from '../repository.js';
import { accessRequestFindings, accessRequestPhrases } from './access-requests.js';
import { ACCESS_REQUESTS_PAGE } from './pages.js';

describe('the access-request section (C278.4, KP11-46)', () => {
  const phrases = accessRequestPhrases();

  it('demands every not-covered kind of the export, from the contracts', () => {
    for (const kind of ACCOUNT_EXPORT_NOT_COVERED) {
      expect(phrases).toContain(`\`${kind}\``);
    }
  });

  it('demands the operator-review label, the lifetime, the policy and the limits', () => {
    expect(phrases).toEqual(
      expect.arrayContaining([
        'review before disclosure',
        '`operator-review`',
        `\`account-export-ttl-days\` (${String(ACCOUNT_EXPORT_TTL_DAYS.min)} to ${String(ACCOUNT_EXPORT_TTL_DAYS.max)} days, default ${String(ACCOUNT_EXPORT_TTL_DAYS.default)})`,
        `${String(RATE_LIMIT_DEFAULTS['account-export'])} exports an hour per environment`,
        '`account_export_unavailable`',
        '`listSharesTouching`',
        'KP11-27',
        'C253',
      ]),
    );
  });

  it('reports a missing page, then each missing phrase', () => {
    expect(accessRequestFindings(createMemoryRepository({}))).toEqual([
      {
        rule: 'compliance-access-requests',
        path: ACCESS_REQUESTS_PAGE,
        message: 'is missing (C278.4)',
        severity: 'error',
      },
    ]);
    const partial = createMemoryRepository({ [ACCESS_REQUESTS_PAGE]: phrases.slice(1).join('\n') });
    expect(accessRequestFindings(partial).map((item) => item.message)).toEqual([
      `lacks ${String(phrases[0])} (C278.4, KP11-46)`,
    ]);
  });

  it('holds the committed page', () => {
    expect(accessRequestFindings(createRepository(REPOSITORY_ROOT))).toEqual([]);
  });
});
