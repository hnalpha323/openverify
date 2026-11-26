import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './button';

describe('Button', () => {
  it('exposes its text as the accessible name of a button', () => {
    render(<Button>Continue</Button>);

    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
  });

  it('defaults to type="button" so it never submits a form by accident', () => {
    render(<Button>Cancel</Button>);

    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveAttribute('type', 'button');
  });

  it('can still be a submit button', () => {
    render(<Button type="submit">Sign in</Button>);

    expect(screen.getByRole('button', { name: 'Sign in' })).toHaveAttribute('type', 'submit');
  });

  it('calls onClick when pressed', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Continue</Button>);

    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is disabled and ignores presses when disabled', async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Continue
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Continue' });

    await userEvent.click(button);

    expect(button).toBeDisabled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('marks its variant, defaulting to primary', () => {
    render(
      <>
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="danger">Danger</Button>
      </>,
    );

    expect(screen.getByRole('button', { name: 'Primary' })).toHaveAttribute(
      'data-variant',
      'primary',
    );
    expect(screen.getByRole('button', { name: 'Secondary' })).toHaveAttribute(
      'data-variant',
      'secondary',
    );
    expect(screen.getByRole('button', { name: 'Danger' })).toHaveAttribute(
      'data-variant',
      'danger',
    );
  });

  it('keeps caller classes and forwards the ref to the DOM button', () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <Button ref={ref} className="w-full">
        Continue
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Continue' });

    expect(button).toHaveClass('w-full');
    expect(ref.current).toBe(button);
  });
});
