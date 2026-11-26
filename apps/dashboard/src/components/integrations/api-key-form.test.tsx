import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import type { CreatedApiKey } from './action-data';
import { CreateApiKeyForm } from './api-key-form';
import { INTEGRATION_IDS, apiKeyToken } from './testing-fixtures';
import { ENVIRONMENTS } from '../../testing/api-mock';
import { later } from '../../testing/later';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

type Action = (
  state: ActionState<CreatedApiKey>,
  formData: FormData,
) => Promise<ActionResult<CreatedApiKey>>;

const SCOPES = ['inquiries:read', 'webhooks:read'];
const VERSIONS = ['2026-10-01'];

afterEach(() => {
  router.push.mockReset();
});

function renderForm(action: Action, piiMasked = false) {
  render(
    <CreateApiKeyForm
      action={action}
      scopes={SCOPES}
      apiVersions={VERSIONS}
      piiMasked={piiMasked}
      environmentId={ENVIRONMENTS.sandbox.id}
    />,
  );
}

describe('CreateApiKeyForm', () => {
  it('creates a key with the scopes, ranges and expiry chosen, then shows its token once', async () => {
    const token = apiKeyToken();
    const action = vi.fn<Action>(() =>
      Promise.resolve({ ok: true, data: { id: INTEGRATION_IDS.apiKey, secret: token } }),
    );
    renderForm(action);

    const scopes = screen.getByRole('group', { name: 'Scopes' });
    expect(within(scopes).getAllByRole('checkbox')).toHaveLength(2);
    await userEvent.type(screen.getByRole('textbox', { name: /Name/ }), 'CI deploys');
    await userEvent.click(within(scopes).getByRole('checkbox', { name: 'inquiries:read' }));
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Allowed IP ranges' }),
      '203.0.113.0/24',
    );
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Expires' }), 'In 7 days');
    await userEvent.click(screen.getByRole('button', { name: 'Create API key' }));

    const sent = action.mock.calls[0]?.[1];
    expect(sent?.get('name')).toBe('CI deploys');
    expect(sent?.getAll('scopes')).toEqual(['inquiries:read']);
    expect(sent?.get('allowed-ips')).toBe('203.0.113.0/24');
    expect(sent?.get('api-version')).toBe('2026-10-01');
    expect(sent?.get('expires-in-seconds')).toBe('604800');

    const dialog = await screen.findByRole('dialog', { name: 'API key created' });
    expect(within(dialog).getByRole('textbox', { name: 'Token' })).toHaveValue(token);
    expect(dialog).toHaveTextContent('Authorization: Bearer');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));

    expect(document.body.innerHTML).not.toContain(token);
    expect(router.push).toHaveBeenCalledExactlyOnceWith(`/api-keys/${INTEGRATION_IDS.apiKey}`);
  });

  it('says in the dialog when the key expires (C25.5)', async () => {
    renderForm(() =>
      later({
        ok: true,
        data: {
          id: INTEGRATION_IDS.apiKey,
          secret: apiKeyToken(),
          expiresAt: '2026-10-27T12:00:00.000Z',
        },
      }),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Create API key' }));

    const dialog = await screen.findByRole('dialog', { name: 'API key created' });
    expect(dialog).toHaveTextContent('It expires on Oct 27, 2026, 12:00 PM UTC.');
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('offers an expiry at a date and time in UTC, and shows its refusal at the field (C25.5)', async () => {
    const action = vi.fn<Action>(() =>
      later({
        ok: false,
        problem: {
          title: 'Check the values you entered',
          errors: [{ pointer: '/expires-at', detail: 'Choose a time in the future.' }],
        },
      }),
    );
    renderForm(action);
    expect(screen.queryByLabelText('Expires at (UTC)')).not.toBeInTheDocument();

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Expires' }),
      'At a date and time (UTC)',
    );
    const at = screen.getByLabelText('Expires at (UTC)');
    fireEvent.change(at, { target: { value: '2026-10-20T12:00:30' } });
    await userEvent.click(screen.getByRole('button', { name: 'Create API key' }));

    const sent = action.mock.calls[0]?.[1];
    expect(sent?.get('expires-in-seconds')).toBe('custom');
    // A browser may write the seconds with a fraction (`12:00:30.000`).
    expect(sent?.get('expires-at')).toMatch(/^2026-10-20T12:00:30(?:\.000)?$/);
    await waitFor(() => {
      expect(screen.getByLabelText('Expires at (UTC)')).toHaveAccessibleDescription(
        expect.stringContaining('Choose a time in the future.'),
      );
    });
    const posted = sent?.get('expires-at');
    expect(screen.getByLabelText('Expires at (UTC)')).toHaveValue(
      typeof posted === 'string' ? posted : null,
    );
  });

  it('explains that a key made by a role without pii:view does not see personal data', async () => {
    renderForm(
      () =>
        Promise.resolve({ ok: true, data: { id: INTEGRATION_IDS.apiKey, secret: apiKeyToken() } }),
      true,
    );

    expect(screen.getByRole('status')).toHaveTextContent('This key will not see personal data');

    await userEvent.click(screen.getByRole('button', { name: 'Create API key' }));

    expect(await screen.findByRole('dialog', { name: 'API key created' })).toHaveTextContent(
      'Like you, this key cannot see personal data.',
    );
  });

  it('says nothing about personal data to a role that sees it', () => {
    renderForm(vi.fn<Action>());

    expect(screen.queryByText(/will not see personal data/)).not.toBeInTheDocument();
  });

  it('keeps what was typed and points at the fields to correct', async () => {
    renderForm(() =>
      Promise.resolve({
        ok: false,
        problem: {
          title: 'Check the values you entered',
          errors: [
            { pointer: '/data/attributes/name', detail: 'Enter a name.' },
            { pointer: '/data/attributes/scopes', detail: 'needs at least one scope' },
            { pointer: '/data/attributes/allowed-ips/0', detail: 'nowhere is not a CIDR range' },
            { pointer: '/expires-in-seconds', detail: 'Choose from the list.' },
          ],
        },
      }),
    );
    const ranges = screen.getByRole('textbox', { name: 'Allowed IP ranges' });
    await userEvent.type(ranges, 'nowhere');

    await userEvent.click(screen.getByRole('button', { name: 'Create API key' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Check the values you entered');
    expect(ranges).toHaveValue('nowhere');
    expect(ranges).toHaveAccessibleDescription(
      expect.stringContaining('nowhere is not a CIDR range'),
    );
    expect(screen.getByRole('textbox', { name: /Name/ })).toHaveAccessibleDescription(
      'Enter a name.',
    );
    expect(screen.getByRole('group', { name: 'Scopes' })).toHaveAccessibleDescription(
      expect.stringContaining('needs at least one scope'),
    );
    expect(screen.getByRole('combobox', { name: 'Expires' })).toHaveAccessibleDescription(
      expect.stringContaining('Choose from the list.'),
    );
  });
});
