import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../lib/action-state';
import type { FactorActivated, TotpEnrolmentData } from '../lib/mfa-enrolment';
import { ToastProvider } from './toasts';
import { later } from '../testing/later';
import { TotpEnrolment } from './totp-enrolment';

type Start = (
  state: ActionState<TotpEnrolmentData>,
  formData: FormData,
) => Promise<ActionResult<TotpEnrolmentData>>;
type Confirm = (
  state: ActionState<FactorActivated>,
  formData: FormData,
) => Promise<ActionResult<FactorActivated>>;

const ENROLMENT: TotpEnrolmentData = {
  factorId: 'mfa_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z',
  secret: 'JBSWY3DPEHPK3PXP',
  otpauthUri: 'otpauth://totp/OpenVerify:operator?secret=JBSWY3DPEHPK3PXP',
  qr: { size: 29, path: 'M4 4h1v1h-1z' },
};
const CODES = Array.from(
  { length: 10 },
  (_, index) => `ABCD-EFGH-JK${String(index).padStart(2, '0')}`,
);

function setup(start: Start, confirm: Confirm) {
  render(
    <ToastProvider>
      <TotpEnrolment start={start} confirm={confirm} />
    </ToastProvider>,
  );
}

async function begin() {
  await userEvent.click(screen.getByRole('button', { name: 'Add an authenticator app' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Name (optional)' }), 'Phone');
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

/** Starts an enrolment and waits for its answer: the step with the secret. */
async function beginEnrolment() {
  await begin();
  await screen.findByRole('textbox', { name: 'Secret key' });
}

describe('TotpEnrolment', () => {
  it('names the factor, then shows the QR code and the secret once, with a copy button', async () => {
    const start = vi.fn<Start>(() => later({ ok: true, data: ENROLMENT }));
    setup(start, vi.fn<Confirm>());

    await beginEnrolment();

    expect(start.mock.calls[0]?.[1].get('name')).toBe('Phone');
    const dialog = screen.getByRole('dialog', { name: 'Add an authenticator app' });
    expect(
      within(dialog).getByRole('img', { name: 'QR code for your authenticator app' }),
    ).toBeVisible();
    expect(within(dialog).getByRole('textbox', { name: 'Secret key' })).toHaveValue(
      ENROLMENT.secret,
    );
    expect(within(dialog).getByRole('button', { name: 'Copy' })).toBeVisible();
    expect(within(dialog).getByRole('textbox', { name: 'Authentication code' })).toBeVisible();
  });

  it('activates the factor with a code, shows the first recovery codes once, then drops everything', async () => {
    const confirm = vi.fn<Confirm>(() =>
      Promise.resolve({ ok: true, data: { recoveryCodes: CODES } }),
    );
    setup(() => later({ ok: true, data: ENROLMENT }), confirm);
    await beginEnrolment();

    await userEvent.type(screen.getByRole('textbox', { name: 'Authentication code' }), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Activate' }));

    const formData = confirm.mock.calls[0]?.[1];
    expect(formData?.get('factor-id')).toBe(ENROLMENT.factorId);
    expect(formData?.get('totp-code')).toBe('123456');
    const codes = await screen.findByRole('dialog', { name: 'Save your recovery codes' });
    expect(within(codes).getByRole('list', { name: 'Recovery codes' })).toHaveTextContent(
      CODES[0] ?? '',
    );
    expect(screen.queryByText(ENROLMENT.secret)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText(CODES[0] ?? '')).not.toBeInTheDocument();
  });

  it('confirms with a toast when no recovery codes come back', async () => {
    setup(
      () => later({ ok: true, data: ENROLMENT }),
      () => Promise.resolve({ ok: true, data: { recoveryCodes: null } }),
    );
    await beginEnrolment();

    await userEvent.type(screen.getByRole('textbox', { name: 'Authentication code' }), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Activate' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Authenticator app added.');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the step open with the problem when the code is refused', async () => {
    setup(
      () => later({ ok: true, data: ENROLMENT }),
      () =>
        Promise.resolve({
          ok: false,
          problem: { title: 'Unprocessable Entity', detail: 'The code is not valid.' },
        }),
    );
    await beginEnrolment();

    await userEvent.type(screen.getByRole('textbox', { name: 'Authentication code' }), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Activate' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The code is not valid.');
    expect(screen.getByRole('textbox', { name: 'Secret key' })).toBeVisible();
  });

  it('drops the secret when the operator closes the dialog', async () => {
    setup(() => later({ ok: true, data: ENROLMENT }), vi.fn<Confirm>());
    await beginEnrolment();

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add an authenticator app' }));
    expect(screen.queryByRole('textbox', { name: 'Secret key' })).not.toBeInTheDocument();
  });

  it('shows why the enrolment could not start', async () => {
    setup(
      () => Promise.resolve({ ok: false, problem: { title: 'The API could not be reached' } }),
      vi.fn<Confirm>(),
    );

    await begin();

    expect(await screen.findByRole('alert')).toHaveTextContent('The API could not be reached');
  });
});
