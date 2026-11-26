/**
 * Trust Device (C127.9): the mark with who set it and why, and the words that trusting a device
 * changes no check or signal. Trust takes a snake_case reason code; untrust clears the mark.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { later } from '../../testing/later';
import { device } from '../../testing/signals-fixtures';
import { ToastProvider } from '../toasts';
import { DeviceTrust } from './device-trust';

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;
const INQUIRY = 'inq_01MB0000000000000000000009';
const RUN = 'wfr_01MB0000000000000000000001';
const ok = vi.fn<Action>(() => later({ ok: true, data: undefined }));

const show = (resource: ReturnType<typeof device>, action: Action | null) =>
  render(
    <ToastProvider>
      <dl>
        <DeviceTrust inquiryId={INQUIRY} device={resource} action={action} />
      </dl>
    </ToastProvider>,
  );

describe('DeviceTrust (C127.9)', () => {
  it('says an untrusted device is not trusted, and that the mark changes no check or signal', () => {
    show(device(), null);

    expect(screen.getByText('Not trusted')).toBeVisible();
    expect(screen.getByText(/Trusting a device changes no check and no signal/)).toBeVisible();
    expect(screen.queryByRole('button', { name: /Trust/ })).toBeNull();
  });

  it('shows when, by whom and why a device was trusted, a run linking its page', () => {
    show(
      device({
        'trusted-at': '2026-11-01T09:05:00.000Z',
        'trusted-by': { type: 'workflow-run', id: RUN },
        'trust-reason': 'known_customer_device',
      }),
      null,
    );

    const mark = screen.getByText(/Trusted for known_customer_device/);
    expect(mark).toBeVisible();
    expect(screen.getByRole('link', { name: RUN })).toHaveAttribute(
      'href',
      `/workflows/runs/${RUN}`,
    );
  });

  it('trusts a device with a reason code, with devices:write', async () => {
    const user = userEvent.setup();
    const action = vi.fn<Action>(() => later({ ok: true, data: undefined }));
    show(device(), action);

    const form = screen.getByRole('form', { name: 'Trust this device' });
    await user.type(
      within(form).getByRole('textbox', { name: /Reason code/ }),
      'known_customer_device',
    );
    await user.click(within(form).getByRole('button', { name: 'Trust' }));

    expect(await screen.findByText('The device is trusted.')).toBeVisible();
    const sent = action.mock.calls[0]?.[1];
    expect(sent?.get('device-id')).toBe(device().id);
    expect(sent?.get('inquiry-id')).toBe(INQUIRY);
    expect(sent?.get('mode')).toBe('trust');
    expect(sent?.get('trust-reason')).toBe('known_customer_device');
  });

  it('clears the mark of a trusted device', async () => {
    const user = userEvent.setup();
    const action = vi.fn<Action>(() => later({ ok: true, data: undefined }));
    show(
      device({
        'trusted-at': '2026-11-01T09:05:00.000Z',
        'trusted-by': { type: 'user', id: 'usr_01MB0000000000000000000001' },
        'trust-reason': 'known_customer_device',
      }),
      action,
    );

    await user.click(screen.getByRole('button', { name: 'Remove the trust mark' }));

    expect(await screen.findByText('The trust mark was removed.')).toBeVisible();
    expect(action.mock.calls[0]?.[1].get('mode')).toBe('untrust');
    expect(ok).not.toHaveBeenCalled();
  });
});
