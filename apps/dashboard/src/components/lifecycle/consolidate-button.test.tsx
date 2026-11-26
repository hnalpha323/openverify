import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ToastProvider } from '../toasts';
import { ConsolidateButton } from './consolidate-button';
import { LIFECYCLE_IDS as IDS } from '../../testing/lifecycle-fixtures';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

describe('ConsolidateButton', () => {
  it('asks for the source accounts, explains what moves, and consolidates on confirmation', async () => {
    const action = vi.fn<Action>(() => Promise.resolve({ ok: true, data: undefined }));
    render(
      <ToastProvider>
        <ConsolidateButton accountId={IDS.account} action={action} />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Consolidate' }));
    const dialog = screen.getByRole('dialog', { name: 'Consolidate accounts into this one?' });
    expect(dialog).toHaveTextContent('archived');
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Source account IDs' }),
      `${IDS.otherAccount}, ${IDS.thirdAccount}`,
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Consolidate accounts' }));

    expect(await screen.findByRole('status')).toHaveTextContent('The accounts were consolidated.');
    const sent = action.mock.calls[0]?.[1];
    expect(sent?.get('account-id')).toBe(IDS.account);
    expect(sent?.get('source-account-ids')).toBe(`${IDS.otherAccount}, ${IDS.thirdAccount}`);
  });
});
