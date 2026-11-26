import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ToastProvider } from '../toasts';
import type { CreatedWebhook, RotatedSecret } from './action-data';
import { INTEGRATION_IDS, webhookSecret } from './testing-fixtures';
import { WebhookActions, type WebhookActionsProps } from './webhook-actions';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

type Action<Data = undefined> = (
  state: ActionState<Data>,
  formData: FormData,
) => Promise<ActionResult<Data>>;

const ok = <Data,>(data: Data) => vi.fn<Action<Data>>(() => Promise.resolve({ ok: true, data }));

function renderActions(overrides: Partial<WebhookActionsProps> = {}) {
  const actions = {
    enable: ok(undefined),
    disable: ok(undefined),
    archive: ok(undefined),
    clone: ok<CreatedWebhook>({
      id: INTEGRATION_IDS.clonedWebhook,
      secret: webhookSecret('c', 'Cl0n'),
    }),
    rotate: ok<RotatedSecret>({
      secret: webhookSecret('r', 'R0ta'),
      previousSecretExpiresAt: '2026-10-21T04:35:00.000Z',
    }),
  };
  render(
    <ToastProvider>
      <WebhookActions
        webhookId={INTEGRATION_IDS.webhook}
        status="enabled"
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

describe('WebhookActions', () => {
  it('offers every change an enabled webhook allows', () => {
    renderActions();

    expect(screen.getByRole('link', { name: 'Edit' })).toHaveAttribute(
      'href',
      `/webhooks/${INTEGRATION_IDS.webhook}/edit`,
    );
    for (const name of ['Disable', 'Rotate secret', 'Clone', 'Archive']) {
      expect(screen.getByRole('button', { name })).toBeVisible();
    }
    expect(screen.queryByRole('button', { name: 'Enable' })).not.toBeInTheDocument();
  });

  it('enables a disabled webhook', async () => {
    const actions = renderActions({ status: 'disabled' });

    await userEvent.click(screen.getByRole('button', { name: 'Enable' }));

    expect(await screen.findByRole('status')).toHaveTextContent('The webhook is enabled.');
    expect(actions.enable.mock.calls[0]?.[1].get('webhook-id')).toBe(INTEGRATION_IDS.webhook);
    expect(screen.queryByRole('button', { name: 'Disable' })).not.toBeInTheDocument();
  });

  it('disables an enabled webhook', async () => {
    const actions = renderActions();

    await userEvent.click(screen.getByRole('button', { name: 'Disable' }));

    expect(await screen.findByRole('status')).toHaveTextContent('The webhook is disabled.');
    expect(actions.disable).toHaveBeenCalledOnce();
  });

  it('offers only a clone of an archived webhook, and says why', () => {
    renderActions({ status: 'archived' });

    expect(screen.getByRole('button', { name: 'Clone' })).toBeVisible();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
    expect(
      screen.getByText('An archived webhook never receives events again and cannot change.'),
    ).toBeVisible();
  });

  it('archives after asking', async () => {
    const actions = renderActions();

    await userEvent.click(screen.getByRole('button', { name: 'Archive' }));
    const dialog = screen.getByRole('dialog', { name: 'Archive this webhook?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Archive webhook' }));

    expect(await screen.findByRole('status')).toHaveTextContent('The webhook is archived.');
    expect(actions.archive.mock.calls[0]?.[1].get('webhook-id')).toBe(INTEGRATION_IDS.webhook);
  });

  it('rotates the secret with the overlap chosen, and shows the new secret once', async () => {
    const actions = renderActions();

    await userEvent.click(screen.getByRole('button', { name: 'Rotate secret' }));
    const dialog = screen.getByRole('dialog', { name: 'Rotate the signing secret?' });
    const overlap = within(dialog).getByRole('spinbutton', { name: 'Overlap in seconds' });
    expect(overlap).toHaveValue(86_400);
    await userEvent.clear(overlap);
    await userEvent.type(overlap, '3600');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rotate' }));

    const reveal = await screen.findByRole('dialog', { name: 'New signing secret' });
    expect(within(reveal).getByRole('textbox', { name: 'Signing secret' })).toHaveValue(
      webhookSecret('r', 'R0ta'),
    );
    expect(reveal).toHaveTextContent(
      'The previous secret also signs deliveries until Oct 21, 2026, 4:35 AM UTC.',
    );
    const sent = actions.rotate.mock.calls[0]?.[1];
    expect(sent?.get('webhook-id')).toBe(INTEGRATION_IDS.webhook);
    expect(sent?.get('previous-secret-expires-in-seconds')).toBe('3600');
  });

  it("clones the webhook, shows the clone's secret once, then opens the clone", async () => {
    renderActions();

    await userEvent.click(screen.getByRole('button', { name: 'Clone' }));
    await userEvent.click(screen.getByRole('button', { name: 'Clone webhook' }));
    const reveal = await screen.findByRole('dialog', { name: 'Webhook cloned' });
    expect(within(reveal).getByRole('textbox', { name: 'Signing secret' })).toHaveValue(
      webhookSecret('c', 'Cl0n'),
    );

    await userEvent.click(within(reveal).getByRole('button', { name: 'Done' }));

    expect(router.push).toHaveBeenCalledExactlyOnceWith(
      `/webhooks/${INTEGRATION_IDS.clonedWebhook}`,
    );
  });
});
