/** Trust Device on the inquiry's session cards (C127.9; Workflow 8D). */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult } from '../../lib/action-state';
import { SIGNAL_IDS as IDS, device, network, phase7Session } from '../../testing/signals-fixtures';
import { ToastProvider } from '../toasts';
import { InquirySessions } from './inquiry-sessions';

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const done = () => Promise.resolve({ ok: true, data: undefined } as ActionResult);

const show = (trust: boolean) =>
  render(
    <ToastProvider>
      <InquirySessions
        inquiryId={IDS.inquiry}
        sessions={[phase7Session()]}
        included={[device(), network()]}
        masked={false}
        canExpire={false}
        expire={vi.fn(done)}
        expireAll={vi.fn(() => Promise.resolve({ ok: true as const, data: { expiredCount: 0 } }))}
        {...(trust ? { trustDevice: vi.fn(done) } : {})}
      />
    </ToastProvider>,
  );

describe('the session card’s device trust (C127.9)', () => {
  it('shows the trust mark on every recorded device, and the control with devices:write', () => {
    show(true);

    const card = screen.getByRole('article', { name: `Session ${phase7Session().id}` });
    expect(within(card).getByText('Not trusted')).toBeVisible();
    expect(within(card).getByRole('form', { name: 'Trust this device' })).toBeVisible();
  });

  it('offers no control without devices:write', () => {
    show(false);

    expect(screen.getByText('Not trusted')).toBeVisible();
    expect(screen.queryByRole('form', { name: 'Trust this device' })).toBeNull();
  });
});
