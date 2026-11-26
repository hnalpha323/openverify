import type { Permission } from '@openverify/core';
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../components/toasts';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../testing/api-routes';
import { fakeRequest } from '../../../testing/fake-request';
import { LIFECYCLE_IDS as IDS, inquiryDocument } from '../../../testing/lifecycle-fixtures';
import {
  SIGNAL_IDS,
  computedSignals,
  listMatch,
  matchList,
} from '../../../testing/signals-fixtures';
import InquiryPage from './page';
import { serveDecisions } from '../../../testing/routes/workflows';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const INQUIRY = `/dashboard/inquiries/${IDS.inquiry}`;
const MATCHES = '/list-matches';
let api: RouteApi;

const signIn = (...permissions: Permission[]) => {
  api.me({ permissions: ['inquiries:read', ...permissions] });
};

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  serveDecisions(api, []);
  signIn();
  api.on('GET', INQUIRY, 200, inquiryDocument(computedSignals()));
  api.on('GET', MATCHES, 200, matchList([listMatch()]));
});

afterEach(() => {
  api.restore();
});

const show = async () => {
  render(
    <ToastProvider>
      {await InquiryPage({
        params: Promise.resolve({ id: IDS.inquiry }),
        searchParams: Promise.resolve({}),
      })}
    </ToastProvider>,
  );
};
const region = (name: string) => screen.getByRole('region', { name });

describe('the inquiry Signals section (C108)', () => {
  it('shows the signals to anyone who reads the inquiry, grouped by layer', async () => {
    await show();

    const signals = region('Signals');
    expect(within(signals).getByRole('table', { name: 'Behaviour signals' })).toBeVisible();
    expect(signals).toHaveTextContent('12 of 100: no automation artefacts found');
  });
});

describe('the inquiry List matches section (C99, C108)', () => {
  it('shows the screening from the inquiry read, and the matches with lists:read', async () => {
    signIn('lists:read');

    await show();

    const section = region('List matches');
    expect(section).toHaveTextContent('Partly screened: some lists were not screened');
    expect(within(section).getByRole('rowheader', { name: SIGNAL_IDS.match })).toBeVisible();
    expect(Object.fromEntries(api.find('GET', MATCHES)?.query ?? [])).toMatchObject({
      'filter[inquiry-id]': IDS.inquiry,
    });
    expect(within(section).queryByRole('button', { name: /Dismiss/ })).toBeNull();
  });

  it('offers dismissal with lists:write', async () => {
    signIn('lists:read', 'lists:write');

    await show();

    expect(
      within(region('List matches')).getByRole('button', {
        name: `Dismiss list match ${SIGNAL_IDS.match}`,
      }),
    ).toBeVisible();
  });

  it('reads no matches without lists:read, and still shows the screening', async () => {
    await show();

    const section = region('List matches');
    expect(section).toHaveTextContent('Partly screened');
    expect(section).toHaveTextContent('Viewing the matches needs the lists:read permission.');
    expect(api.find('GET', MATCHES)).toBeUndefined();
  });

  it('shows the forbidden panel for the matches when the API refuses them', async () => {
    signIn('lists:read');
    api.onProblem('GET', MATCHES, 403, 'forbidden');

    await show();

    expect(within(region('List matches')).getByText('You do not have access')).toBeVisible();
  });
});
