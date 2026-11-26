/**
 * C172.1 (WCAG 2.1.1, 2.5.7): the layout editor operated keyboard-only first, through its buttons,
 * then with a single pointer and by dragging, each doing the same move; every move announced
 * politely; a module the author cannot see is marked before publish refuses it.
 */
import { createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../../lib/action-state';
import { later } from '../../../testing/later';
import { ToastProvider } from '../../toasts';
import { LayoutEditor } from './layout-editor';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;
const succeed: Action = () => later({ ok: true, data: undefined });

const OFFERED = [
  { key: 'timeline' as const, 'required-permissions': ['cases:read' as const] },
  { key: 'comments' as const, 'required-permissions': ['cases:read' as const] },
  { key: 'graph' as const, 'required-permissions': ['graph:read' as const] },
];
const LAYOUT = {
  columns: 2,
  modules: [
    { key: 'timeline' as const, column: 1, order: 0, collapsed: false },
    { key: 'comments' as const, column: 1, order: 1, collapsed: false },
  ],
};

function show(layout: typeof LAYOUT | null = LAYOUT, action = vi.fn(succeed)) {
  render(
    <ToastProvider>
      <LayoutEditor
        templateId="ctmpl_01JE0000000000000000000001"
        versionId="ctmplv_01JE0000000000000000000002"
        layout={layout}
        offered={OFFERED}
        held={['cases:read']}
        action={action}
      />
    </ToastProvider>,
  );
  return action;
}

const textOf = (value: FormDataEntryValue | null | undefined) =>
  typeof value === 'string' ? value : '';
const column = (n: number) => within(screen.getByRole('list', { name: `Column ${String(n)}` }));
const itemNames = (n: number) =>
  column(n)
    .queryAllByRole('listitem')
    .map((item) => item.getAttribute('aria-label'));
const savedLayout = (action: ReturnType<typeof vi.fn<Action>>) =>
  JSON.parse(textOf(action.mock.calls.at(-1)?.[1].get('layout'))) as unknown;

describe('LayoutEditor', () => {
  it('moves modules by keyboard alone, announcing each move, and saves the layout', async () => {
    const user = userEvent.setup();
    const action = show();

    expect(itemNames(1)).toEqual(['Timeline', 'Comments']);
    screen.getByRole('button', { name: 'Move Comments up' }).focus();
    await user.keyboard('{Enter}');
    expect(itemNames(1)).toEqual(['Comments', 'Timeline']);
    expect(screen.getByRole('status', { name: 'Layout changes' })).toHaveTextContent(
      'Comments moved to column 1, position 1.',
    );

    screen.getByRole('button', { name: 'Move Timeline to column 2' }).focus();
    await user.keyboard('{Enter}');
    expect(itemNames(2)).toEqual(['Timeline']);

    await user.click(screen.getByRole('checkbox', { name: 'Timeline collapsed at first' }));
    await user.click(screen.getByRole('button', { name: 'Save layout' }));

    expect(savedLayout(action)).toEqual({
      columns: 2,
      modules: [
        { key: 'comments', column: 1, order: 0, collapsed: false },
        { key: 'timeline', column: 2, order: 0, collapsed: true },
      ],
    });
  });

  it('adds a module that is not laid out, marking one whose permissions the author lacks', async () => {
    const user = userEvent.setup();
    show();

    const outside = within(screen.getByRole('list', { name: 'Not in the layout' }));
    expect(outside.getByRole('listitem', { name: 'Graph' })).toHaveTextContent(
      /needs graph:read, which you do not hold/,
    );
    await user.click(outside.getByRole('button', { name: 'Add Graph to the layout' }));

    expect(itemNames(1)).toEqual(['Timeline', 'Comments', 'Graph']);
    await user.click(screen.getByRole('button', { name: 'Remove Graph from the layout' }));
    expect(itemNames(1)).toEqual(['Timeline', 'Comments']);
  });

  it('drops a dragged module before another in a column, the same move as the buttons', () => {
    show();

    const comments = column(1).getByRole('listitem', { name: 'Comments' });
    const store = new Map<string, string>();
    const dataTransfer = {
      setData: (type: string, value: string) => store.set(type, value),
      getData: (type: string) => store.get(type) ?? '',
      effectAllowed: 'move',
      dropEffect: 'move',
    };
    fireEvent.dragStart(comments, { dataTransfer });
    const target = screen.getByRole('list', { name: 'Column 2' });
    const over = createEvent.dragOver(target, { dataTransfer });
    fireEvent(target, over);
    expect(over.defaultPrevented).toBe(true);
    fireEvent.drop(target, { dataTransfer });

    expect(itemNames(2)).toEqual(['Comments']);
  });

  it('changes the number of columns and goes back to the default layout', async () => {
    const user = userEvent.setup();
    const action = show();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Columns' }), '3');
    expect(screen.getByRole('list', { name: 'Column 3' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Use the default layout' }));
    expect(screen.getByText(/This version uses the default layout/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Save layout' }));

    expect(savedLayout(action)).toBeNull();
  });

  it('starts a layout from the default with every offered module in one column', async () => {
    const user = userEvent.setup();
    show(null);

    await user.click(screen.getByRole('button', { name: 'Lay out the modules' }));

    expect(itemNames(1)).toEqual(['Timeline', 'Comments', 'Graph']);
  });
});

describe('LayoutEditor and label in name (WCAG 2.5.3)', () => {
  it('shows each control’s whole name as its visible text, so a spoken command matches it', () => {
    show();

    const controls = [
      ...screen.getAllByRole('button'),
      ...screen.getAllByRole('checkbox').map((box) => box.closest('label')),
    ];
    for (const control of controls) {
      expect(control).not.toBeNull();
      expect(control?.getAttribute('aria-label')).toBeNull();
    }
    expect(screen.getByRole('button', { name: 'Move Comments up' })).toHaveTextContent(
      'Move Comments up',
    );
    expect(screen.getByRole('checkbox', { name: 'Timeline collapsed at first' })).toBeVisible();
  });
});
