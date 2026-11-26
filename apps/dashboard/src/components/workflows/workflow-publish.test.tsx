import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ToastProvider } from '../toasts';
import { PublishDraftButton } from './workflow-publish';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;
const WORKFLOW = 'wfl_01MB0000000000000000000001';

describe('PublishDraftButton (C116.4, C141.5)', () => {
  it('asks for each acknowledgement the API names, with its reason, and sends the ticked ones', async () => {
    const action = vi
      .fn<Action>()
      .mockResolvedValueOnce({
        ok: false,
        problem: {
          title: 'Acknowledge before publishing',
          code: 'publish_acknowledgement_missing',
          errors: [
            { pointer: '/meta/acknowledgements', detail: 'egress:send_slack' },
            { pointer: '/meta/acknowledgements', detail: 'irreversible:redact_inquiry' },
          ],
        },
      })
      .mockResolvedValueOnce({ ok: true, data: undefined });
    render(
      <ToastProvider>
        <PublishDraftButton workflowId={WORKFLOW} action={action} />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Publish the draft' }));
    const dialog = screen.getByRole('dialog', { name: 'Publish the draft' });
    await userEvent.type(within(dialog).getByRole('spinbutton', { name: /Rollout/ }), '100');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Publish' }));

    const egress = await within(dialog).findByRole('checkbox', {
      name: /Personal data leaves OpenVerify in this step \(send_slack\)/,
    });
    const irreversible = within(dialog).getByRole('checkbox', {
      name: /This step redacts objects, which cannot be undone \(redact_inquiry\)/,
    });
    expect(egress).not.toBeChecked();
    await userEvent.click(egress);
    await userEvent.click(irreversible);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Publish' }));

    const sent = action.mock.calls[1]?.[1];
    expect(sent?.getAll('acknowledgement')).toEqual([
      'egress:send_slack',
      'irreversible:redact_inquiry',
    ]);
    expect(sent?.get('workflow-id')).toBe(WORKFLOW);
    expect(await screen.findByText('The draft was published.')).toBeVisible();
  });
});
