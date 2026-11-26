import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Field, Input } from './field';

describe('Field and Input', () => {
  it('associates the label with the input', () => {
    render(
      <Field label="Email">
        <Input type="email" />
      </Field>,
    );

    expect(screen.getByLabelText('Email')).toBeInstanceOf(HTMLInputElement);
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveAttribute('type', 'email');
  });

  it('gives each field its own id so several fields never collide', () => {
    render(
      <>
        <Field label="Email">
          <Input />
        </Field>
        <Field label="Password">
          <Input type="password" />
        </Field>
      </>,
    );

    expect(screen.getByLabelText('Email').id).not.toBe(screen.getByLabelText('Password').id);
  });

  it('links the description to the input as its accessible description', () => {
    render(
      <Field label="Email" description="Use your work address.">
        <Input />
      </Field>,
    );

    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription('Use your work address.');
  });

  it('marks the input invalid and describes it with the error message', () => {
    render(
      <Field label="Email" description="Use your work address." error="Enter a valid email.">
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText('Email');

    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Use your work address. Enter a valid email.');
    expect(screen.getByText('Enter a valid email.')).toBeVisible();
  });

  it('outlines the input with the control border, 3:1 or more, not the decorative line (Workflow 2D F010)', () => {
    render(
      <Field label="Name">
        <Input />
      </Field>,
    );

    const input = screen.getByRole('textbox', { name: 'Name' });
    expect(input).toHaveClass('border-control');
    expect(input).not.toHaveClass('border-line');
  });

  it('is not marked invalid when there is no error', () => {
    render(
      <Field label="Email">
        <Input />
      </Field>,
    );

    expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-describedby');
  });

  it('passes required to the input and shows a decorative marker', () => {
    render(
      <Field label="Email" required>
        <Input />
      </Field>,
    );

    expect(screen.getByRole('textbox', { name: 'Email' })).toBeRequired();
    expect(screen.getByText('*')).toHaveAttribute('aria-hidden', 'true');
  });

  it('supports disabled inputs that cannot be typed into', async () => {
    render(
      <Field label="Email">
        <Input disabled />
      </Field>,
    );
    const input = screen.getByLabelText('Email');

    await userEvent.type(input, 'abc');

    expect(input).toBeDisabled();
    expect(input).toHaveValue('');
  });

  it('works standalone and keeps caller-supplied ids and descriptions', () => {
    render(
      <>
        <p id="hint">Hint</p>
        <Input id="custom" aria-label="Search" aria-describedby="hint" invalid />
      </>,
    );
    const input = screen.getByRole('textbox', { name: 'Search' });

    expect(input).toHaveAttribute('id', 'custom');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Hint');
  });
});
