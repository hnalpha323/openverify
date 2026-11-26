import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../lib/action-state';
import { AcceptInvitationForm } from './accept-invitation-form';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

const TOKEN = `ovi_${'I'.repeat(43)}`;
const PASSWORD = 'a long synthetic password';

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

/** Answers as the contract says (a stub answering `undefined` breaks the form's hook). */
const accepted = () => vi.fn<Action>(() => Promise.resolve({ ok: true, data: undefined }));

function open(hash: string, action: Action = accepted()) {
  window.history.replaceState(null, '', `/accept-invitation?ref=mail${hash}`);
  render(<AcceptInvitationForm action={action} />);
  return action;
}

async function fill(confirmation = PASSWORD) {
  await userEvent.type(screen.getByRole('textbox', { name: 'Your name' }), 'Invited Operator');
  await userEvent.type(screen.getByLabelText('Password'), PASSWORD);
  await userEvent.type(screen.getByLabelText('Repeat the password'), confirmation);
}

describe('AcceptInvitationForm', () => {
  it('takes the token from the fragment and clears the fragment at once', () => {
    open(`#token=${TOKEN}`);

    expect(window.location.hash).toBe('');
    expect(window.location.pathname + window.location.search).toBe('/accept-invitation?ref=mail');
    expect(screen.getByRole('button', { name: 'Create my account' })).toBeVisible();
  });

  it('posts the token with the name and password', async () => {
    const action = open(`#token=${TOKEN}`);

    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Create my account' }));

    const formData = vi.mocked(action).mock.calls[0]?.[1];
    expect(formData?.get('token')).toBe(TOKEN);
    expect(formData?.get('name')).toBe('Invited Operator');
    expect(formData?.get('password')).toBe(PASSWORD);
    expect(formData?.get('password-confirmation')).toBe(PASSWORD);
    // The answer is handled within the test, not after it ended (Workflow 2D: under load, an
    // off-contract stub answer once failed a later test).
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create my account' })).toBeEnabled();
    });
  });

  it('asks for a new password of at least 12 characters, as password managers expect', () => {
    open(`#token=${TOKEN}`);

    const password = screen.getByLabelText('Password');
    expect(password).toHaveAttribute('autocomplete', 'new-password');
    expect(password).toHaveAttribute('minlength', '12');
    expect(password).toHaveAccessibleDescription('At least 12 characters.');
  });

  it('shows the problem the action answers', async () => {
    open(`#token=${TOKEN}`, () =>
      Promise.resolve({
        ok: false,
        problem: {
          title: 'The invitation was not accepted',
          detail: 'This invitation is not valid any more. Ask your administrator for a new one.',
        },
      }),
    );

    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Create my account' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('not valid any more');
  });

  it('marks a field the action refused', async () => {
    open(`#token=${TOKEN}`, () =>
      Promise.resolve({
        ok: false,
        problem: {
          title: 'Check the values you entered',
          errors: [{ pointer: '/password-confirmation', detail: 'The passwords do not match.' }],
        },
      }),
    );

    await fill('another long password');
    await userEvent.click(screen.getByRole('button', { name: 'Create my account' }));

    expect(await screen.findByLabelText('Repeat the password')).toHaveAccessibleDescription(
      'The passwords do not match.',
    );
  });

  it.each(['', '#', '#token=', '#token=nope', '#other=1'])(
    'explains that the link is incomplete for the fragment %j, with no form',
    (hash) => {
      open(hash);

      expect(screen.getByRole('alert')).toHaveTextContent(
        'This invitation link is not complete. Open the link from your email again.',
      );
      expect(screen.queryByRole('button', { name: 'Create my account' })).not.toBeInTheDocument();
    },
  );
});
