import {
  CHECK_STATUSES,
  INQUIRY_STATUSES,
  VERIFICATION_STATUSES,
  type CheckStatus,
  type InquiryStatus,
  type VerificationStatus,
} from '@openverify/core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  CheckStatusBadge,
  INQUIRY_STATUS_LABELS,
  InquiryStatusBadge,
  VerificationStatusBadge,
} from './status-badge';

// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const HUMAN_LABEL = /^[A-Z][a-z]+( [a-z]+)*$/;

function badge(status: string) {
  return screen.getByText((_content, element) => element?.getAttribute('data-status') === status);
}

describe('InquiryStatusBadge', () => {
  it.each(INQUIRY_STATUSES)('has a human-readable label for %s', (status: InquiryStatus) => {
    render(<InquiryStatusBadge status={status} />);

    expect(badge(status).textContent).toMatch(HUMAN_LABEL);
  });

  it('shows an inquiry that needs review in the same tone as a verification that does (C37)', () => {
    render(<InquiryStatusBadge status="needs_review" />);

    expect(badge('needs_review')).toHaveTextContent('Needs review');
    expect(badge('needs_review')).toHaveAttribute('data-tone', 'review');
  });

  it('labels every status for the filter', () => {
    expect(Object.keys(INQUIRY_STATUS_LABELS)).toEqual([...INQUIRY_STATUSES]);
    expect(INQUIRY_STATUS_LABELS.needs_review).toBe('Needs review');
  });
});

describe('VerificationStatusBadge', () => {
  it('labels needs_review "Needs review" in a tone of its own (C30.4, C37)', () => {
    render(<VerificationStatusBadge status="needs_review" />);

    expect(badge('needs_review')).toHaveTextContent('Needs review');
    expect(badge('needs_review')).toHaveAttribute('data-tone', 'review');
  });

  it('gives no other verification status the review tone, so Needs review never looks like Requires retry', () => {
    for (const status of VERIFICATION_STATUSES.filter((value) => value !== 'needs_review')) {
      render(<VerificationStatusBadge status={status} />);

      expect(badge(status), status).not.toHaveAttribute('data-tone', 'review');
    }
  });

  it.each(VERIFICATION_STATUSES)(
    'has a human-readable label for %s',
    (status: VerificationStatus) => {
      render(<VerificationStatusBadge status={status} />);

      expect(badge(status).textContent).toMatch(HUMAN_LABEL);
    },
  );

  it('spells out a retry request', () => {
    render(<VerificationStatusBadge status="requires_retry" />);

    expect(badge('requires_retry')).toHaveTextContent('Requires retry');
  });
});

describe('CheckStatusBadge', () => {
  it.each(CHECK_STATUSES)('has a human-readable label for %s', (status: CheckStatus) => {
    render(<CheckStatusBadge status={status} />);

    expect(badge(status).textContent).toMatch(HUMAN_LABEL);
  });

  it('says a check that does not apply is not applicable', () => {
    render(<CheckStatusBadge status="not_applicable" />);

    expect(badge('not_applicable')).toHaveTextContent('Not applicable');
  });
});
