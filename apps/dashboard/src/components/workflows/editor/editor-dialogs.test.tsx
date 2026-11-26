import { WORKFLOW_TRIGGER_TYPES } from '@openverify/contracts';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConnectDialog, DeleteDialog, TriggerDialog } from './editor-dialogs';

describe('TriggerDialog (C118, C141.2)', () => {
  it('offers every trigger type in words, the current one chosen, and sets the one chosen', async () => {
    const onSet = vi.fn();
    render(<TriggerDialog open current="trigger-api" onClose={vi.fn()} onSet={onSet} />);
    const dialog = screen.getByRole('dialog', { name: 'Set the trigger' });
    expect(within(dialog).getAllByRole('radio')).toHaveLength(WORKFLOW_TRIGGER_TYPES.length);
    expect(within(dialog).getByRole('radio', { name: 'The API' })).toBeChecked();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'An event' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Set trigger' }));
    expect(onSet).toHaveBeenCalledWith('trigger-event');
  });

  it('starts with the first type chosen when there is no trigger yet', () => {
    render(<TriggerDialog open current={null} onClose={vi.fn()} onSet={vi.fn()} />);
    expect(screen.getAllByRole('radio')[0]).toBeChecked();
  });
});

describe('ConnectDialog (C141.2)', () => {
  const ports = [
    {
      port: 'next',
      label: 'Next',
      current: 'output',
      targets: [
        { id: 'wait', label: 'Wait: Wait for a time' },
        { id: 'output', label: 'Output: Output' },
      ],
    },
    { port: 'error', label: 'On error', current: null, targets: [] },
  ];

  it('lists only the targets the port rules accept, marks where it leads now, and connects', async () => {
    const onConnect = vi.fn();
    render(
      <ConnectDialog
        open
        source="Action calculate: first"
        ports={ports}
        onClose={vi.fn()}
        onConnect={onConnect}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Connect a path' });
    expect(within(dialog).getByText('From Action calculate: first.')).toBeVisible();
    expect(within(dialog).getByRole('combobox', { name: 'Path' })).toHaveValue('next');
    expect(
      within(dialog).getByRole('radio', { name: 'Output: Output (leads here now)' }),
    ).toBeChecked();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Wait: Wait for a time' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Connect' }));
    expect(onConnect).toHaveBeenCalledWith('next', 'wait');
  });

  it('says when a path has no step it may lead to', async () => {
    render(
      <ConnectDialog
        open
        source="Action calculate: first"
        ports={ports}
        onClose={vi.fn()}
        onConnect={vi.fn()}
      />,
    );
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Path' }), 'error');
    expect(
      screen.getByText(
        'No step can follow this path: every other step would make a cycle or is the start.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
  });
});

describe('DeleteDialog (C141.2)', () => {
  it('confirms a delete and says what it leaves behind', async () => {
    const onDelete = vi.fn();
    const onClose = vi.fn();
    render(
      <DeleteDialog
        open
        step="Parallel: Parallel"
        consequence="Its join goes with it; the steps of its branches stay, not connected."
        onClose={onClose}
        onDelete={onDelete}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Delete Parallel: Parallel?' });
    expect(
      within(dialog).getByText(
        'Its join goes with it; the steps of its branches stay, not connected.',
      ),
    ).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalled();
  });
});
