import type { Permission } from '@openverify/core';
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../components/toasts';
import { ForbiddenError } from '../../../lib/api/errors';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../testing/api-routes';
import { fakeRequest } from '../../../testing/fake-request';
import {
  LIFECYCLE_IDS as IDS,
  account,
  accountType,
  relations,
  single,
} from '../../../testing/lifecycle-fixtures';
import AccountPage from './page';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const slot = vi.hoisted(() => vi.fn());

vi.mock('../../../components/workflows/account-actions-section', () => ({
  AccountActionsSection: slot,
}));

const ACCOUNT = `/accounts/${IDS.account}`;
const NAME = 'Workflow actions';
let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.on('GET', ACCOUNT, 200, single(account()));
  api.on('GET', `${ACCOUNT}/relations`, 200, relations([]));
  api.on('GET', `/account-types/${IDS.accountType}`, 200, single(accountType()));
  slot.mockReset();
  slot.mockResolvedValue(<p>The actions slot</p>);
});

afterEach(() => {
  api.restore();
});

const show = async (permissions: Permission[]) => {
  api.me({ permissions });
  render(
    <ToastProvider>
      {await AccountPage({
        params: Promise.resolve({ id: IDS.account }),
        searchParams: Promise.resolve({}),
      })}
    </ToastProvider>,
  );
};

describe('the account page workflow actions slot (C118.7, C141.7, F32)', () => {
  it('calls it with the account id and the permissions, under workflows:trigger', async () => {
    await show(['accounts:read', 'workflows:trigger']);

    expect(slot).toHaveBeenCalledTimes(1);
    expect(slot).toHaveBeenCalledWith({
      accountId: IDS.account,
      permissions: new Set(['accounts:read', 'workflows:trigger']),
    });
    expect(
      within(screen.getByRole('region', { name: NAME })).getByText('The actions slot'),
    ).toBeVisible();
  });

  it('never calls it, and shows no section, without workflows:trigger', async () => {
    await show(['accounts:read', 'workflows:read']);

    expect(slot).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: NAME })).toBeNull();
  });

  it('shows the forbidden panel in the section when the API refuses its read', async () => {
    slot.mockRejectedValue(new ForbiddenError(['workflows:trigger']));

    await show(['accounts:read', 'workflows:trigger']);

    expect(
      within(screen.getByRole('region', { name: NAME })).getByText('You do not have access'),
    ).toBeVisible();
  });

  it('leaves the section out when the slot renders nothing', async () => {
    slot.mockResolvedValue(null);

    await show(['accounts:read', 'workflows:trigger']);

    expect(screen.queryByRole('region', { name: NAME })).toBeNull();
  });
});
