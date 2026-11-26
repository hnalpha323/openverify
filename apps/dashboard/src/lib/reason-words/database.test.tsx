/**
 * C51.2, C66: every reason a database check can give, read from the contracts' list first, has
 * words, and each reason of a check's own C51.2 row has the database type's own words (a
 * `record_not_found` from a database source is not an AAMVA one).
 */
import { DATABASE_CHECK_OUTCOMES, DATABASE_CHECK_REASONS } from '@openverify/contracts';
import { getCheckDefinition } from '@openverify/core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CheckResults } from '../../components/check-results';
import { reasonText } from '../check-reasons';
import { DATABASE_REASON_WORDS } from './database';

/** Short words: a capital first, no code, at most 60 characters (as `index.test.ts`). */
const WORDS = /^[A-Z][^_]{1,59}$/;

const CHECKS = Object.entries(DATABASE_CHECK_REASONS).filter(
  ([check]) => getCheckDefinition(check)?.verificationType === 'database',
);

/** Each check with each reason the contracts list for it. */
const LISTED = CHECKS.flatMap(([check, reasons]) =>
  reasons.map((reason) => [check, reason] as const),
);

/** Each check with each reason of its C51.2 row (what it fails with or answers N/A with). */
const ROWS = Object.entries(DATABASE_CHECK_OUTCOMES)
  .filter(([check]) => getCheckDefinition(check)?.verificationType === 'database')
  .flatMap(([check, row]) =>
    [...row.failed, ...row.notApplicable].map((reason) => [check, reason] as const),
  );

describe('the database reasons in words (C51.2, C66)', () => {
  it('reads the six database checks from the contracts', () => {
    expect(CHECKS.map(([check]) => check)).toEqual([
      'database_identity_comparison',
      'database_name_comparison',
      'database_address_comparison',
      'database_birthdate_comparison',
      'database_inquiry_comparison',
      'database_po_box_detection',
    ]);
    expect(LISTED.length).toBeGreaterThan(ROWS.length);
  });

  it.each(LISTED)('words %s’s reason %s', (check, reason) => {
    expect(reasonText(reason, check)?.words, `${check} ${reason}`).toMatch(WORDS);
  });

  it.each(ROWS)('words %s’s C51.2 reason %s in the database type’s own words', (_check, reason) => {
    expect(Object.hasOwn(DATABASE_REASON_WORDS, reason), reason).toBe(true);
  });

  it('explains a reason in one sentence wherever it explains one', () => {
    for (const [code, text] of Object.entries(DATABASE_REASON_WORDS)) {
      if (text.explanation !== undefined) {
        expect(text.explanation, code).toMatch(/^[A-Z][^_]+\.$/);
      }
    }
  });

  it('says a miss from a source that is not authoritative goes to review, never to a failure', () => {
    expect(reasonText('no_matching_record', 'database_identity_comparison')?.explanation).toMatch(
      /not authoritative.*review/,
    );
    expect(reasonText('record_not_found', 'database_identity_comparison')?.explanation).toMatch(
      /authoritative/,
    );
    expect(reasonText('insufficient_data', 'database_identity_comparison')?.explanation).toMatch(
      /missing/,
    );
  });

  it('says a field the step did not collect does not count against the verification', () => {
    expect(reasonText('not_requested', 'database_name_comparison')?.explanation).toMatch(
      /does not count/,
    );
  });

  it('shows the words in the check results', () => {
    render(
      <CheckResults
        checks={[
          {
            name: 'database_identity_comparison',
            status: 'failed',
            reasons: ['low_confidence_match'],
            requirement: 'required',
            metadata: {},
          },
        ]}
        label="Database"
        status="failed"
      />,
    );

    expect(
      screen.getByRole('table', { name: 'Database checks needing attention' }),
    ).toHaveTextContent(DATABASE_REASON_WORDS.low_confidence_match?.words ?? 'missing words');
  });
});
