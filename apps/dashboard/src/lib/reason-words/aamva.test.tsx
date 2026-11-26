/**
 * C51.2, C59.5, C66: every reason an AAMVA check can give, read from the contracts' list first,
 * has words, and each reason of a check's own C51.2 row has the AAMVA type's own words (the
 * issuing jurisdiction's record, not a database source's).
 */
import { DATABASE_CHECK_OUTCOMES, DATABASE_CHECK_REASONS } from '@openverify/contracts';
import { getCheckDefinition } from '@openverify/core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CheckResults } from '../../components/check-results';
import { reasonText } from '../check-reasons';
import { AAMVA_REASON_WORDS } from './aamva';

const WORDS = /^[A-Z][^_]{1,59}$/;

const CHECKS = Object.entries(DATABASE_CHECK_REASONS).filter(
  ([check]) => getCheckDefinition(check)?.verificationType === 'aamva',
);
const LISTED = CHECKS.flatMap(([check, reasons]) =>
  reasons.map((reason) => [check, reason] as const),
);
const ROWS = Object.entries(DATABASE_CHECK_OUTCOMES)
  .filter(([check]) => getCheckDefinition(check)?.verificationType === 'aamva')
  .flatMap(([check, row]) =>
    [...row.failed, ...row.notApplicable].map((reason) => [check, reason] as const),
  );

describe('the AAMVA reasons in words (C51.2, C59.5, C66)', () => {
  it('reads the three AAMVA checks from the contracts', () => {
    expect(CHECKS.map(([check]) => check)).toEqual([
      'aamva_identity_comparison',
      'aamva_name_comparison',
      'aamva_identification_number_comparison',
    ]);
  });

  it.each(LISTED)('words %s’s reason %s', (check, reason) => {
    expect(reasonText(reason, check)?.words, `${check} ${reason}`).toMatch(WORDS);
  });

  it.each(ROWS)('words %s’s C51.2 reason %s in the AAMVA type’s own words', (_check, reason) => {
    expect(Object.hasOwn(AAMVA_REASON_WORDS, reason), reason).toBe(true);
  });

  it('explains a reason in one sentence wherever it explains one', () => {
    for (const [code, text] of Object.entries(AAMVA_REASON_WORDS)) {
      if (text.explanation !== undefined) {
        expect(text.explanation, code).toMatch(/^[A-Z][^_]+\.$/);
      }
    }
  });

  it('says a jurisdiction outside the lookup goes to review or is skipped, never fails', () => {
    expect(
      reasonText('jurisdiction_not_participating', 'aamva_identity_comparison')?.explanation,
    ).toMatch(/review.*skipped/);
  });

  it('keeps the shared words where the AAMVA type has nothing to add', () => {
    expect(reasonText('execution_error', 'aamva_identity_comparison')).toEqual({
      words: 'Could not run',
    });
  });

  it('shows the words in the check results', () => {
    render(
      <CheckResults
        checks={[
          {
            name: 'aamva_identity_comparison',
            status: 'failed',
            reasons: ['record_mismatch'],
            requirement: 'required',
            metadata: { 'mismatched-fields': ['address-postal-code'] },
          },
        ]}
        label="AAMVA"
        status="failed"
      />,
    );

    expect(screen.getByRole('table', { name: 'AAMVA checks needing attention' })).toHaveTextContent(
      AAMVA_REASON_WORDS.record_mismatch?.words ?? 'missing words',
    );
  });
});
