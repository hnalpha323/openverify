/** The create form's "Start from a template" (C128.5): a template only ever makes a draft. */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CreateWorkflowForm } from './create-workflow-form';

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const ENV = 'env_01J9ZK3M5Q7R8S9T0V1W2X3Y51';

describe('CreateWorkflowForm: start from a decision template (C128.5)', () => {
  it('offers an empty draft or each review-first template, asking for the basis and route only with a template', async () => {
    const user = userEvent.setup();
    render(<CreateWorkflowForm environmentId={ENV} action={vi.fn()} />);

    const form = screen.getByRole('form', { name: 'Create a workflow' });
    const start = within(form).getByRole('combobox', { name: 'Start from a template' });
    expect(
      within(start)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([
      'An empty draft',
      'Review a completed inquiry, then decide from the case',
      'Review a failed inquiry, then decline only from the case',
      'Review a report match, then decide from the case',
    ]);
    expect(within(form).queryByRole('combobox', { name: 'Decision basis' })).toBeNull();

    await user.selectOptions(start, 'review-completed-inquiry');

    expect(within(form).getByRole('combobox', { name: 'Decision basis' })).toBeVisible();
    expect(within(form).getByRole('textbox', { name: /Contest route URL/ })).toBeVisible();
    expect(within(form).getByRole('textbox', { name: /Contest route contact/ })).toBeVisible();
    expect(within(form).getByRole('textbox', { name: /Case template id/ })).toBeVisible();
    expect(form).toHaveTextContent(/makes a draft; nothing is published/);
  });
});
