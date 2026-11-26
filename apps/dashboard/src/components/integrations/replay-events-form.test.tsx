import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ReplayEventsForm, type ReplayedEvents } from './replay-events-form';
import { INTEGRATION_IDS } from './testing-fixtures';

type Action = (
  state: ActionState<ReplayedEvents>,
  formData: FormData,
) => Promise<ActionResult<ReplayedEvents>>;

describe('ReplayEventsForm', () => {
  it('replays the events named by ID and says how many', async () => {
    const action = vi.fn<Action>(() => Promise.resolve({ ok: true, data: { replayedCount: 1 } }));
    render(<ReplayEventsForm webhookId={INTEGRATION_IDS.webhook} action={action} />);

    expect(screen.getByRole('radio', { name: 'By event ID' })).toBeChecked();
    expect(screen.queryByLabelText('From (UTC)')).not.toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: 'Event IDs' }), INTEGRATION_IDS.event);
    await userEvent.click(screen.getByRole('button', { name: 'Replay' }));

    expect(await screen.findByRole('status')).toHaveTextContent('1 event will be delivered again.');
    const sent = action.mock.calls[0]?.[1];
    expect(sent?.get('webhook-id')).toBe(INTEGRATION_IDS.webhook);
    expect(sent?.get('replay-by')).toBe('event-ids');
    expect(sent?.get('event-ids')).toBe(INTEGRATION_IDS.event);
  });

  it('replays a time range, optionally only failed deliveries', async () => {
    const action = vi.fn<Action>(() => Promise.resolve({ ok: true, data: { replayedCount: 12 } }));
    render(<ReplayEventsForm webhookId={INTEGRATION_IDS.webhook} action={action} />);

    await userEvent.click(screen.getByRole('radio', { name: 'By time range' }));
    expect(screen.queryByRole('textbox', { name: 'Event IDs' })).not.toBeInTheDocument();
    // user-event cannot type into datetime-local inputs.
    fireEvent.change(screen.getByLabelText('From (UTC)'), {
      target: { value: '2026-10-20T10:00' },
    });
    fireEvent.change(screen.getByLabelText('To (UTC)'), { target: { value: '2026-10-20T11:00' } });
    await userEvent.click(
      screen.getByRole('checkbox', { name: 'Only events whose delivery failed' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Replay' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      '12 events will be delivered again.',
    );
    const sent = action.mock.calls[0]?.[1];
    expect(sent?.get('replay-by')).toBe('range');
    expect(sent?.get('created-at-start')).toBe('2026-10-20T10:00');
    expect(sent?.get('created-at-end')).toBe('2026-10-20T11:00');
    expect(sent?.get('only-failed')).toBe('true');
  });

  it('says when nothing matched', async () => {
    render(
      <ReplayEventsForm
        webhookId={INTEGRATION_IDS.webhook}
        action={() => Promise.resolve({ ok: true, data: { replayedCount: 0 } })}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Replay' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'No event matched: nothing will be delivered again.',
    );
  });

  it('points at the field to correct and keeps what was typed', async () => {
    render(
      <ReplayEventsForm
        webhookId={INTEGRATION_IDS.webhook}
        action={() =>
          Promise.resolve({
            ok: false,
            problem: {
              title: 'Check the values you entered',
              errors: [{ pointer: '/meta/event-ids', detail: 'evt_nope is not an event ID.' }],
            },
          })
        }
      />,
    );
    const ids = screen.getByRole('textbox', { name: 'Event IDs' });
    await userEvent.type(ids, 'evt_nope');

    await userEvent.click(screen.getByRole('button', { name: 'Replay' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Check the values you entered');
    expect(ids).toHaveValue('evt_nope');
    expect(ids).toHaveAccessibleDescription(
      expect.stringContaining('evt_nope is not an event ID.'),
    );
  });

  it('points at the range fields too', async () => {
    render(
      <ReplayEventsForm
        webhookId={INTEGRATION_IDS.webhook}
        action={() =>
          Promise.resolve({
            ok: false,
            problem: {
              title: 'Check the values you entered',
              errors: [
                { pointer: '/meta/created-at-start', detail: 'Enter a date and time.' },
                { pointer: '/meta/created-at-end', detail: 'Choose an end after the start.' },
              ],
            },
          })
        }
      />,
    );

    await userEvent.click(screen.getByRole('radio', { name: 'By time range' }));
    await userEvent.click(screen.getByRole('button', { name: 'Replay' }));

    await screen.findByRole('alert');
    expect(screen.getByLabelText('From (UTC)')).toHaveAccessibleDescription(
      'Enter a date and time.',
    );
    expect(screen.getByLabelText('To (UTC)')).toHaveAccessibleDescription(
      'Choose an end after the start.',
    );
  });
});
