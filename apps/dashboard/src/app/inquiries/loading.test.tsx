import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import InquiryLoading from './[id]/loading';
import InquiriesLoading from './loading';

describe('inquiry loading states', () => {
  it('announces that the list is loading', () => {
    render(<InquiriesLoading />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading inquiries…');
  });

  it('announces that one inquiry is loading', () => {
    render(<InquiryLoading />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading the inquiry…');
  });
});
