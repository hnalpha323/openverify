import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../toasts';
import { SHARE_TOKEN_ID } from './connect-fixtures';
import { RedeemShareTokenForm } from './share-token-actions';

const submitted = (action: ReturnType<typeof vi.fn>) =>
  (action.mock.calls[0] as unknown as [unknown, FormData])[1];

function show(sourceType: 'inquiry' | 'account' = 'inquiry') {
  const action = vi.fn(() => Promise.resolve({ ok: true as const, data: undefined }));
  render(
    <ToastProvider>
      <RedeemShareTokenForm tokenId={SHARE_TOKEN_ID} sourceType={sourceType} action={action} />
    </ToastProvider>,
  );
  return action;
}

describe('RedeemShareTokenForm (C242.2, C234.1)', () => {
  it('asks for the mode, the destination, the account linking, the mappings and the destination consent', () => {
    show();

    expect(screen.getByRole('radio', { name: /Clone/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Hydrate/ })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Inquiry template ID/ })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Destination consent record ID/ })).toBeRequired();
    expect(screen.getByRole('radio', { name: 'No account link' })).toBeChecked();
  });

  it('offers only hydrate for an account source, which cannot be cloned', () => {
    show('account');

    expect(screen.queryByRole('radio', { name: /Clone/ })).toBeNull();
    expect(screen.getByRole('textbox', { name: /Destination ID/ })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Field mappings/ })).toBeInTheDocument();
  });

  it('posts what the operator chose with the token', async () => {
    const action = show();
    const user = userEvent.setup();

    await user.type(screen.getByRole('textbox', { name: /Inquiry template ID/ }), 'itmpl_x');
    await user.type(
      screen.getByRole('textbox', { name: /Destination consent record ID/ }),
      'cnsr_y',
    );
    await user.click(screen.getByRole('button', { name: 'Redeem' }));

    const form = submitted(action);
    expect(form.get('share-token-id')).toBe(SHARE_TOKEN_ID);
    expect(form.get('mode')).toBe('clone');
    expect(form.get('inquiry-template-id')).toBe('itmpl_x');
    expect(form.get('destination-consent-record-id')).toBe('cnsr_y');
  });
});
