/**
 * C54.5: `reasonText` with the name of the check that gave a code consults the module of the
 * check's type first. The database module is replaced here with words of its own, and the AAMVA
 * module with none, so the lookup is tested apart from what Workflow 5C writes in the real ones
 * (C66: the AAMVA module words `record_not_found` and `execution_error` too).
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CheckResults } from '../../components/check-results';
import { reasonText } from '../check-reasons';

vi.mock('./database', () => ({
  DATABASE_REASON_WORDS: Object.freeze({
    record_not_found: { words: 'No record found', explanation: 'The source has no such person.' },
    execution_error: { words: 'The source could not be asked' },
  }),
}));
vi.mock('./aamva', () => ({ AAMVA_REASON_WORDS: Object.freeze({}) }));

describe('reasonText by check (C54.5)', () => {
  it("takes the words of the check's type first", () => {
    expect(reasonText('record_not_found', 'database_identity_comparison')).toEqual({
      words: 'No record found',
      explanation: 'The source has no such person.',
    });
    expect(reasonText('execution_error', 'database_name_comparison')).toEqual({
      words: 'The source could not be asked',
    });
  });

  it('takes the shared words for a check of another type, an unknown check, or none', () => {
    expect(reasonText('execution_error', 'aamva_identity_comparison')).toEqual({
      words: 'Could not run',
    });
    expect(reasonText('execution_error', 'no_such_check')).toEqual({ words: 'Could not run' });
    expect(reasonText('execution_error')).toEqual({ words: 'Could not run' });
    expect(reasonText('record_not_found', 'aamva_identity_comparison')).toBeUndefined();
  });

  it('never finds words on the prototype', () => {
    expect(reasonText('constructor', 'database_identity_comparison')).toBeUndefined();
    expect(reasonText('toString', 'database_identity_comparison')).toBeUndefined();
  });

  it("shows a check's reasons in its type's words", () => {
    render(
      <CheckResults
        checks={[
          {
            name: 'database_identity_comparison',
            status: 'failed',
            reasons: ['record_not_found'],
            requirement: 'required',
            metadata: {},
          },
          // A required check without evidence, which the review note names (C30.4).
          {
            name: 'database_name_comparison',
            status: 'not_applicable',
            reasons: ['execution_error'],
            requirement: 'required',
            metadata: {},
          },
        ]}
        label="Database"
        status="needs_review"
      />,
    );

    expect(
      screen.getByRole('table', { name: 'Database checks needing attention' }),
    ).toHaveTextContent('No record found');
    expect(screen.getByRole('note', { name: 'Why it needs review' })).toHaveTextContent(
      'database_name_comparison (The source could not be asked)',
    );
  });
});
