import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import InquiriesError from './error';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('inquiries error boundary', () => {
  it('explains the failure without internals and offers a retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const retry = vi.fn();
    const error = Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:3000'), {
      digest: 'synthetic-digest-1',
    });

    render(<InquiriesError error={error} retry={retry} />);

    expect(screen.getByRole('alert')).toHaveTextContent('The inquiries could not be loaded.');
    expect(screen.getByText('synthetic-digest-1')).toBeVisible();
    expect(screen.queryByText(/ECONNREFUSED/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('copes with a thrown value that is not an Error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(<InquiriesError error="synthetic failure" retry={vi.fn()} />);

    expect(screen.getByRole('alert')).toBeVisible();
    expect(screen.queryByText(/Reference/)).not.toBeInTheDocument();
  });
});
