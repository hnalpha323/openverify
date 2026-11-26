import type { Permission } from '@openverify/core';
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../components/toasts';
import { ForbiddenError } from '../../../lib/api/errors';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../testing/api-routes';
import { fakeRequest } from '../../../testing/fake-request';
import { LIFECYCLE_IDS as IDS, inquiryDocument } from '../../../testing/lifecycle-fixtures';
import InquiryPage from './page';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const slot = vi.hoisted(() => vi.fn());

vi.mock('../../../components/workflows/inquiry-decisions-section', () => ({
  InquiryDecisionsSection: slot,
}));

const NAME = 'Decision records';
let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  slot.mockReset();
  slot.mockResolvedValue(<p>The decisions slot</p>);
});

afterEach(() => {
  api.restore();
});

const show = async (permissions: Permission[], attributes = {}) => {
  api.me({ permissions });
  api.on('GET', `/dashboard/inquiries/${IDS.inquiry}`, 200, inquiryDocument(attributes));
  render(
    <ToastProvider>
      {await InquiryPage({
        params: Promise.resolve({ id: IDS.inquiry }),
        searchParams: Promise.resolve({}),
      })}
    </ToastProvider>,
  );
};

describe('the inquiry page decision records slot (C128.1, C142.4, F32)', () => {
  it('calls it with the inquiry, its status, whether it was redacted and the permissions', async () => {
    await show(['inquiries:read', 'inquiries:write'], { status: 'declined' });

    expect(slot).toHaveBeenCalledTimes(1);
    expect(slot).toHaveBeenCalledWith({
      inquiryId: IDS.inquiry,
      status: 'declined',
      redacted: false,
      permissions: new Set(['inquiries:read', 'inquiries:write']),
    });
    expect(
      within(screen.getByRole('region', { name: NAME })).getByText('The decisions slot'),
    ).toBeVisible();
  });

  it('tells it a redacted inquiry is redacted', async () => {
    await show(['inquiries:read'], { 'redacted-at': '2026-10-01T00:00:00.000Z' });

    expect(slot).toHaveBeenCalledWith(expect.objectContaining({ redacted: true }));
  });

  it('shows the forbidden panel in the section when the API refuses its read', async () => {
    slot.mockRejectedValue(new ForbiddenError(['inquiries:read']));

    await show(['inquiries:read']);

    expect(
      within(screen.getByRole('region', { name: NAME })).getByText('You do not have access'),
    ).toBeVisible();
  });

  it('leaves the section out when the slot renders nothing', async () => {
    slot.mockResolvedValue(null);

    await show(['inquiries:read']);

    expect(screen.queryByRole('region', { name: NAME })).toBeNull();
  });
});
