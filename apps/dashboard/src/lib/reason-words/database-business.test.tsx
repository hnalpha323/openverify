/**
 * C51.2, C61.7, C66: every reason a business registry check can give, read from the contracts'
 * list first, has words, and each reason of a check's own C51.2 row has the type's own words.
 */
import { BUSINESS_CHECK_OUTCOMES, BUSINESS_CHECK_REASONS } from '@openverify/contracts';
import { getCheckDefinition } from '@openverify/core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CheckResults } from '../../components/check-results';
import { reasonText } from '../check-reasons';
import { DATABASE_BUSINESS_REASON_WORDS } from './database-business';

const WORDS = /^[A-Z][^_]{1,59}$/;

const CHECKS = Object.entries(BUSINESS_CHECK_REASONS).filter(
  ([check]) => getCheckDefinition(check)?.verificationType === 'database_business',
);
const LISTED = CHECKS.flatMap(([check, reasons]) =>
  reasons.map((reason) => [check, reason] as const),
);
const ROWS = Object.entries(BUSINESS_CHECK_OUTCOMES)
  .filter(([check]) => getCheckDefinition(check)?.verificationType === 'database_business')
  .flatMap(([check, row]) =>
    [...row.failed, ...row.notApplicable].map((reason) => [check, reason] as const),
  );

describe('the business registry reasons in words (C51.2, C61.7, C66)', () => {
  it('reads the five business registry checks from the contracts', () => {
    expect(CHECKS.map(([check]) => check)).toEqual([
      'database_business_identity_comparison',
      'database_business_active_business_detection',
      'database_business_associated_persons_comparison',
      'database_business_enabled_country_detection',
      'database_business_service_available_detection',
    ]);
  });

  it.each(LISTED)('words %s’s reason %s', (check, reason) => {
    expect(reasonText(reason, check)?.words, `${check} ${reason}`).toMatch(WORDS);
  });

  it.each(ROWS)('words %s’s C51.2 reason %s in the type’s own words', (_check, reason) => {
    expect(Object.hasOwn(DATABASE_BUSINESS_REASON_WORDS, reason), reason).toBe(true);
  });

  it('explains a reason in one sentence wherever it explains one', () => {
    for (const [code, text] of Object.entries(DATABASE_BUSINESS_REASON_WORDS)) {
      if (text.explanation !== undefined) {
        expect(text.explanation, code).toMatch(/^[A-Z][^_]+\.$/);
      }
    }
  });

  it('says a number the register lacks and a business no register holds go to review (V14)', () => {
    expect(
      reasonText('registration_number_not_found', 'database_business_identity_comparison')
        ?.explanation,
    ).toMatch(/review/);
    expect(
      reasonText('no_registry_record', 'database_business_identity_comparison')?.explanation,
    ).toMatch(/review/);
  });

  it('says the persons and the country allowlist the step did not ask for do not count', () => {
    expect(
      reasonText('not_requested', 'database_business_associated_persons_comparison')?.explanation,
    ).toMatch(/does not count/);
    expect(
      reasonText('no_allowlist', 'database_business_enabled_country_detection')?.explanation,
    ).toMatch(/does not count/);
  });

  it('shows the words in the check results', () => {
    render(
      <CheckResults
        checks={[
          {
            name: 'database_business_active_business_detection',
            status: 'failed',
            reasons: ['business_inactive'],
            requirement: 'required',
            metadata: { source: 'sandbox', status: 'dissolved', flags: [] },
          },
        ]}
        label="Business registry"
        status="failed"
      />,
    );

    expect(
      screen.getByRole('table', { name: 'Business registry checks needing attention' }),
    ).toHaveTextContent(DATABASE_BUSINESS_REASON_WORDS.business_inactive?.words ?? 'missing words');
  });
});
