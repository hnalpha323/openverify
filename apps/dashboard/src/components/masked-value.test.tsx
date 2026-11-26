import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { EmptyValue, MaskedValue } from './masked-value';

describe('MaskedValue', () => {
  it('says "Hidden" for a value masked because the operator lacks pii:view, with an explanation', () => {
    render(<MaskedValue value={null} masked />);

    const hidden = screen.getByText('Hidden');
    expect(hidden).toHaveAttribute('tabindex', '0');
    expect(hidden).toHaveAccessibleDescription(
      'Your role cannot see personal data (the pii:view permission).',
    );
    expect(screen.getByRole('tooltip', { hidden: true })).toHaveTextContent(
      'Your role cannot see personal data',
    );
  });

  it.each([null, undefined, ''])('shows an em dash for missing data (%j)', (value) => {
    render(<MaskedValue value={value} masked={false} />);

    expect(screen.getByText('—')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('None')).toHaveClass('sr-only');
  });

  it('shows missing data as missing, not hidden, when nothing was masked', () => {
    render(<MaskedValue value={undefined} masked />);

    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
  });

  it.each([
    ['Synthetic', 'Synthetic'],
    [42, '42'],
    [0, '0'],
    [true, 'Yes'],
    [false, 'No'],
  ] as const)('shows %j as %j', (value, text) => {
    render(<MaskedValue value={value} masked={false} />);

    expect(screen.getByText(text)).toBeVisible();
  });
});

describe('EmptyValue', () => {
  it('is an em dash for sighted users and "None" for screen readers', () => {
    const { container } = render(<EmptyValue />);

    expect(container).toHaveTextContent('—None');
  });
});

describe('the "Hidden" tooltip (Workflow 2D F009, WCAG 1.4.13)', () => {
  const tooltip = () => screen.getByRole('tooltip', { hidden: true });

  it('shows on hover and stays while the pointer moves onto the tooltip to read it', async () => {
    render(<MaskedValue value={null} masked />);
    expect(tooltip()).not.toBeVisible();

    await userEvent.hover(screen.getByText('Hidden'));
    expect(tooltip()).toBeVisible();
    await userEvent.hover(tooltip());
    expect(tooltip()).toBeVisible();

    await userEvent.unhover(tooltip());
    expect(tooltip()).not.toBeVisible();
  });

  it('shows on focus and is dismissed with Escape without moving focus', async () => {
    render(<MaskedValue value={null} masked />);

    await userEvent.tab();
    expect(screen.getByText('Hidden')).toHaveFocus();
    expect(tooltip()).toBeVisible();

    await userEvent.keyboard('{Escape}');
    expect(screen.getByText('Hidden')).toHaveFocus();
    expect(tooltip()).not.toBeVisible();

    await userEvent.tab({ shift: true });
    await userEvent.tab();
    expect(tooltip()).toBeVisible();
  });

  it('is dismissed with Escape while hovered', async () => {
    render(<MaskedValue value={null} masked />);

    await userEvent.hover(screen.getByText('Hidden'));
    await userEvent.keyboard('{Escape}');

    expect(tooltip()).not.toBeVisible();
  });
});
