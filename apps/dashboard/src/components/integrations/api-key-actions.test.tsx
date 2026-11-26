import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ToastProvider } from '../toasts';
import type { CreatedApiKey, RotatedApiKeyData } from './action-data';
import { ApiKeyActions, type ApiKeyActionsProps } from './api-key-actions';
import { INTEGRATION_IDS, apiKeyToken } from './testing-fixtures';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

type Action<Data = undefined> = (
  state: ActionState<Data>,
  formData: FormData,
) => Promise<ActionResult<Data>>;

function renderActions(overrides: Partial<ApiKeyActionsProps> = {}) {
  const actions = {
    update: vi.fn<Action>(() => Promise.resolve({ ok: true, data: undefined })),
    expire: vi.fn<Action>(() => Promise.resolve({ ok: true, data: undefined })),
    clone: vi.fn<Action<CreatedApiKey>>(() =>
      Promise.resolve({
        ok: true,
        data: { id: INTEGRATION_IDS.clonedApiKey, secret: apiKeyToken('c') },
      }),
    ),
    rotate: vi.fn<Action<RotatedApiKeyData>>(() =>
      Promise.resolve({
        ok: true,
        data: {
          id: 'key_01J9ZK3M5Q0000000000000069',
          secret: apiKeyToken('r'),
          previousExpiresAt: '2026-10-21T04:40:00.000Z',
        },
      }),
    ),
  };
  render(
    <ToastProvider>
      <ApiKeyActions
        apiKeyId={INTEGRATION_IDS.apiKey}
        name="CI deploys"
        allowedIps={['203.0.113.0/24', '2001:db8::/32']}
        expired={false}
        piiMasked={false}
        {...actions}
        {...overrides}
      />
    </ToastProvider>,
  );
  return actions;
}

afterEach(() => {
  router.push.mockReset();
});

describe('ApiKeyActions', () => {
  it('renames the key and changes its ranges', async () => {
    const actions = renderActions();

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit the API key' });
    const name = within(dialog).getByRole('textbox', { name: 'Name' });
    expect(name).toHaveValue('CI deploys');
    expect(within(dialog).getByRole('textbox', { name: 'Allowed IP ranges' })).toHaveValue(
      '203.0.113.0/24\n2001:db8::/32',
    );
    await userEvent.clear(name);
    await userEvent.type(name, 'Deploys');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('status')).toHaveTextContent('The API key was saved.');
    const sent = actions.update.mock.calls[0]?.[1];
    expect(sent?.get('api-key-id')).toBe(INTEGRATION_IDS.apiKey);
    expect(sent?.get('name')).toBe('Deploys');
  });

  it('points at the field the API refused', async () => {
    renderActions({
      update: () =>
        Promise.resolve({
          ok: false,
          problem: {
            title: 'Check the values you entered',
            errors: [
              { pointer: '/data/attributes/name', detail: 'Enter a name.' },
              { pointer: '/data/attributes/allowed-ips/0', detail: 'not a CIDR range' },
            ],
          },
        }),
    });

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await screen.findByRole('alert');
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveAccessibleDescription(
      'Enter a name.',
    );
    expect(screen.getByRole('textbox', { name: 'Allowed IP ranges' })).toHaveAccessibleDescription(
      expect.stringContaining('not a CIDR range'),
    );
  });

  it('expires the key at the time chosen', async () => {
    const actions = renderActions();

    await userEvent.click(screen.getByRole('button', { name: 'Expire' }));
    const dialog = screen.getByRole('dialog', { name: 'Expire this API key?' });
    expect(within(dialog).getByRole('combobox', { name: 'When' })).toHaveValue('0');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Expire key' }));

    expect(await screen.findByRole('status')).toHaveTextContent('The API key expiry is set.');
    const sent = actions.expire.mock.calls[0]?.[1];
    expect(sent?.get('api-key-id')).toBe(INTEGRATION_IDS.apiKey);
    expect(sent?.get('expires-in-seconds')).toBe('0');
  });

  it('says a copy made by a role without pii:view does not see personal data', async () => {
    renderActions({ piiMasked: true });

    await userEvent.click(screen.getByRole('button', { name: 'Clone' }));

    expect(screen.getByRole('dialog', { name: 'Clone this API key?' })).toHaveTextContent(
      'Your role cannot see personal data, so the copy cannot either.',
    );
  });

  it('says a copy of a key that sees personal data masked is masked too (C25.6)', async () => {
    renderActions({ maskedKey: true });

    await userEvent.click(screen.getByRole('button', { name: 'Clone' }));

    const dialog = screen.getByRole('dialog', { name: 'Clone this API key?' });
    expect(dialog).toHaveTextContent('Like this key, the copy cannot see personal data.');
    expect(dialog).not.toHaveTextContent('Your role cannot see personal data');
  });

  it('offers no expiry for a key that has expired', () => {
    renderActions({ expired: true });

    expect(screen.queryByRole('button', { name: 'Expire' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clone' })).toBeVisible();
  });

  it("clones the key, shows the clone's token once, then opens the clone", async () => {
    const actions = renderActions();

    await userEvent.click(screen.getByRole('button', { name: 'Clone' }));
    const dialog = screen.getByRole('dialog', { name: 'Clone this API key?' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Name of the copy' }), 'Copy');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Clone key' }));

    const reveal = await screen.findByRole('dialog', { name: 'API key cloned' });
    expect(within(reveal).getByRole('textbox', { name: 'Token' })).toHaveValue(apiKeyToken('c'));
    expect(actions.clone.mock.calls[0]?.[1].get('name')).toBe('Copy');

    await userEvent.click(within(reveal).getByRole('button', { name: 'Done' }));

    expect(router.push).toHaveBeenCalledExactlyOnceWith(
      `/api-keys/${INTEGRATION_IDS.clonedApiKey}`,
    );
  });
});

describe('ApiKeyActions: Workflow 9C (C169.1, C169.3)', () => {
  it('rotates in one dialog: how long the old token keeps working, then the new token once with the old one’s end', async () => {
    const actions = renderActions();

    await userEvent.click(screen.getByRole('button', { name: 'Rotate' }));
    const dialog = screen.getByRole('dialog', { name: 'Rotate this API key?' });
    expect(dialog).toHaveAccessibleDescription(
      'A new key gets the same scopes, allowed IP ranges, API version, note and attribute blocklist, and a new token. The old token keeps working until the time you choose, so you can switch your systems over.',
    );
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: 'The old token keeps working' }),
      'For 1 day',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rotate key' }));

    const reveal = await screen.findByRole('dialog', { name: 'API key rotated' });
    expect(within(reveal).getByRole('textbox', { name: 'New token' })).toHaveValue(
      apiKeyToken('r'),
    );
    expect(reveal).toHaveTextContent(
      'The old token keeps working until Oct 21, 2026, 4:40 AM (UTC).',
    );
    expect(actions.rotate.mock.calls[0]?.[1].get('previous-expires-in-seconds')).toBe('86400');

    await userEvent.click(within(reveal).getByRole('button', { name: 'Done' }));
    expect(router.push).toHaveBeenCalledExactlyOnceWith('/api-keys/key_01J9ZK3M5Q0000000000000069');
  });

  it('edits the note and the attribute blocklist with the name', async () => {
    const actions = renderActions({
      note: 'For CI',
      attributeBlocklist: ['name-first', 'birthdate'],
    });

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit the API key' });
    expect(within(dialog).getByRole('textbox', { name: 'Note' })).toHaveValue('For CI');
    expect(within(dialog).getByRole('textbox', { name: 'Attribute blocklist' })).toHaveValue(
      'name-first\nbirthdate',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await screen.findByRole('status');
    expect(actions.update.mock.calls[0]?.[1].get('attribute-blocklist')).toBe(
      'name-first\nbirthdate',
    );
  });

  it('offers no rotation for an expired key', () => {
    renderActions({ expired: true });

    expect(screen.queryByRole('button', { name: 'Rotate' })).toBeNull();
  });
});
