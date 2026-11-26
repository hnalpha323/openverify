/**
 * C142.3, 2.1.4 (editor note 7.6): the case page's chords are Alt+Shift with a letter, never a
 * character key alone; they can be switched off, and the choice is kept in this browser only; every
 * shortcut is listed in a dialog and named on its target with `aria-keyshortcuts`. No decision has a
 * shortcut.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CaseShortcuts, PAGE_SHORTCUTS_KEY } from './case-shortcuts';

function Page() {
  return (
    <>
      <CaseShortcuts />
      <textarea aria-label="New comment" data-shortcut-target="comment" />
      <div tabIndex={-1} aria-label="Compare panel" data-shortcut-target="compare" />
      <ol tabIndex={-1} aria-label="Case timeline" data-shortcut-target="timeline" />
      <button type="button">Approve</button>
    </>
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('CaseShortcuts', () => {
  it('moves focus with Alt+Shift chords, and names each on its target', async () => {
    const user = userEvent.setup();
    render(<Page />);

    await user.keyboard('{Alt>}{Shift>}C{/Shift}{/Alt}');
    expect(screen.getByRole('textbox', { name: 'New comment' })).toHaveFocus();
    await user.keyboard('{Alt>}{Shift>}V{/Shift}{/Alt}');
    expect(screen.getByLabelText('Compare panel')).toHaveFocus();
    await user.keyboard('{Alt>}{Shift>}T{/Shift}{/Alt}');
    expect(screen.getByRole('list', { name: 'Case timeline' })).toHaveFocus();

    expect(screen.getByRole('textbox', { name: 'New comment' })).toHaveAttribute(
      'aria-keyshortcuts',
      'Alt+Shift+C',
    );
    expect(screen.getByRole('button', { name: 'Approve' })).not.toHaveAttribute(
      'aria-keyshortcuts',
    );
  });

  it('does nothing for a letter alone, or for a chord it does not define', async () => {
    const user = userEvent.setup();
    render(<Page />);
    const approve = screen.getByRole('button', { name: 'Approve' });
    approve.focus();

    await user.keyboard('c{Alt>}{Shift>}A{/Shift}{/Alt}');

    expect(approve).toHaveFocus();
  });

  it('lists every shortcut in a dialog, where the page chords are switched off and stay off', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Page />);

    await user.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(dialog).toHaveTextContent('Alt+Shift+C');
    expect(dialog).toHaveTextContent('+, -, 0, the arrows and R');
    expect(dialog).toHaveTextContent('No decision has a shortcut');
    const toggle = within(dialog).getByRole('checkbox', { name: 'Use the page shortcuts' });
    expect(toggle).toBeChecked();
    await user.click(toggle);
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));

    const comment = screen.getByRole('textbox', { name: 'New comment' });
    await user.keyboard('{Alt>}{Shift>}C{/Shift}{/Alt}');
    expect(comment).not.toHaveFocus();
    expect(comment).not.toHaveAttribute('aria-keyshortcuts');
    expect(window.localStorage.getItem(PAGE_SHORTCUTS_KEY)).toBe('off');

    unmount();
    render(<Page />);
    await user.keyboard('{Alt>}{Shift>}C{/Shift}{/Alt}');
    expect(screen.getByRole('textbox', { name: 'New comment' })).not.toHaveFocus();
  });

  it('keeps working when the browser refuses its storage', async () => {
    const user = userEvent.setup();
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('storage blocked');
      },
    });
    try {
      render(<Page />);
      await user.keyboard('{Alt>}{Shift>}C{/Shift}{/Alt}');
      expect(screen.getByRole('textbox', { name: 'New comment' })).toHaveFocus();
    } finally {
      if (original !== undefined) Object.defineProperty(window, 'localStorage', original);
    }
  });
});
