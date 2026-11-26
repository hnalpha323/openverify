import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Checkbox } from './checkbox';

describe('Checkbox', () => {
  it('is a checkbox named by its label', () => {
    render(<Checkbox label="I agree" />);

    expect(screen.getByRole('checkbox', { name: 'I agree' })).not.toBeChecked();
  });

  it('toggles when its label is clicked', async () => {
    render(<Checkbox label="I agree" />);

    await userEvent.click(screen.getByText('I agree'));

    expect(screen.getByRole('checkbox', { name: 'I agree' })).toBeChecked();
  });

  // WCAG 2.5.8 (C171.3; Workflow 9D, a11y-audit): the box itself is 24 by 24 CSS px, as the flow's
  // screen components draw theirs, so it needs no spacing exception. jsdom lays nothing out, so the
  // size is read from Tailwind's class; the flow's `wcag-steps.spec.ts` measures it in Chromium.
  it('draws its box at 24 by 24 CSS px (2.5.8)', () => {
    render(<Checkbox label="I agree" />);

    const box = screen.getByRole('checkbox', { name: 'I agree' });
    expect(box).toHaveClass('size-6');
    expect(box).not.toHaveClass('size-5');
  });

  it('can be required', () => {
    render(<Checkbox label="I agree" required />);

    expect(screen.getByRole('checkbox', { name: 'I agree' })).toBeRequired();
  });

  it('links an optional description', () => {
    render(<Checkbox label="I agree" description="You can withdraw at any time." />);

    expect(screen.getByRole('checkbox', { name: 'I agree' })).toHaveAccessibleDescription(
      'You can withdraw at any time.',
    );
  });

  it('cannot be toggled when disabled', async () => {
    render(<Checkbox label="I agree" disabled />);
    const checkbox = screen.getByRole('checkbox', { name: 'I agree' });

    await userEvent.click(checkbox);

    expect(checkbox).toBeDisabled();
    expect(checkbox).not.toBeChecked();
  });
});
