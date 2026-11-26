/**
 * Workflow 2D F006 (WCAG 4.1.3, 3.3.1): a submission refused with field errors only must still be
 * announced. The field errors sit in plain text next to their fields, which no screen reader
 * announces, so every form keeps an announced summary (`role="alert"`) with the problem's title.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { ActionResult, DisplayProblem } from '../lib/action-state';
import { later } from '../testing/later';
import { ENVIRONMENTS } from '../testing/api-mock';
import { AcceptInvitationForm } from './accept-invitation-form';
import { AccountInquiries } from './lifecycle/account-inquiries';
import { AccountRelations } from './lifecycle/account-relations';
import { AccountTypeForm } from './lifecycle/account-type-form';
import { NoteEditor } from './lifecycle/note-editor';
import { TagEditor } from './lifecycle/tag-editor';
import {
  LIFECYCLE_IDS as IDS,
  RESOLVED_SETTINGS,
  VERSION_CONTENT,
} from '../testing/lifecycle-fixtures';
import { VersionEditor } from './lifecycle/version-editor';
import { ToastProvider } from './toasts';

const TITLE = 'Check the values you entered';

/** An action that refuses, after a macrotask, with errors at `pointers` only. */
function refusing(...pointers: string[]) {
  const problem: DisplayProblem = {
    title: TITLE,
    errors: pointers.map((pointer) => ({ pointer, detail: 'is not valid' })),
  };
  return () => later<ActionResult>({ ok: false, problem });
}

const ok = () => Promise.resolve<ActionResult>({ ok: true, data: undefined });

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

async function expectAnnounced() {
  expect(await screen.findByRole('alert')).toHaveTextContent(TITLE);
}

describe('a refusal with field errors only is announced (Workflow 2D F006)', () => {
  it('on the invitation form', async () => {
    window.history.replaceState(null, '', `/accept-invitation#token=ovi_${'I'.repeat(43)}`);
    render(<AcceptInvitationForm action={refusing('/password-confirmation')} />);

    await userEvent.type(screen.getByRole('textbox', { name: 'Your name' }), 'Invited Operator');
    await userEvent.type(screen.getByLabelText('Password'), 'a long synthetic password');
    await userEvent.type(screen.getByLabelText('Repeat the password'), 'a different password');
    await userEvent.click(screen.getByRole('button', { name: 'Create my account' }));

    await expectAnnounced();
  });

  it('on the draft editor', async () => {
    render(
      <ToastProvider>
        <VersionEditor
          templateId={IDS.template}
          versionId={IDS.draft}
          flow={VERSION_CONTENT.flow}
          verificationConfig={VERSION_CONTENT['verification-config']}
          settings={RESOLVED_SETTINGS}
          action={refusing('/data/attributes/flow/steps/0')}
        />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await expectAnnounced();
  });

  it('on the account type form', async () => {
    render(
      <ToastProvider>
        <AccountTypeForm
          action={refusing('/data/attributes/name')}
          environmentId={ENVIRONMENTS.sandbox.id}
        />
      </ToastProvider>,
    );

    await userEvent.type(screen.getByRole('textbox', { name: /Name/ }), 'business');
    await userEvent.click(screen.getByRole('button', { name: 'Create account type' }));

    await expectAnnounced();
  });

  it('on the add tag form', async () => {
    render(
      <ToastProvider>
        <TagEditor
          tags={[]}
          fields={{ 'inquiry-id': IDS.inquiry }}
          canEdit
          addTag={refusing('/meta/tag-name')}
          removeTag={ok}
          setTags={ok}
        />
      </ToastProvider>,
    );

    await userEvent.type(screen.getByRole('textbox', { name: 'New tag' }), 'vip!');
    await userEvent.click(screen.getByRole('button', { name: 'Add tag' }));

    await expectAnnounced();
  });

  it('on the add relation form', async () => {
    render(
      <ToastProvider>
        <AccountRelations
          accountId={IDS.account}
          relations={[]}
          canEdit
          add={refusing('/meta/relation-type')}
          remove={ok}
        />
      </ToastProvider>,
    );

    await userEvent.type(
      screen.getByRole('textbox', { name: 'Related account ID' }),
      IDS.otherAccount,
    );
    await userEvent.type(screen.getByRole('textbox', { name: /Relation type/ }), 'Spouse');
    await userEvent.click(screen.getByRole('button', { name: 'Add relation' }));

    await expectAnnounced();
  });

  it('on the add inquiries form', async () => {
    render(
      <ToastProvider>
        <AccountInquiries
          accountId={IDS.account}
          inquiries={{ kind: 'listed', items: [], nextCursor: null }}
          canEdit
          add={refusing('/meta/objects')}
          remove={ok}
        />
      </ToastProvider>,
    );

    await userEvent.type(screen.getByRole('textbox', { name: /Inquiry IDs/ }), 'inq_malformed');
    await userEvent.click(screen.getByRole('button', { name: 'Add inquiries' }));

    await expectAnnounced();
  });

  it('on the note editor', async () => {
    render(
      <ToastProvider>
        <NoteEditor
          inquiryId={IDS.inquiry}
          note="Checked by phone."
          state="visible"
          canEdit
          action={refusing('/data/attributes/note')}
        />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Edit note' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save note' }));

    await expectAnnounced();
  });
});
