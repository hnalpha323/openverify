import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { later } from '../../testing/later';
import { REPORT_CONFIG_IDS as IDS } from '../../testing/report-config-fixtures';
import { ToastProvider } from '../toasts';
import { ConfigEditor } from './config-editor';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

const CONFIG = { 'recurrence-interval-days': 30, 'search-lists': ['openverify-sandbox'] };

function renderEditor(action: Action) {
  render(
    <ToastProvider>
      <ConfigEditor
        templateId={IDS.template}
        versionId={IDS.draft}
        config={CONFIG}
        action={action}
      />
    </ToastProvider>,
  );
  return screen.getByRole('form', { name: 'Edit the draft configuration' });
}

describe('ConfigEditor (C71.2, C86)', () => {
  it('starts from what the version sets, and says the defaults apply to the rest', () => {
    const form = renderEditor(vi.fn<Action>());

    const editor = within(form).getByRole('textbox', { name: 'Configuration' });
    expect(JSON.parse((editor as HTMLTextAreaElement).value)).toEqual(CONFIG);
    expect(editor).toHaveAccessibleDescription(/Keys you leave out take their default/);
    expect(editor).toHaveAccessibleDescription(/search-lists/);
  });

  it('saves the edited configuration with the version', async () => {
    const action = vi.fn<Action>(() => later({ ok: true, data: undefined }));
    const form = renderEditor(action);

    fireEvent.change(within(form).getByRole('textbox', { name: 'Configuration' }), {
      target: { value: '{ "max-list-age-hours": 24 }' },
    });
    await userEvent.click(within(form).getByRole('button', { name: 'Save draft' }));

    const sent = action.mock.calls[0]?.[1];
    expect(sent?.get('report-template-id')).toBe(IDS.template);
    expect(sent?.get('version-id')).toBe(IDS.draft);
    expect(sent?.get('config')).toBe('{ "max-list-age-hours": 24 }');
    expect(await screen.findByText('Saved the draft.')).toBeVisible();
  });

  it('names a list item by the id the submitted text holds there, not the saved one', async () => {
    const form = renderEditor(() =>
      later({
        ok: false,
        problem: {
          title: 'Unprocessable Content',
          errors: [
            {
              pointer: '/data/attributes/config/search-lists/1',
              detail: 'must be a source id such as ofac-sdn',
            },
          ],
        },
      }),
    );

    fireEvent.change(within(form).getByRole('textbox', { name: 'Configuration' }), {
      target: { value: '{ "search-lists": ["ofac-sdn", "Synthetic_Typo"] }' },
    });
    await userEvent.click(within(form).getByRole('button', { name: 'Save draft' }));

    const problems = await within(form).findByRole('list', { name: 'Problems in Configuration' });
    expect(problems).toHaveTextContent('Lists searched, item 2 (Synthetic_Typo)');
  });

  it('shows each error of the API at its place in the configuration, in words, and the rest below', async () => {
    const form = renderEditor(() =>
      later({
        ok: false,
        problem: {
          title: 'Unprocessable Content',
          detail: 'The configuration is not one a watchlist template takes.',
          errors: [
            {
              pointer: '/data/attributes/config/max-list-age-hours',
              detail: 'Too small: expected number to be >=1',
            },
            {
              pointer: '/data/attributes/config/search-lists/0',
              detail: 'must be a source id such as ofac-sdn',
            },
            { pointer: '/data/attributes', detail: 'Synthetic error outside the document' },
          ],
        },
      }),
    );

    await userEvent.click(within(form).getByRole('button', { name: 'Save draft' }));

    const problems = await within(form).findByRole('list', { name: 'Problems in Configuration' });
    expect(problems).toHaveTextContent('Maximum list age');
    expect(problems).toHaveTextContent('/max-list-age-hours: Too small: expected number to be >=1');
    expect(problems).toHaveTextContent('Lists searched, item 1 (openverify-sandbox)');
    expect(within(form).getByRole('textbox', { name: 'Configuration' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    const alert = within(form).getByRole('alert');
    expect(alert).toHaveTextContent('Synthetic error outside the document');
    expect(alert).not.toHaveTextContent('max-list-age-hours');
    // A refusal keeps the text as typed.
    const kept = within(form).getByRole<HTMLTextAreaElement>('textbox', { name: 'Configuration' });
    expect(JSON.parse(kept.value)).toEqual(CONFIG);
  });
});
