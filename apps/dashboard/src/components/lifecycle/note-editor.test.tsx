import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { later } from '../../testing/later';
import { ToastProvider } from '../toasts';
import { NoteEditor, type NoteEditorProps } from './note-editor';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

const ID = 'inq_01JB0000000000000000000001';

function renderNote(props: Partial<NoteEditorProps> = {}) {
  const action = vi.fn<Action>(() => Promise.resolve({ ok: true, data: undefined }));
  render(
    <ToastProvider>
      <NoteEditor
        inquiryId={ID}
        note="Checked by phone."
        state="visible"
        canEdit
        action={action}
        {...props}
      />
    </ToastProvider>,
  );
  return action;
}

describe('NoteEditor', () => {
  it('shows the note', () => {
    renderNote({ canEdit: false });

    expect(screen.getByText('Checked by phone.')).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows a missing note as missing', () => {
    renderNote({ note: null, canEdit: false });

    expect(screen.getByText('None')).toBeInTheDocument();
  });

  it('shows a masked note as "Hidden"', () => {
    renderNote({ note: null, state: 'hidden', canEdit: false });

    expect(screen.getByText('Hidden')).toBeVisible();
  });

  it('shows a redacted note as "Redacted"', () => {
    renderNote({ note: null, state: 'redacted', canEdit: false });

    expect(screen.getByText('Redacted')).toBeVisible();
  });

  it('edits and saves the note', async () => {
    const action = renderNote();

    await userEvent.click(screen.getByRole('button', { name: 'Edit note' }));
    const text = screen.getByRole('textbox', { name: 'Note' });
    expect(text).toHaveValue('Checked by phone.');
    expect(text).toHaveAttribute('maxLength', '2000');
    await userEvent.type(text, ' Approved.');
    await userEvent.click(screen.getByRole('button', { name: 'Save note' }));

    const sent = action.mock.calls[0]?.[1];
    expect(sent?.get('inquiry-id')).toBe(ID);
    expect(sent?.get('note')).toBe('Checked by phone. Approved.');
    expect(await screen.findByRole('status')).toHaveTextContent('Saved the note.');
    expect(screen.queryByRole('textbox', { name: 'Note' })).not.toBeInTheDocument();
  });

  it('cancels an edit', async () => {
    const action = renderNote();
    await userEvent.click(screen.getByRole('button', { name: 'Edit note' }));

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('textbox', { name: 'Note' })).not.toBeInTheDocument();
    expect(action).not.toHaveBeenCalled();
  });

  it('moves focus into the note when editing starts, and back to Edit note on Cancel (WCAG 2.4.3, Workflow 2E F012)', async () => {
    renderNote();

    await userEvent.click(screen.getByRole('button', { name: 'Edit note' }));
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveFocus();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Edit note' })).toHaveFocus();
  });

  it('returns focus to Edit note once the note is saved (WCAG 2.4.3, Workflow 2E F012)', async () => {
    const action = renderNote();
    action.mockImplementationOnce(() => later<ActionResult>({ ok: true, data: undefined }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit note' }));

    await userEvent.click(screen.getByRole('button', { name: 'Save note' }));

    expect(await screen.findByRole('button', { name: 'Edit note' })).toHaveFocus();
  });

  it('has focus on Edit note when the button appears after a save, never on the page (WCAG 2.4.3)', async () => {
    const action = renderNote();
    action.mockImplementationOnce(() => later<ActionResult>({ ok: true, data: undefined }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit note' }));
    // A mutation observer runs right after the commit that inserts the button, before React's
    // passive effects, so it sees focus where the browser has it at that moment.
    let focusedWhenShown: boolean | undefined;
    const observer = new MutationObserver(() => {
      const edit = screen.queryByRole('button', { name: 'Edit note' });
      if (edit !== null && focusedWhenShown === undefined) {
        focusedWhenShown = edit === document.activeElement;
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    await userEvent.click(screen.getByRole('button', { name: 'Save note' }));
    await screen.findByRole('button', { name: 'Edit note' });
    observer.disconnect();

    expect(focusedWhenShown).toBe(true);
  });

  it('keeps the editor open with the problem when saving fails', async () => {
    const action = renderNote();
    // Answered after a macrotask, as a server action is (Workflow 2D F019).
    action.mockImplementationOnce(() =>
      later<ActionResult>({
        ok: false,
        problem: {
          title: 'Check the values you entered',
          errors: [{ pointer: '/data/attributes/note', detail: 'is too long' }],
        },
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Edit note' }));

    await userEvent.click(screen.getByRole('button', { name: 'Save note' }));

    // Waits until the answer gives the field its error, not just for the field.
    expect(
      await screen.findByRole('textbox', { name: 'Note', description: /is too long/ }),
    ).toHaveAttribute('aria-invalid', 'true');
  });
});
