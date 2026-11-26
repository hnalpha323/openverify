import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { OneTimeLinkButton, type OneTimeLink } from './one-time-link-button';

type Action = (
  state: ActionState<OneTimeLink>,
  formData: FormData,
) => Promise<ActionResult<OneTimeLink>>;

const ID = 'inq_01JB0000000000000000000001';
const LINK = `https://flow.example.test/#inquiry-id=${ID}&one-time-token=ovo_${'T'.repeat(43)}`;

afterEach(() => {
  vi.restoreAllMocks();
});

function renderButton(action: Action) {
  render(<OneTimeLinkButton inquiryId={ID} action={action} />);
}

describe('OneTimeLinkButton', () => {
  it('generates a link and shows it once, with its expiry', async () => {
    const action = vi.fn<Action>(() =>
      Promise.resolve({ ok: true, data: { link: LINK, expiresAt: '2026-10-20T05:35:00.000Z' } }),
    );
    renderButton(action);

    await userEvent.click(screen.getByRole('button', { name: 'Generate one-time link' }));
    const form = screen.getByRole('dialog', { name: 'Generate a one-time link' });
    expect(within(form).getByRole('combobox', { name: 'Link lifetime' })).toHaveValue('');
    await userEvent.selectOptions(
      within(form).getByRole('combobox', { name: 'Link lifetime' }),
      '3600',
    );
    await userEvent.click(within(form).getByRole('button', { name: 'Generate link' }));

    const secret = await screen.findByRole('dialog', { name: 'One-time link' });
    expect(within(secret).getByRole('textbox', { name: 'Link' })).toHaveValue(LINK);
    expect(secret).toHaveTextContent('Oct 20, 2026');
    const sent = action.mock.calls[0]?.[1];
    expect(sent?.get('inquiry-id')).toBe(ID);
    expect(sent?.get('expires-in-seconds')).toBe('3600');
  });

  it('drops the link when the dialog closes, never storing it', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    renderButton(() =>
      Promise.resolve({ ok: true, data: { link: LINK, expiresAt: '2026-10-20T05:35:00.000Z' } }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Generate one-time link' }));
    await userEvent.click(screen.getByRole('button', { name: 'Generate link' }));
    await screen.findByRole('dialog', { name: 'One-time link' });

    await userEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('ovo_');
    expect(screen.queryByDisplayValue(LINK)).not.toBeInTheDocument();
    expect(setItem).not.toHaveBeenCalled();
    expect(window.location.href).not.toContain('ovo_');
  });

  it("shows the API's refusal in the form", async () => {
    renderButton(() =>
      Promise.resolve({
        ok: false,
        problem: { title: 'Conflict', detail: 'Only open inquiries get one-time links.' },
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Generate one-time link' }));

    await userEvent.click(screen.getByRole('button', { name: 'Generate link' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only open inquiries get one-time links.',
    );
    expect(screen.getByRole('dialog', { name: 'Generate a one-time link' })).toBeVisible();
  });

  it('closes the form without generating anything', async () => {
    const action = vi.fn<Action>();
    renderButton(action);
    await userEvent.click(screen.getByRole('button', { name: 'Generate one-time link' }));

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(action).not.toHaveBeenCalled();
  });
});
