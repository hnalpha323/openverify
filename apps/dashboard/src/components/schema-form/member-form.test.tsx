import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { TEMPLATE_FORMS_COPY } from '../../lib/copy/template-forms';
import { SIGNAL_PROBLEM_WORDS } from '../../lib/version-problem-words';
import { LIFECYCLE_IDS as IDS, RESOLVED_SETTINGS } from '../../testing/lifecycle-fixtures';
import { ToastProvider } from '../toasts';
import { MemberForm, type MemberFormProps } from './member-form';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

const COPY = TEMPLATE_FORMS_COPY;
const ETAG = '"0000000000000000000000000000000000000000000000000000000000000000"';
const LIST = 'lst_01JB0000000000000000000001';
const OTHER_LIST = 'lst_01JB0000000000000000000002';

function renderForm(props: Partial<MemberFormProps> & { action?: Action } = {}) {
  const action =
    props.action ?? vi.fn<Action>(() => Promise.resolve({ ok: true, data: undefined }));
  render(
    <ToastProvider>
      <MemberForm
        member="settings"
        initial={RESOLVED_SETTINGS}
        ids={{ templateId: IDS.template, versionId: IDS.draft, etag: ETAG }}
        {...props}
        action={action}
      />
    </ToastProvider>,
  );
  return action;
}

const sent = (action: ReturnType<typeof vi.fn<Action>>) => action.mock.calls[0]?.[1];

/** The posted `value` field, parsed. */
const valueOf = (data: FormData | undefined): unknown => {
  const value = data?.get('value');
  return typeof value === 'string' ? JSON.parse(value) : undefined;
};

describe('MemberForm (C153.1, C153.3): one member of the draft, generated and saved', () => {
  it('saves the member with the version, its ETag and the value as JSON', async () => {
    const action = renderForm();

    const form = screen.getByRole('form', { name: COPY.members.settings });
    await userEvent.clear(within(form).getByRole('textbox', { name: 'max-sessions' }));
    await userEvent.type(within(form).getByRole('textbox', { name: 'max-sessions' }), '5');
    await userEvent.click(
      within(form).getByRole('button', { name: COPY.memberForm.save(COPY.members.settings) }),
    );

    const data = sent(action as ReturnType<typeof vi.fn<Action>>);
    expect(data?.get('member')).toBe('settings');
    expect(data?.get('version-id')).toBe(IDS.draft);
    expect(data?.get('inquiry-template-id')).toBe(IDS.template);
    expect(data?.get('etag')).toBe(ETAG);
    expect(valueOf(data)).toEqual({
      ...RESOLVED_SETTINGS,
      'max-sessions': 5,
    });
    expect(await screen.findByText(COPY.memberForm.saved(COPY.members.settings))).toBeVisible();
  });

  it('warns at a window below 20 hours, and states each default', async () => {
    renderForm();

    const lifetime = screen.getByRole('textbox', { name: 'session-expiration-seconds' });
    expect(lifetime).not.toHaveAccessibleDescription(/Warning/);
    await userEvent.clear(lifetime);
    await userEvent.type(lifetime, '3600');

    expect(lifetime).toHaveAccessibleDescription(new RegExp(`Warning: below 20 hours \\(1 hours`));
    expect(lifetime).toHaveAccessibleDescription(/default applies: 86400/);
  });

  it('sends nothing while the contract refuses a value, and says so', async () => {
    const action = renderForm();

    const sessions = screen.getByRole('textbox', { name: 'max-sessions' });
    await userEvent.clear(sessions);
    await userEvent.type(sessions, '0');
    await userEvent.click(
      screen.getByRole('button', { name: COPY.memberForm.save(COPY.members.settings) }),
    );

    expect(action).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(COPY.memberForm.refusedBeforeSending);
  });

  it('edits the member as JSON one click away, and back as a form', async () => {
    renderForm();

    await userEvent.click(
      screen.getByRole('button', { name: COPY.memberForm.editAsJson(COPY.members.settings) }),
    );
    const json = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: COPY.memberForm.jsonLabel(COPY.members.settings),
    });
    expect(JSON.parse(json.value)).toEqual(RESOLVED_SETTINGS);
    fireEvent.change(json, { target: { value: JSON.stringify({ 'max-sessions': 7 }) } });
    await userEvent.click(
      screen.getByRole('button', { name: COPY.memberForm.editAsForm(COPY.members.settings) }),
    );

    expect(screen.getByRole('textbox', { name: 'max-sessions' })).toHaveValue('7');
    expect(screen.getByRole('textbox', { name: 'session-expiration-seconds' })).toHaveValue('');
  });

  it('stays in JSON while the text is not JSON of the member', async () => {
    renderForm();

    await userEvent.click(
      screen.getByRole('button', { name: COPY.memberForm.editAsJson(COPY.members.settings) }),
    );
    fireEvent.change(
      screen.getByRole('textbox', { name: COPY.memberForm.jsonLabel(COPY.members.settings) }),
      { target: { value: '[1,' } },
    );
    await userEvent.click(
      screen.getByRole('button', { name: COPY.memberForm.editAsForm(COPY.members.settings) }),
    );

    // The JSON editor has a status region of its own, so the message is found by its words.
    expect(screen.getByText(COPY.memberForm.jsonInvalid)).toBeVisible();
    expect(
      screen.getByRole('textbox', { name: COPY.memberForm.jsonLabel(COPY.members.settings) }),
    ).toBeVisible();
  });

  it('shows the API’s refusal at its field, by its pointer in the request', async () => {
    renderForm({
      action: () =>
        Promise.resolve({
          ok: false,
          problem: {
            title: 'Check the values you entered',
            errors: [
              { pointer: '/data/attributes/settings/max-sessions', detail: 'a synthetic refusal' },
            ],
          },
        }),
    });

    await userEvent.click(
      screen.getByRole('button', { name: COPY.memberForm.save(COPY.members.settings) }),
    );

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'max-sessions' })).toHaveAccessibleDescription(
        /a synthetic refusal/,
      );
    });
  });

  it('shows the saved draft’s publish problems at their fields: links, embedding and redirects', () => {
    renderForm({
      member: 'links',
      initial: {
        'embed-origins': ['https://partner.example.com'],
        'redirect-include-status': true,
      },
      saved: [
        {
          pointer: '/embed-origins/0',
          code: 'embed_origin_invalid',
          detail: 'not one of the allowed embed origins',
          severity: 'error',
        },
      ],
    });

    const form = screen.getByRole('form', { name: COPY.members.links });
    expect(
      within(form).getByRole('textbox', { name: 'embed-origins' }),
    ).toHaveAccessibleDescription(/not one of the allowed embed origins/);
    expect(
      within(form).getByRole('combobox', { name: 'redirect-include-status' }),
    ).toHaveAccessibleDescription(new RegExp(COPY.notes.redirectStatus.slice(0, 30)));
    expect(within(form).getByText(COPY.memberForm.savedProblems)).toBeVisible();
  });

  it('picks the screened lists from the environment’s lists, and says a list problem in words', async () => {
    const action = renderForm({
      member: 'list-config',
      initial: { screen: 'all', 'on-list-match': 'none' },
      lists: [
        { id: LIST, name: 'Synthetic blocked emails', kind: 'email-address' },
        { id: OTHER_LIST, name: 'Synthetic countries', kind: 'country' },
      ],
      saved: [
        {
          pointer: '/screen',
          code: 'list_kind_mismatch',
          detail: 'list_kind_mismatch',
          severity: 'error',
        },
      ],
    });

    const picker = screen.getByRole('radiogroup', { name: 'screen' });
    expect(picker).toHaveAccessibleDescription(new RegExp(SIGNAL_PROBLEM_WORDS.list_kind_mismatch));
    expect(within(picker).getByRole('radio', { name: COPY.listPicker.all })).toBeChecked();
    await userEvent.click(within(picker).getByRole('radio', { name: COPY.listPicker.chosen }));
    await userEvent.click(
      within(picker).getByRole('checkbox', { name: 'Synthetic countries (country)' }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: COPY.memberForm.save(COPY.members['list-config']) }),
    );

    const data = sent(action as ReturnType<typeof vi.fn<Action>>);
    expect(valueOf(data)).toEqual({
      screen: [OTHER_LIST],
      'on-list-match': 'none',
    });
  });

  it('shows the member read-only, with nothing to save', () => {
    renderForm({ readOnly: true });

    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('group', { name: COPY.members.settings })).toBeVisible();
  });

  it('shows a screened list the picker’s lists do not hold, so it can be unticked', async () => {
    const action = renderForm({
      member: 'list-config',
      initial: { screen: [OTHER_LIST], 'on-list-match': 'none' },
      lists: [{ id: LIST, name: 'Synthetic blocked emails', kind: 'email-address' }],
    });

    const picker = screen.getByRole('radiogroup', { name: 'screen' });
    const unknown = within(picker).getByRole('checkbox', {
      name: COPY.listPicker.unknown(OTHER_LIST),
    });
    expect(unknown).toBeChecked();
    await userEvent.click(unknown);
    await userEvent.click(
      within(picker).getByRole('checkbox', { name: 'Synthetic blocked emails (email-address)' }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: COPY.memberForm.save(COPY.members['list-config']) }),
    );

    expect(valueOf(sent(action as ReturnType<typeof vi.fn<Action>>))).toEqual({
      screen: [LIST],
      'on-list-match': 'none',
    });
  });
});
