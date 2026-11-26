import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { EventPicker } from './event-picker';

const GROUPS = [
  { label: 'Inquiry', names: ['inquiry.created', 'inquiry.approved'] },
  { label: 'Account', names: ['account.created'] },
];

function formValues(): string[] {
  const form = screen.getByRole('group', { name: 'Events' }).closest('form');
  if (form === null) {
    throw new Error('No form');
  }
  return new FormData(form).getAll('enabled-events') as string[];
}

describe('EventPicker', () => {
  it('offers every event by group, and all events at once', () => {
    render(
      <form>
        <EventPicker groups={GROUPS} defaultValue={['inquiry.approved']} />
      </form>,
    );

    const picker = screen.getByRole('group', { name: 'Events' });
    expect(within(picker).getByRole('checkbox', { name: 'All events' })).not.toBeChecked();
    const inquiry = within(picker).getByRole('group', { name: 'Inquiry' });
    expect(within(inquiry).getByRole('checkbox', { name: 'inquiry.approved' })).toBeChecked();
    expect(within(inquiry).getByRole('checkbox', { name: 'inquiry.created' })).not.toBeChecked();
    expect(within(picker).getByRole('group', { name: 'Account' })).toBeVisible();
    expect(formValues()).toEqual(['inquiry.approved']);
  });

  it('sends only "all events" once it is chosen', async () => {
    render(
      <form>
        <EventPicker groups={GROUPS} defaultValue={['inquiry.approved']} />
      </form>,
    );

    await userEvent.click(screen.getByRole('checkbox', { name: 'All events' }));

    expect(screen.getByRole('checkbox', { name: 'inquiry.approved' })).toBeDisabled();
    expect(formValues()).toEqual(['*']);

    await userEvent.click(screen.getByRole('checkbox', { name: 'All events' }));

    expect(screen.getByRole('checkbox', { name: 'inquiry.approved' })).toBeEnabled();
    expect(formValues()).toEqual(['inquiry.approved']);
  });

  it('starts with all events for a webhook that has them, and shows an error', () => {
    render(
      <form>
        <EventPicker groups={GROUPS} defaultValue={['*']} error="Choose at least one event." />
      </form>,
    );

    expect(screen.getByRole('checkbox', { name: 'All events' })).toBeChecked();
    expect(screen.getByRole('group', { name: 'Events' })).toHaveAccessibleDescription(
      'Choose at least one event.',
    );
  });
});
