import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionResult } from '../lib/action-state';
import type { FactorActivated } from '../lib/mfa-enrolment';
import { ToastProvider } from './toasts';
import { WebauthnEnrolment } from './webauthn-enrolment';

const browser = vi.hoisted(() => ({ startRegistration: vi.fn() }));
vi.mock('@simplewebauthn/browser', () => browser);

type Start = () => Promise<ActionResult<{ options: Record<string, unknown> }>>;
type Finish = (input: {
  credential: unknown;
  name?: string;
}) => Promise<ActionResult<FactorActivated>>;

const OPTIONS = { challenge: 'Y2hhbGxlbmdl' };
const CREDENTIAL = { id: 'Y3JlZA', rawId: 'Y3JlZA', type: 'public-key' };
const CODES = Array.from(
  { length: 10 },
  (_, index) => `ABCD-EFGH-JK${String(index).padStart(2, '0')}`,
);

function setup(start: Start, finish: Finish) {
  render(
    <ToastProvider>
      <WebauthnEnrolment start={start} finish={finish} />
    </ToastProvider>,
  );
}

async function register(name = 'Laptop key') {
  await userEvent.click(screen.getByRole('button', { name: 'Add a security key' }));
  if (name !== '') {
    await userEvent.type(screen.getByRole('textbox', { name: 'Name (optional)' }), name);
  }
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

beforeEach(() => {
  browser.startRegistration.mockReset();
});

describe('WebauthnEnrolment', () => {
  it('runs the registration ceremony and names the key', async () => {
    browser.startRegistration.mockResolvedValueOnce(CREDENTIAL);
    const finish = vi.fn<Finish>(() =>
      Promise.resolve({ ok: true, data: { recoveryCodes: null } }),
    );
    setup(() => Promise.resolve({ ok: true, data: { options: OPTIONS } }), finish);

    await register();

    expect(browser.startRegistration).toHaveBeenCalledExactlyOnceWith({ optionsJSON: OPTIONS });
    expect(finish).toHaveBeenCalledExactlyOnceWith({ credential: CREDENTIAL, name: 'Laptop key' });
    expect(await screen.findByRole('status')).toHaveTextContent('Security key added.');
  });

  it('shows the first recovery codes once', async () => {
    browser.startRegistration.mockResolvedValueOnce(CREDENTIAL);
    setup(
      () => Promise.resolve({ ok: true, data: { options: OPTIONS } }),
      () => Promise.resolve({ ok: true, data: { recoveryCodes: CODES } }),
    );

    await register('');

    expect(await screen.findByRole('dialog', { name: 'Save your recovery codes' })).toBeVisible();
  });

  it('says so when the browser gets no answer from the key', async () => {
    browser.startRegistration.mockRejectedValueOnce(new DOMException('no', 'NotAllowedError'));
    const finish = vi.fn<Finish>();
    setup(() => Promise.resolve({ ok: true, data: { options: OPTIONS } }), finish);

    await register();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The security key did not respond. Try again.',
    );
    expect(finish).not.toHaveBeenCalled();
  });

  it("shows the API's problem", async () => {
    setup(
      () => Promise.resolve({ ok: false, problem: { title: 'Service Unavailable' } }),
      vi.fn<Finish>(),
    );

    await register();

    expect(await screen.findByRole('alert')).toHaveTextContent('Service Unavailable');
    expect(browser.startRegistration).not.toHaveBeenCalled();
  });
});
