/** C172.2, C172.4: the draft's checklists and preset comments as JSON, each error at its pointer. */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../../lib/action-state';
import { later } from '../../../testing/later';
import { ToastProvider } from '../../toasts';
import { ChecklistsEditor } from './checklists-editor';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

const CHECKLISTS = [
  {
    key: 'kyc',
    label: 'Identity review',
    items: [{ key: 'id-seen', label: 'Document seen', 'required-for-statuses': ['closed'] }],
  },
];

const textOf = (value: FormDataEntryValue | null | undefined) =>
  typeof value === 'string' ? value : '';

function show(action: Action) {
  render(
    <ToastProvider>
      <ChecklistsEditor
        templateId="ctmpl_01JE0000000000000000000001"
        versionId="ctmplv_01JE0000000000000000000002"
        checklists={CHECKLISTS}
        presetComments={[]}
        action={action}
      />
    </ToastProvider>,
  );
}

describe('ChecklistsEditor', () => {
  it('sends both documents as they are typed', async () => {
    const user = userEvent.setup();
    const action = vi.fn<Action>(() => later({ ok: true, data: undefined }));
    show(action);

    expect(screen.getByRole('textbox', { name: 'Checklists' })).toHaveValue(
      JSON.stringify(CHECKLISTS, null, 2),
    );
    await user.click(screen.getByRole('button', { name: 'Save checklists and comments' }));

    const sent = action.mock.calls[0]?.[1];
    expect(JSON.parse(textOf(sent?.get('checklists')))).toEqual(CHECKLISTS);
    expect(JSON.parse(textOf(sent?.get('preset-comments')))).toEqual([]);
    expect(await screen.findByText('Saved the checklists and preset comments.')).toBeVisible();
  });

  it('shows a refusal under the document it is about, at its pointer within it', async () => {
    const user = userEvent.setup();
    show(() =>
      later<ActionResult>({
        ok: false,
        problem: {
          title: 'Check the values you entered',
          status: 422,
          errors: [
            {
              pointer: '/data/attributes/checklists/0/items/0/required-for-statuses/0',
              detail: 'Names no status of this version.',
            },
          ],
        },
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Save checklists and comments' }));

    const detail = await screen.findByText('Names no status of this version.', { exact: false });
    expect(detail.closest('li')).toHaveTextContent(
      '/0/items/0/required-for-statuses/0: Names no status of this version.',
    );
  });
});
