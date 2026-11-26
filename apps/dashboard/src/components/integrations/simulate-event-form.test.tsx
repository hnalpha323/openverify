import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { SimulateEventForm, type SimulatedEvent } from './simulate-event-form';
import { INTEGRATION_IDS } from './testing-fixtures';

type Action = (
  state: ActionState<SimulatedEvent>,
  formData: FormData,
) => Promise<ActionResult<SimulatedEvent>>;

const GROUPS = [
  { label: 'Inquiry', names: ['inquiry.created', 'inquiry.approved'] },
  { label: 'Account', names: ['account.created'] },
];

describe('SimulateEventForm', () => {
  it('sends a sample event of the chosen name and names it', async () => {
    const action = vi.fn<Action>(() =>
      Promise.resolve({ ok: true, data: { eventId: INTEGRATION_IDS.event } }),
    );
    render(
      <SimulateEventForm
        webhookId={INTEGRATION_IDS.webhook}
        groups={GROUPS}
        action={action}
        canSeeEvents
      />,
    );

    const select = screen.getByRole('combobox', { name: 'Event' });
    expect(within(select).getByRole('group', { name: 'Account' })).toBeInTheDocument();
    await userEvent.selectOptions(select, 'inquiry.approved');
    await userEvent.click(screen.getByRole('button', { name: 'Send test event' }));

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(
      `Test event ${INTEGRATION_IDS.event} sent. Its delivery appears in the list below.`,
    );
    expect(within(status).getByRole('link', { name: INTEGRATION_IDS.event })).toHaveAttribute(
      'href',
      `/events/${INTEGRATION_IDS.event}`,
    );
    const sent = action.mock.calls[0]?.[1];
    expect(sent?.get('webhook-id')).toBe(INTEGRATION_IDS.webhook);
    expect(sent?.get('event-name')).toBe('inquiry.approved');
    expect(select).toHaveValue('inquiry.approved');
  });

  it('names the event without a link for an operator who cannot read events', async () => {
    render(
      <SimulateEventForm
        webhookId={INTEGRATION_IDS.webhook}
        groups={GROUPS}
        action={() => Promise.resolve({ ok: true, data: { eventId: INTEGRATION_IDS.event } })}
        canSeeEvents={false}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Send test event' }));

    expect(await screen.findByRole('status')).toHaveTextContent(INTEGRATION_IDS.event);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows the problem when the webhook cannot receive it', async () => {
    render(
      <SimulateEventForm
        webhookId={INTEGRATION_IDS.webhook}
        groups={GROUPS}
        action={() =>
          Promise.resolve({
            ok: false,
            problem: { title: 'Invalid Transition', detail: 'Enable it before sending it events.' },
          })
        }
        canSeeEvents
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Send test event' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Enable it before sending it events.',
    );
  });
});
