import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EditMenu } from './edit-menu';

const items = [
  { id: 'add', label: 'Add a step after…', disabled: null },
  { id: 'up', label: 'Move up', disabled: 'It is the first step of its path.' },
  { id: 'delete', label: 'Delete…', disabled: null },
];

const show = () => {
  const onPick = vi.fn();
  const onClose = vi.fn();
  render(
    <EditMenu
      label="Actions for Action calculate: first"
      items={items}
      onPick={onPick}
      onClose={onClose}
    />,
  );
  return {
    onPick,
    onClose,
    menu: screen.getByRole('menu', { name: 'Actions for Action calculate: first' }),
  };
};

describe('EditMenu (C141.2, the APG menu pattern)', () => {
  it('moves focus to its first item, and walks its items with the arrows, Home and End', async () => {
    show();
    expect(screen.getByRole('menuitem', { name: 'Add a step after…' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: /Move up/ })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Add a step after…' })).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(screen.getByRole('menuitem', { name: 'Delete…' })).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(screen.getByRole('menuitem', { name: 'Add a step after…' })).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('menuitem', { name: 'Delete…' })).toHaveFocus();
  });

  it('picks an item with Enter or a click, and never a disabled one, which says why', async () => {
    const { onPick } = show();
    await userEvent.keyboard('{Enter}');
    expect(onPick).toHaveBeenLastCalledWith('add');
    const up = screen.getByRole('menuitem', { name: /Move up/ });
    expect(up).toHaveAttribute('aria-disabled', 'true');
    expect(up).toHaveAccessibleDescription('It is the first step of its path.');
    await userEvent.click(up);
    expect(onPick).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete…' }));
    expect(onPick).toHaveBeenLastCalledWith('delete');
  });

  it('closes on Escape and on Tab', async () => {
    const { onClose } = show();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.tab();
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
