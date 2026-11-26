import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { deliveryResource } from './testing-fixtures';
import { DeliverySearch } from './delivery-search';

describe('DeliverySearch (C165.4)', () => {
  it('builds conditions by keyboard, posts them, lists the deliveries found and pages on', async () => {
    const action = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        data: { deliveries: [deliveryResource()], next: 'whd_01J9ZK3M5Q7R8S9T0V1W2X3Y63' },
      }),
    );
    render(<DeliverySearch action={action} />);

    const builder = screen.getByRole('search', { name: 'Search webhook deliveries' });
    await userEvent.selectOptions(within(builder).getByRole('combobox', { name: 'Match' }), 'any');
    await userEvent.type(
      within(builder).getByRole('textbox', { name: 'Condition 1 value' }),
      'failed',
    );
    await userEvent.click(within(builder).getByRole('button', { name: 'Add a condition' }));
    await userEvent.selectOptions(
      within(builder).getByRole('combobox', { name: 'Condition 2 attribute' }),
      'Event name',
    );
    await userEvent.selectOptions(
      within(builder).getByRole('combobox', { name: 'Condition 2 is or is not' }),
      'is not',
    );
    await userEvent.type(
      within(builder).getByRole('textbox', { name: 'Condition 2 value' }),
      'inquiry.approved',
    );
    await userEvent.click(within(builder).getByRole('button', { name: 'Search' }));

    const sent = (action.mock.calls[0] as unknown as [unknown, FormData])[1];
    expect(sent.get('combine')).toBe('or');
    expect(sent.getAll('clause-attribute')).toEqual(['status', 'event_name']);
    expect(sent.getAll('clause-negate')).toEqual(['is', 'is-not']);
    expect(sent.getAll('clause-value')).toEqual(['failed', 'inquiry.approved']);
    expect(await screen.findByRole('status')).toHaveTextContent(
      '1 delivery on this page, newest first. More match.',
    );
    expect(screen.getByRole('table', { name: 'Deliveries found' })).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect((action.mock.calls[1] as unknown as [unknown, FormData])[1].get('after')).toBe(
      'whd_01J9ZK3M5Q7R8S9T0V1W2X3Y63',
    );
  });

  it('removes a condition and offers no more than 20', async () => {
    render(<DeliverySearch action={vi.fn()} />);

    const add = screen.getByRole('button', { name: 'Add a condition' });
    for (let index = 0; index < 19; index += 1) {
      await userEvent.click(add);
    }
    expect(screen.getByRole('button', { name: 'Add a condition' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Remove condition 20' }));
    expect(screen.getByRole('button', { name: 'Add a condition' })).toBeEnabled();
  });
});
