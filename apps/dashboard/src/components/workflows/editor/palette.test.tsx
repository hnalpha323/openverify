import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PaletteDialog } from './palette';
import { paletteOf, type CatalogueAction } from './palette-model';

const action = (key: string, more: Partial<CatalogueAction> = {}): CatalogueAction => ({
  key,
  version: 1,
  kind: 'internal',
  stage: 'ga',
  delivery: 'exactly-once',
  adverse: 'never',
  triggers: null,
  available: true,
  reason: null,
  ...more,
});

const entries = paletteOf(
  [
    action('send_email', { kind: 'egress', available: false, reason: 'provider_not_configured' }),
    action('run_report', { stage: 'beta' }),
    action('add_face_list_item', { triggers: ['trigger-event'] }),
  ],
  'trigger-api',
);

const show = () => {
  const onAdd = vi.fn();
  const onClose = vi.fn();
  render(
    <PaletteDialog
      open
      place="after Trigger: The API"
      entries={entries}
      onClose={onClose}
      onAdd={onAdd}
    />,
  );
  return { onAdd, onClose, dialog: screen.getByRole('dialog', { name: 'Add a step' }) };
};

describe('PaletteDialog (C141.4)', () => {
  it('groups the step types and the actions, and says where the step goes', () => {
    const { dialog } = show();
    expect(within(dialog).getByText('Adds it after Trigger: The API.')).toBeVisible();
    const steps = within(dialog).getByRole('group', { name: 'Steps' });
    expect(within(steps).getAllByRole('radio')).toHaveLength(8);
    const actions = within(dialog).getByRole('group', { name: 'Actions' });
    expect(within(actions).getByRole('radio', { name: /Send email/ })).toBeEnabled();
    expect(
      within(actions).getByText('Not configured: no provider is bound for it in this environment.'),
    ).toBeVisible();
    expect(within(actions).getByText('Beta')).toBeVisible();
    expect(within(actions).getByRole('radio', { name: /Add face list item/ })).toBeDisabled();
    expect(
      within(actions).getByText('Does not serve the trigger The API, so it cannot be added here.'),
    ).toBeVisible();
  });

  it('adds the chosen entry by keyboard, the first one chosen to begin with', async () => {
    const { onAdd, dialog } = show();
    expect(within(dialog).getByRole('radio', { name: /Wait for a time/ })).toBeChecked();
    await userEvent.click(within(dialog).getByRole('radio', { name: /Conditional/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add step' }));
    expect(onAdd).toHaveBeenCalledWith({ kind: 'conditional' }, 'Conditional');
  });

  it('narrows the list by what is typed in the filter, matching the label or the key', async () => {
    const { dialog } = show();
    await userEvent.type(within(dialog).getByRole('searchbox', { name: 'Filter' }), 'report');
    expect(within(dialog).getAllByRole('radio')).toHaveLength(1);
    expect(within(dialog).getByRole('radio', { name: /Run report/ })).toBeChecked();
    await userEvent.clear(within(dialog).getByRole('searchbox', { name: 'Filter' }));
    await userEvent.type(
      within(dialog).getByRole('searchbox', { name: 'Filter' }),
      'nothing like it',
    );
    expect(within(dialog).queryAllByRole('radio')).toHaveLength(0);
    expect(within(dialog).getByText('Nothing matches the filter.')).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Add step' })).toBeDisabled();
  });

  it('closes without adding on Cancel', async () => {
    const { onAdd, onClose, dialog } = show();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(onAdd).not.toHaveBeenCalled();
  });
});
