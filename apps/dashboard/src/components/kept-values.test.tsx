/**
 * Workflow 2D K003: React 19 resets the uncontrolled fields of a `<form action>` after every run,
 * refused ones included. Every form that posts typed values through a server action runs it with
 * `useFormAction`, so a refused submission keeps what the operator typed (passwords and one-time
 * codes may be cleared).
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { ActionResult, DisplayProblem } from '../lib/action-state';
import { ENVIRONMENTS } from '../testing/api-mock';
import { later } from '../testing/later';
import { AcceptInvitationForm } from './accept-invitation-form';
import { ConfirmActionButton } from './confirm-action-button';
import { SecretActionButton } from './integrations/secret-action-button';
import { AccountInquiries } from './lifecycle/account-inquiries';
import { AccountRelations } from './lifecycle/account-relations';
import { AccountTypeForm } from './lifecycle/account-type-form';
import { FieldsEditor } from './lifecycle/fields-editor';
import { NoteEditor } from './lifecycle/note-editor';
import { OneTimeLinkButton } from './lifecycle/one-time-link-button';
import { SimulateForm } from './lifecycle/simulate-form';
import { TagEditor } from './lifecycle/tag-editor';
import {
  LIFECYCLE_IDS as IDS,
  RESOLVED_SETTINGS,
  VERSION_CONTENT,
} from '../testing/lifecycle-fixtures';
import { VersionEditor } from './lifecycle/version-editor';
import { ToastProvider } from './toasts';
import { TotpEnrolment } from './totp-enrolment';

const PROBLEM: DisplayProblem = { title: 'Synthetic refusal', detail: 'Try something else.' };

/** An action refused after a macrotask, as a server action answers. */
const refused =
  <Data,>() =>
  () =>
    later<ActionResult<Data>>({ ok: false, problem: PROBLEM });
const ok = () => Promise.resolve<ActionResult>({ ok: true, data: undefined });

async function refusal() {
  expect(await screen.findByText('Try something else.')).toBeVisible();
}

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('a refused submission keeps what was typed (Workflow 2D K003)', () => {
  it('on the invitation form: the name', async () => {
    window.history.replaceState(null, '', `/accept-invitation#token=ovi_${'I'.repeat(43)}`);
    render(<AcceptInvitationForm action={refused()} />);

    await userEvent.type(screen.getByRole('textbox', { name: 'Your name' }), 'Invited Operator');
    await userEvent.type(screen.getByLabelText('Password'), 'a long synthetic password');
    await userEvent.type(screen.getByLabelText('Repeat the password'), 'a long synthetic password');
    await userEvent.click(screen.getByRole('button', { name: 'Create my account' }));
    await refusal();

    expect(screen.getByRole('textbox', { name: 'Your name' })).toHaveValue('Invited Operator');
  });

  it('on the authenticator app form: the name', async () => {
    render(
      <ToastProvider>
        <TotpEnrolment start={refused()} confirm={refused()} />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Add an authenticator app' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Name (optional)' }), 'Work phone');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await refusal();

    expect(screen.getByRole('textbox', { name: 'Name (optional)' })).toHaveValue('Work phone');
  });

  it('on the account type form: the name and the schema', async () => {
    render(
      <ToastProvider>
        <AccountTypeForm action={refused()} environmentId={ENVIRONMENTS.sandbox.id} />
      </ToastProvider>,
    );
    const schema = '{ "legal_name": { "type": "string", "label": "Legal name" } }';

    await userEvent.type(screen.getByRole('textbox', { name: /Name/ }), 'business');
    fireEvent.change(screen.getByRole('textbox', { name: 'Fields schema' }), {
      target: { value: schema },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Create account type' }));
    await refusal();

    expect(screen.getByRole('textbox', { name: /Name/ })).toHaveValue('business');
    expect(screen.getByRole('textbox', { name: 'Fields schema' })).toHaveValue(schema);
  });

  it('on the tag forms: the new tag, and the list of all tags', async () => {
    render(
      <ToastProvider>
        <TagEditor
          tags={['vip']}
          fields={{ 'inquiry-id': IDS.inquiry }}
          canEdit
          addTag={refused()}
          removeTag={ok}
          setTags={refused()}
        />
      </ToastProvider>,
    );

    await userEvent.type(screen.getByRole('textbox', { name: 'New tag' }), 'manual review');
    await userEvent.click(screen.getByRole('button', { name: 'Add tag' }));
    await refusal();
    expect(screen.getByRole('textbox', { name: 'New tag' })).toHaveValue('manual review');

    await userEvent.click(screen.getByRole('button', { name: 'Edit all tags' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit all tags' });
    const list = within(dialog).getByRole('textbox', { name: 'Tags, one per line' });
    await userEvent.clear(list);
    await userEvent.type(list, 'gold{Enter}silver');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save tags' }));
    expect(await within(dialog).findByText('Try something else.')).toBeVisible();
    expect(list).toHaveValue('gold\nsilver');
  });

  it('on the add relation form: the account and the relation type', async () => {
    render(
      <ToastProvider>
        <AccountRelations
          accountId={IDS.account}
          relations={[]}
          canEdit
          add={refused()}
          remove={ok}
        />
      </ToastProvider>,
    );

    await userEvent.type(
      screen.getByRole('textbox', { name: 'Related account ID' }),
      IDS.otherAccount,
    );
    await userEvent.type(screen.getByRole('textbox', { name: /Relation type/ }), 'spouse');
    await userEvent.click(screen.getByRole('button', { name: 'Add relation' }));
    await refusal();

    expect(screen.getByRole('textbox', { name: 'Related account ID' })).toHaveValue(
      IDS.otherAccount,
    );
    expect(screen.getByRole('textbox', { name: /Relation type/ })).toHaveValue('spouse');
  });

  it('on the add inquiries form: the inquiry IDs', async () => {
    render(
      <ToastProvider>
        <AccountInquiries
          accountId={IDS.account}
          inquiries={{ kind: 'listed', items: [], nextCursor: null }}
          canEdit
          add={refused()}
          remove={ok}
        />
      </ToastProvider>,
    );

    await userEvent.type(screen.getByRole('textbox', { name: /Inquiry IDs/ }), IDS.otherInquiry);
    await userEvent.click(screen.getByRole('button', { name: 'Add inquiries' }));
    await refusal();

    expect(screen.getByRole('textbox', { name: /Inquiry IDs/ })).toHaveValue(IDS.otherInquiry);
  });

  it('on the note editor: the note', async () => {
    render(
      <ToastProvider>
        <NoteEditor
          inquiryId={IDS.inquiry}
          note="Checked by phone."
          state="visible"
          canEdit
          action={refused()}
        />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Edit note' }));
    const note = screen.getByRole('textbox', { name: 'Note' });
    await userEvent.type(note, ' Called back on Monday.');
    await userEvent.click(screen.getByRole('button', { name: 'Save note' }));
    await refusal();

    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue(
      'Checked by phone. Called back on Monday.',
    );
  });

  it('on the draft editor: the edited document', async () => {
    render(
      <ToastProvider>
        <VersionEditor
          templateId={IDS.template}
          versionId={IDS.draft}
          flow={VERSION_CONTENT.flow}
          verificationConfig={VERSION_CONTENT['verification-config']}
          settings={RESOLVED_SETTINGS}
          action={refused()}
        />
      </ToastProvider>,
    );
    const settings = '{ "inquiry-expiration-seconds": 3600 }';

    fireEvent.change(screen.getByRole('textbox', { name: 'Settings' }), {
      target: { value: settings },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await refusal();

    expect(screen.getByRole('textbox', { name: 'Settings' })).toHaveValue(settings);
  });

  it('on the fields editor: the edited fields', async () => {
    render(
      <ToastProvider>
        <FieldsEditor
          fields={{ name_first: 'Synthetic' }}
          hiddenFields={{ 'inquiry-id': IDS.inquiry }}
          description="Synthetic fields."
          action={refused()}
        />
      </ToastProvider>,
    );
    const fields = '{ "name_first": "Changed" }';

    await userEvent.click(screen.getByRole('button', { name: 'Edit fields' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Fields' }), {
      target: { value: fields },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Save fields' }));
    await refusal();

    expect(screen.getByRole('textbox', { name: 'Fields' })).toHaveValue(fields);
  });

  it('on a confirmation with controls: what was entered in the dialog', async () => {
    render(
      <ToastProvider>
        <ConfirmActionButton
          label="Consolidate"
          title="Consolidate the accounts?"
          confirmLabel="Consolidate accounts"
          action={refused()}
        >
          <label>
            Source accounts <textarea name="source-account-ids" />
          </label>
        </ConfirmActionButton>
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Consolidate' }));
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Source accounts' }),
      IDS.otherAccount,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Consolidate accounts' }));
    await refusal();

    expect(screen.getByRole('textbox', { name: 'Source accounts' })).toHaveValue(IDS.otherAccount);
  });

  it('on a secret action with controls: what was entered in the dialog', async () => {
    render(
      <ToastProvider>
        <SecretActionButton<{ secret: string }>
          label="Rotate secret"
          title="Rotate the secret?"
          confirmLabel="Rotate"
          action={refused<{ secret: string }>()}
          secretTitle="New secret"
          secretLabel="Signing secret"
        >
          <label>
            Overlap (seconds) <input name="overlap" />
          </label>
        </SecretActionButton>
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Rotate secret' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Overlap (seconds)' }), '3600');
    await userEvent.click(screen.getByRole('button', { name: 'Rotate' }));
    await refusal();

    expect(screen.getByRole('textbox', { name: 'Overlap (seconds)' })).toHaveValue('3600');
  });

  it('on the one-time link form: the chosen lifetime', async () => {
    render(
      <ToastProvider>
        <OneTimeLinkButton inquiryId={IDS.inquiry} action={refused()} />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Generate one-time link' }));
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Link lifetime' }),
      '7 days',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Generate link' }));
    await refusal();

    expect(screen.getByRole('combobox', { name: 'Link lifetime' })).toHaveValue('604800');
  });

  it('on the sandbox simulation form: the chosen action', async () => {
    render(
      <ToastProvider>
        <SimulateForm
          inquiryId={IDS.inquiry}
          actions={['complete_inquiry', 'fail_inquiry']}
          action={refused()}
        />
      </ToastProvider>,
    );

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Simulated action' }),
      'Fail',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Run in the sandbox' }));
    await refusal();

    expect(screen.getByRole('combobox', { name: 'Simulated action' })).toHaveValue('fail_inquiry');
  });
});

describe('a successful submission behaves as before (Workflow 2D K003)', () => {
  const accepted = () => later<ActionResult>({ ok: true, data: undefined });

  it('empties the add tag, add relation and add inquiries fields for the next item', async () => {
    render(
      <ToastProvider>
        <TagEditor
          tags={[]}
          fields={{ 'inquiry-id': IDS.inquiry }}
          canEdit
          addTag={accepted}
          removeTag={ok}
          setTags={ok}
        />
        <AccountRelations
          accountId={IDS.account}
          relations={[]}
          canEdit
          add={accepted}
          remove={ok}
        />
        <AccountInquiries
          accountId={IDS.account}
          inquiries={{ kind: 'listed', items: [], nextCursor: null }}
          canEdit
          add={accepted}
          remove={ok}
        />
      </ToastProvider>,
    );

    await userEvent.type(screen.getByRole('textbox', { name: 'New tag' }), 'vip');
    await userEvent.click(screen.getByRole('button', { name: 'Add tag' }));
    expect(await screen.findByText('Added the tag.')).toBeVisible();
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'New tag' })).toHaveValue('');
    });

    await userEvent.type(
      screen.getByRole('textbox', { name: 'Related account ID' }),
      IDS.otherAccount,
    );
    await userEvent.type(screen.getByRole('textbox', { name: /Relation type/ }), 'spouse');
    await userEvent.click(screen.getByRole('button', { name: 'Add relation' }));
    expect(await screen.findByText('Added the relation.')).toBeVisible();
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /Relation type/ })).toHaveValue('');
    });

    await userEvent.type(screen.getByRole('textbox', { name: /Inquiry IDs/ }), IDS.otherInquiry);
    await userEvent.click(screen.getByRole('button', { name: 'Add inquiries' }));
    expect(await screen.findByText('Added the inquiries.')).toBeVisible();
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /Inquiry IDs/ })).toHaveValue('');
    });
  });

  it('shows the button as busy while the action runs', async () => {
    // The action answers only when the test says so: a stub that answers on a timer can answer
    // before a loaded machine has looked for the busy button.
    let answer: (result: ActionResult) => void = () => undefined;
    const running = new Promise<ActionResult>((resolve) => {
      answer = resolve;
    });
    render(
      <ToastProvider>
        <AccountTypeForm action={() => running} environmentId={ENVIRONMENTS.sandbox.id} />
      </ToastProvider>,
    );

    await userEvent.type(screen.getByRole('textbox', { name: /Name/ }), 'business');
    await userEvent.click(screen.getByRole('button', { name: 'Create account type' }));

    expect(await screen.findByRole('button', { name: 'Creating…' })).toBeDisabled();
    answer({ ok: true, data: undefined });
    expect(await screen.findByText('Created the account type.')).toBeVisible();
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /Name/ })).toHaveValue('');
    });
  });
});
