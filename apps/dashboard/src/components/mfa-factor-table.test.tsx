import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../lib/action-state';
import type { FactorSummary } from '../lib/mfa-enrolment';
import { MfaFactorTable } from './mfa-factor-table';
import { RecoveryCodesButton } from './recovery-codes-button';
import { ToastProvider } from './toasts';

type Remove = (state: ActionState, formData: FormData) => Promise<ActionResult>;
type Regenerate = (
  state: ActionState<readonly string[]>,
  formData: FormData,
) => Promise<ActionResult<readonly string[]>>;

const FACTORS: FactorSummary[] = [
  {
    id: 'mfa_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z',
    kind: 'totp',
    name: 'Phone',
    status: 'active',
    createdAt: '2026-10-20T04:35:00.000Z',
    lastUsedAt: null,
  },
  {
    id: 'mfa_01J9ZK3M5Q7R8S9T0V1W2X3Y50',
    kind: 'webauthn',
    name: null,
    status: 'active',
    createdAt: '2026-10-20T04:35:00.000Z',
    lastUsedAt: '2026-10-20T05:00:00.000Z',
  },
  {
    id: 'mfa_01J9ZK3M5Q7R8S9T0V1W2X3Y51',
    kind: 'totp',
    name: null,
    status: 'pending',
    createdAt: '2026-10-20T04:35:00.000Z',
    lastUsedAt: null,
  },
];
const CODES = Array.from(
  { length: 10 },
  (_, index) => `ABCD-EFGH-JK${String(index).padStart(2, '0')}`,
);

describe('MfaFactorTable', () => {
  it('lists each factor with its kind, status and use', () => {
    render(
      <ToastProvider>
        <MfaFactorTable factors={FACTORS} remove={vi.fn<Remove>()} canRemove />
      </ToastProvider>,
    );

    const table = screen.getByRole('table', { name: 'Second factors' });
    const phone = within(table).getByRole('rowheader', { name: 'Phone' }).closest('tr');
    expect(phone).toHaveTextContent('Authenticator app');
    expect(phone).toHaveTextContent('Active');
    expect(phone).toHaveTextContent('Never');
    expect(within(table).getByRole('rowheader', { name: 'Security key' })).toBeVisible();
    expect(within(table).getByText('Waiting for a code')).toBeVisible();
  });

  it('removes a factor after confirmation', async () => {
    const remove = vi.fn<Remove>(() => Promise.resolve({ ok: true, data: undefined }));
    render(
      <ToastProvider>
        <MfaFactorTable factors={FACTORS} remove={remove} canRemove />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Remove Phone' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove factor' }));

    expect(remove.mock.calls[0]?.[1].get('factor-id')).toBe(FACTORS[0]?.id);
    expect(await screen.findByRole('status')).toHaveTextContent('The factor was removed.');
  });

  it('offers no removal when the session may not remove factors', () => {
    render(
      <ToastProvider>
        <MfaFactorTable factors={FACTORS} remove={vi.fn<Remove>()} canRemove={false} />
      </ToastProvider>,
    );

    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
  });

  it('says when there is no factor yet', () => {
    render(
      <ToastProvider>
        <MfaFactorTable factors={[]} remove={vi.fn<Remove>()} canRemove />
      </ToastProvider>,
    );

    expect(screen.getByText('No second factor yet.')).toBeVisible();
  });
});

describe('RecoveryCodesButton', () => {
  it('regenerates the codes after confirmation and shows them once', async () => {
    const regenerate = vi.fn<Regenerate>(() => Promise.resolve({ ok: true, data: CODES }));
    render(
      <ToastProvider>
        <RecoveryCodesButton regenerate={regenerate} />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Regenerate recovery codes' }));
    expect(
      screen.getByRole('dialog', { name: 'Regenerate recovery codes?' }),
    ).toHaveAccessibleDescription('The codes you have now stop working.');
    await userEvent.click(screen.getByRole('button', { name: 'Regenerate' }));

    const dialog = await screen.findByRole('dialog', { name: 'Save your recovery codes' });
    expect(within(dialog).getByRole('list', { name: 'Recovery codes' })).toHaveTextContent(
      CODES[9] ?? '',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByText(CODES[9] ?? '')).not.toBeInTheDocument();
  });

  it('keeps the question open with the problem when it fails', async () => {
    render(
      <ToastProvider>
        <RecoveryCodesButton
          regenerate={() => Promise.resolve({ ok: false, problem: { title: 'Conflict' } })}
        />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Regenerate recovery codes' }));
    await userEvent.click(screen.getByRole('button', { name: 'Regenerate' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Conflict');
  });
});
