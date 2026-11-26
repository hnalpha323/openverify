/**
 * The start action's answer shows the secret a render before the action itself ends: React runs
 * `onSuccess` after the action's await, outside its transition, and clears `pending` only once
 * the action returns. Under load that gap is long enough to press Escape in. Here
 * `useFormAction` keeps an action pending after it answers, so the gap never closes.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../lib/action-state';
import type { FactorActivated, TotpEnrolmentData } from '../lib/mfa-enrolment';
import { ToastProvider } from './toasts';
import { TotpEnrolment } from './totp-enrolment';
import type { FormAction, FormActionCallbacks } from './use-form-action';

vi.mock('./use-form-action', async () => {
  const { useState } = await import('react');
  return {
    useFormAction<Data>(
      action: (state: ActionState<Data>, formData: FormData) => Promise<ActionResult<Data>>,
      { onSuccess, onProblem }: FormActionCallbacks<Data> = {},
    ): FormAction {
      const [pending, setPending] = useState(false);
      const submit = (formData: FormData) => {
        setPending(true);
        void action(null, formData).then((result) => {
          if (result.ok) {
            onSuccess?.(result.data);
          } else {
            onProblem?.(result.problem);
          }
        });
      };
      return {
        pending,
        problem: undefined,
        clearProblem: () => undefined,
        submit,
        formProps: {
          action: submit,
          onSubmit: (event) => {
            event.preventDefault();
            submit(new FormData(event.currentTarget));
          },
        },
      };
    },
  };
});

const ENROLMENT: TotpEnrolmentData = {
  factorId: 'mfa_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z',
  secret: 'JBSWY3DPEHPK3PXP',
  otpauthUri: 'otpauth://totp/OpenVerify:operator?secret=JBSWY3DPEHPK3PXP',
  qr: { size: 29, path: 'M4 4h1v1h-1z' },
};

function setup(start: () => Promise<ActionResult<TotpEnrolmentData>>) {
  render(
    <ToastProvider>
      <TotpEnrolment
        start={start}
        confirm={() => new Promise<ActionResult<FactorActivated>>(() => undefined)}
      />
    </ToastProvider>,
  );
}

async function continueFromTheName() {
  await userEvent.click(screen.getByRole('button', { name: 'Add an authenticator app' }));
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

describe('TotpEnrolment while its start action has not ended', () => {
  it('closes on Escape once the secret shows, and drops the secret', async () => {
    setup(() => Promise.resolve({ ok: true, data: ENROLMENT }));
    await continueFromTheName();
    await screen.findByRole('textbox', { name: 'Secret key' });

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add an authenticator app' }));
    expect(screen.queryByRole('textbox', { name: 'Secret key' })).not.toBeInTheDocument();
  });

  it('stays open on Escape until the start action answers', async () => {
    setup(() => new Promise<ActionResult<TotpEnrolmentData>>(() => undefined));
    await continueFromTheName();

    await userEvent.keyboard('{Escape}');

    expect(screen.getByRole('dialog', { name: 'Add an authenticator app' })).toBeInTheDocument();
  });
});
