/**
 * C51.2, C61.3–C61.5, C66: every reason a business website check can give, read from the
 * contracts' list first, has words, and each reason of a check's own C51.2 row has the type's own
 * words.
 */
import { BUSINESS_CHECK_OUTCOMES, BUSINESS_CHECK_REASONS } from '@openverify/contracts';
import { getCheckDefinition } from '@openverify/core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CheckResults } from '../../components/check-results';
import { reasonText } from '../check-reasons';
import { BUSINESS_WEBSITE_REASON_WORDS } from './business-website';

const WORDS = /^[A-Z][^_]{1,59}$/;

const CHECKS = Object.entries(BUSINESS_CHECK_REASONS).filter(
  ([check]) => getCheckDefinition(check)?.verificationType === 'business_website',
);
const LISTED = CHECKS.flatMap(([check, reasons]) =>
  reasons.map((reason) => [check, reason] as const),
);
const ROWS = Object.entries(BUSINESS_CHECK_OUTCOMES)
  .filter(([check]) => getCheckDefinition(check)?.verificationType === 'business_website')
  .flatMap(([check, row]) =>
    [...row.failed, ...row.notApplicable].map((reason) => [check, reason] as const),
  );

describe('the business website reasons in words (C51.2, C61.3–C61.5, C66)', () => {
  it('reads the four business website checks from the contracts', () => {
    expect(CHECKS.map(([check]) => check)).toEqual([
      'business_website_resolution_detection',
      'business_website_domain_age_detection',
      'business_website_malicious_website_detection',
      'business_website_backlink_detection',
    ]);
  });

  it.each(LISTED)('words %s’s reason %s', (check, reason) => {
    expect(reasonText(reason, check)?.words, `${check} ${reason}`).toMatch(WORDS);
  });

  it.each(ROWS)('words %s’s C51.2 reason %s in the type’s own words', (_check, reason) => {
    expect(Object.hasOwn(BUSINESS_WEBSITE_REASON_WORDS, reason), reason).toBe(true);
  });

  it('explains a reason in one sentence wherever it explains one', () => {
    for (const [code, text] of Object.entries(BUSINESS_WEBSITE_REASON_WORDS)) {
      if (text.explanation !== undefined) {
        expect(text.explanation, code).toMatch(/^[A-Z][^_]+\.$/);
      }
    }
  });

  it('says an unavailable domain age names no platform’s subdomain as the site’s own (C61.4)', () => {
    expect(
      reasonText('domain_age_unavailable', 'business_website_domain_age_detection')?.explanation,
    ).toMatch(/subdomain/);
  });

  it('says a stale feed is an execution error and an empty feed list is not configured (C61.5)', () => {
    expect(
      reasonText('execution_error', 'business_website_malicious_website_detection')?.explanation,
    ).toMatch(/feed/);
    expect(
      reasonText('provider_not_configured', 'business_website_malicious_website_detection')
        ?.explanation,
    ).toMatch(/feed/);
  });

  it('shows the words in the check results', () => {
    render(
      <CheckResults
        checks={[
          {
            name: 'business_website_domain_age_detection',
            status: 'failed',
            reasons: ['domain_recently_registered'],
            requirement: 'not_required',
            metadata: { 'registered-at': '2026-10-17', 'age-days': 3 },
          },
        ]}
        label="Business website"
        status="passed"
      />,
    );

    expect(
      screen.getByRole('table', { name: 'Business website checks needing attention' }),
    ).toHaveTextContent(
      BUSINESS_WEBSITE_REASON_WORDS.domain_recently_registered?.words ?? 'missing words',
    );
  });
});
