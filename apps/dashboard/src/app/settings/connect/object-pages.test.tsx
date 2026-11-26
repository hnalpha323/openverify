import type { Permission } from '@openverify/core';
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLONE_PROVENANCE } from '../../../components/connect/connect-fixtures';
import { ToastProvider } from '../../../components/toasts';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../testing/api-routes';
import { fakeRequest } from '../../../testing/fake-request';
import {
  LIFECYCLE_IDS as IDS,
  account,
  accountType,
  inquiryDocument,
  relations,
  single,
} from '../../../testing/lifecycle-fixtures';
import { serveTransaction } from '../../../testing/routes/transactions';
import { transaction, transactionType } from '../../../testing/transactions-fixtures';
import AccountPage from '../../accounts/[id]/page';
import InquiryPage from '../../inquiries/[id]/page';
import TransactionPage from '../../transactions/[id]/page';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const slot = vi.hoisted(() => vi.fn());
vi.mock('../../../components/connect/object-connect-section', () => ({
  ObjectConnectSection: slot,
}));

// The decision records slot reads `GET /decisions`; it is another agent's and not under test here.
vi.mock('../../../components/workflows/inquiry-decisions-section', () => ({
  InquiryDecisionsSection: () => Promise.resolve(null),
}));

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  slot.mockReset();
  slot.mockResolvedValue(<p>The Connect slot</p>);
});

afterEach(() => {
  api.restore();
});

const connectRegion = () => screen.getByRole('region', { name: 'Connect' });

/**
 * The Connect section on the three object pages (C242.3, C242.4; console-connect's named borrowed
 * edits): a loadSection line and a SlotSection line for inquiries and accounts, and one section on
 * the transaction page, which has no slot.
 */
describe('the Connect section of the object pages', () => {
  it('is on the inquiry page, with the inquiry’s provenance and its verifications', async () => {
    const permissions: Permission[] = ['inquiries:read', 'verifications:read'];
    api.me({ permissions });
    const document = inquiryDocument({ provenance: CLONE_PROVENANCE });
    api.on('GET', `/dashboard/inquiries/${IDS.inquiry}`, 200, document);

    render(
      <ToastProvider>
        {await InquiryPage({
          params: Promise.resolve({ id: IDS.inquiry }),
          searchParams: Promise.resolve({}),
        })}
      </ToastProvider>,
    );

    expect(slot).toHaveBeenCalledWith({
      subjectId: IDS.inquiry,
      permissions: new Set(permissions),
      provenance: CLONE_PROVENANCE,
      verifications: document.included
        .filter((resource) => resource.type.startsWith('verification/'))
        .map((resource) => ({
          id: resource.id,
          type: resource.type,
          status: (resource.attributes as { status: string }).status,
        })),
    });
    expect(within(connectRegion()).getByText('The Connect slot')).toBeVisible();
  });

  it('leaves the inquiry page without the section when the slot has nothing to show', async () => {
    slot.mockResolvedValue(null);
    api.me({ permissions: ['inquiries:read'] });
    api.on('GET', `/dashboard/inquiries/${IDS.inquiry}`, 200, inquiryDocument());

    render(
      <ToastProvider>
        {await InquiryPage({
          params: Promise.resolve({ id: IDS.inquiry }),
          searchParams: Promise.resolve({}),
        })}
      </ToastProvider>,
    );

    expect(screen.queryByRole('region', { name: 'Connect' })).toBeNull();
  });

  it('is on the account page', async () => {
    api.me({ permissions: ['accounts:read'] });
    api.on('GET', `/accounts/${IDS.account}`, 200, single(account()));
    api.on('GET', `/accounts/${IDS.account}/relations`, 200, relations([]));
    api.on('GET', `/account-types/${IDS.accountType}`, 200, single(accountType()));

    render(
      <ToastProvider>
        {await AccountPage({
          params: Promise.resolve({ id: IDS.account }),
          searchParams: Promise.resolve({}),
        })}
      </ToastProvider>,
    );

    expect(slot).toHaveBeenCalledWith({
      subjectId: IDS.account,
      permissions: new Set(['accounts:read']),
    });
    expect(within(connectRegion()).getByText('The Connect slot')).toBeVisible();
  });

  it('is on the transaction page', async () => {
    api.me({ permissions: ['transactions:read'] });
    const resource = transaction();
    serveTransaction(api, resource, transactionType());

    render(
      <ToastProvider>
        {await TransactionPage({
          params: Promise.resolve({ id: resource.id }),
          searchParams: Promise.resolve({}),
        })}
      </ToastProvider>,
    );

    expect(slot).toHaveBeenCalledWith({
      subjectId: resource.id,
      permissions: new Set(['transactions:read']),
    });
    expect(within(connectRegion()).getByText('The Connect slot')).toBeVisible();
  });
});
