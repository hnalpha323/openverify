import type { Permission } from '@openverify/core';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import { rscPayloadOf } from '../../testing/rsc-payload';
import {
  serveAvailableAccountActions,
  serveRunAccountAction,
} from '../../testing/routes/workflows';
import { WORKFLOW_IDS as IDS, availableAccountAction } from '../../testing/workflow-fixtures';
import { ToastProvider } from '../toasts';
import { AccountActionsSection } from './account-actions-section';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const TRIGGER: Permission[] = ['accounts:read', 'workflows:trigger', 'pii:view'];
let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: TRIGGER });
});

afterEach(() => {
  api.restore();
});

const section = (permissions: Permission[] = TRIGGER) =>
  AccountActionsSection({ accountId: IDS.account, permissions: new Set(permissions) });

const show = async (permissions?: Permission[]) => {
  render(<ToastProvider>{await section(permissions)}</ToastProvider>);
};

describe('AccountActionsSection (C118.7, C141.7)', () => {
  it('offers each action the API lists, with its workflow', async () => {
    serveAvailableAccountActions(api, IDS.account, [availableAccountAction()]);

    await show();

    const group = screen.getByRole('group', { name: 'Workflow actions of this account' });
    expect(within(group).getByRole('button', { name: 'Re-screen this account' })).toBeVisible();
    expect(screen.getByRole('link', { name: IDS.workflow })).toHaveAttribute(
      'href',
      `/workflows/${IDS.workflow}`,
    );
  });

  it('leaves the section out when no action may be run here', async () => {
    serveAvailableAccountActions(api, IDS.account, []);

    expect(await section()).toBeNull();
  });

  it('opens the parameter form prefilled as the API served it, a masked value left empty', async () => {
    serveAvailableAccountActions(api, IDS.account, [
      availableAccountAction([
        { name: 'reason', type: 'string', required: true, 'prefilled-value': null },
        { name: 'priority', type: 'integer', required: false, 'prefilled-value': 3 },
      ]),
    ]);
    const user = userEvent.setup();
    await show();

    await user.click(screen.getByRole('button', { name: 'Re-screen this account' }));

    const dialog = screen.getByRole('dialog', { name: 'Run “Re-screen this account”?' });
    const reason = within(dialog).getByRole('textbox', { name: /reason/ });
    expect(reason).toHaveValue('');
    expect(reason).toBeRequired();
    expect(within(dialog).getByRole('spinbutton', { name: /priority/ })).toHaveValue(3);
    expect(dialog).toHaveTextContent('A value hidden from you stays empty');
  });

  it('runs it with typed parameters and links the run it started', async () => {
    serveAvailableAccountActions(api, IDS.account, [
      availableAccountAction([
        { name: 'reason', type: 'string', required: true, 'prefilled-value': null },
        { name: 'priority', type: 'integer', required: false, 'prefilled-value': 3 },
      ]),
    ]);
    serveRunAccountAction(api, IDS.account, IDS.run);
    const user = userEvent.setup();
    await show();

    await user.click(screen.getByRole('button', { name: 'Re-screen this account' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByRole('textbox', { name: /reason/ }), 'Field changed');
    await user.click(within(dialog).getByRole('button', { name: 'Run action' }));

    await vi.waitFor(() => {
      expect(api.find('POST', `/accounts/${IDS.account}/run-action`)?.body).toEqual({
        data: {
          'account-action-id': IDS.accountAction,
          parameters: { reason: 'Field changed', priority: 3 },
        },
      });
    });
    expect(await screen.findByRole('link', { name: IDS.run })).toHaveAttribute(
      'href',
      `/workflows/runs/${IDS.run}`,
    );
  });

  it('carries no prefilled value the API did not send', async () => {
    serveAvailableAccountActions(api, IDS.account, [
      availableAccountAction([
        { name: 'email', type: 'string', required: false, 'prefilled-value': null },
      ]),
    ]);

    expect(await rscPayloadOf(await section(['accounts:read', 'workflows:trigger']))).not.toContain(
      'example.com',
    );
  });
});
