import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FormField, controlClassName } from './form-field';

describe('FormField', () => {
  it('labels any control, and describes it with its help text', () => {
    render(
      <FormField label="Status" description="Archived accounts are hidden by default.">
        {(control) => (
          <select {...control} name="status" className={controlClassName(control)}>
            <option>Active</option>
          </select>
        )}
      </FormField>,
    );

    const select = screen.getByRole('combobox', { name: 'Status' });
    expect(select).toHaveAccessibleDescription('Archived accounts are hidden by default.');
    expect(select).not.toHaveAttribute('aria-invalid');
  });

  it('marks the control invalid and announces the error after the help text', () => {
    render(
      <FormField label="Note" description="At most 2,000 characters." error="The note is too long.">
        {(control) => <textarea {...control} name="note" />}
      </FormField>,
    );

    const note = screen.getByRole('textbox', { name: 'Note' });
    expect(note).toHaveAttribute('aria-invalid', 'true');
    expect(note).toHaveAccessibleDescription('At most 2,000 characters. The note is too long.');
  });

  it('marks required controls, with the asterisk hidden from screen readers', () => {
    render(
      <FormField label="Name" required>
        {(control) => <input {...control} name="name" />}
      </FormField>,
    );

    expect(screen.getByRole('textbox', { name: 'Name' })).toBeRequired();
    expect(screen.getByText('*')).toHaveAttribute('aria-hidden', 'true');
  });

  it('styles invalid controls with the danger border', () => {
    expect(controlClassName({ 'aria-invalid': true })).toContain('border-danger');
    // The control border has 3:1 or more against surface and canvas (Workflow 2D F010).
    expect(controlClassName({})).toContain('border-control');
    expect(controlClassName({})).not.toContain('border-line');
  });
});
