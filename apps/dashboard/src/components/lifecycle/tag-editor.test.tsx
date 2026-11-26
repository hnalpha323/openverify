import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { later } from '../../testing/later';
import { ToastProvider } from '../toasts';
import { TagEditor } from './tag-editor';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

const ID = 'inq_01JB0000000000000000000001';
const ok = () => vi.fn<Action>(() => Promise.resolve({ ok: true, data: undefined }));

function renderEditor(canEdit = true, tags: readonly string[] = ['vip', 'manual review']) {
  const actions = { addTag: ok(), removeTag: ok(), setTags: ok() };
  render(
    <ToastProvider>
      <TagEditor tags={tags} fields={{ 'inquiry-id': ID }} canEdit={canEdit} {...actions} />
    </ToastProvider>,
  );
  return actions;
}

describe('TagEditor', () => {
  it('lists the tags, read-only without the write permission', () => {
    renderEditor(false);

    const list = screen.getByRole('list', { name: 'Tags' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['vip', 'manual review']);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('says when there are no tags', () => {
    renderEditor(false, []);

    expect(screen.getByText('No tags.')).toBeVisible();
  });

  it('removes one tag', async () => {
    const { removeTag } = renderEditor();

    await userEvent.click(screen.getByRole('button', { name: 'Remove tag manual review' }));

    const sent = removeTag.mock.calls[0]?.[1];
    expect(sent?.get('inquiry-id')).toBe(ID);
    expect(sent?.get('tag-name')).toBe('manual review');
    expect(await screen.findByRole('status')).toHaveTextContent('Removed the tag manual review.');
  });

  it('adds a tag', async () => {
    const { addTag } = renderEditor();

    await userEvent.type(screen.getByRole('textbox', { name: 'New tag' }), 'fraud:suspected');
    await userEvent.click(screen.getByRole('button', { name: 'Add tag' }));

    const sent = addTag.mock.calls[0]?.[1];
    expect(sent?.get('inquiry-id')).toBe(ID);
    expect(sent?.get('tag-name')).toBe('fraud:suspected');
    expect(await screen.findByRole('status')).toHaveTextContent('Added the tag.');
  });

  it('shows why a tag was refused next to the field', async () => {
    const actions = { addTag: ok(), removeTag: ok(), setTags: ok() };
    // Answered after a macrotask, as a server action is (Workflow 2D F019).
    actions.addTag.mockImplementationOnce(() =>
      later<ActionResult>({
        ok: false,
        problem: {
          title: 'Check the values you entered',
          errors: [{ pointer: '/meta/tag-name', detail: 'must be 1 to 64 letters' }],
        },
      }),
    );
    render(
      <ToastProvider>
        <TagEditor tags={[]} fields={{ 'inquiry-id': ID }} canEdit {...actions} />
      </ToastProvider>,
    );

    await userEvent.type(screen.getByRole('textbox', { name: 'New tag' }), '<b>');
    await userEvent.click(screen.getByRole('button', { name: 'Add tag' }));

    // Waits until the answer gives the field its error, not just for the field.
    expect(
      await screen.findByRole('textbox', {
        name: 'New tag',
        description: 'must be 1 to 64 letters',
      }),
    ).toHaveAttribute('aria-invalid', 'true');
  });

  it('replaces every tag from a list, one per line', async () => {
    const { setTags } = renderEditor();

    await userEvent.click(screen.getByRole('button', { name: 'Edit all tags' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit all tags' });
    const text = within(dialog).getByRole('textbox', { name: 'Tags, one per line' });
    expect(text).toHaveValue('vip\nmanual review');
    await userEvent.clear(text);
    await userEvent.type(text, 'gold{Enter}checked');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save tags' }));

    expect(setTags.mock.calls[0]?.[1].get('tag-names')).toBe('gold\nchecked');
    expect(await screen.findByRole('status')).toHaveTextContent('Saved the tags.');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('says why a tag could not be removed', async () => {
    const actions = { addTag: ok(), removeTag: ok(), setTags: ok() };
    actions.removeTag.mockResolvedValueOnce({
      ok: false,
      problem: { title: 'Conflict', detail: 'The inquiry changed.' },
    });
    render(
      <ToastProvider>
        <TagEditor tags={['vip']} fields={{ 'inquiry-id': ID }} canEdit {...actions} />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Remove tag vip' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Conflict: The inquiry changed.');
  });

  it('shows a refusal that is about no field below the form', async () => {
    const actions = { addTag: ok(), removeTag: ok(), setTags: ok() };
    actions.addTag.mockResolvedValueOnce({ ok: false, problem: { title: 'Gone' } });
    render(
      <ToastProvider>
        <TagEditor tags={[]} fields={{ 'inquiry-id': ID }} canEdit {...actions} />
      </ToastProvider>,
    );

    await userEvent.type(screen.getByRole('textbox', { name: 'New tag' }), 'vip');
    await userEvent.click(screen.getByRole('button', { name: 'Add tag' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Gone');
  });

  it('keeps the list dialog open with the problem when replacing fails, and cancels', async () => {
    const actions = renderEditor();
    actions.setTags.mockResolvedValueOnce({
      ok: false,
      problem: { title: 'Check the values you entered', detail: 'At most 50 tags.' },
    });

    await userEvent.click(screen.getByRole('button', { name: 'Edit all tags' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save tags' }));

    const dialog = screen.getByRole('dialog', { name: 'Edit all tags' });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('At most 50 tags.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
