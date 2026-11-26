import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsoleLayout } from '../../components/console-layout';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import { trustAnchorsDocument } from '../../testing/fixtures/government-id-nfc';
import { TRUST_ANCHORS_PATH, serveTrustAnchors } from '../../testing/routes/documents';
import TrustAnchorsError from './error';
import TrustAnchorsLayout from './layout';
import Loading from './loading';
import TrustAnchorsPage, { metadata } from './page';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
});

afterEach(() => {
  api.restore();
  vi.restoreAllMocks();
});

describe('the chip trust store page (C62.10, C66)', () => {
  it('reads the trust store with settings:read and shows it read-only', async () => {
    api.me({ permissions: ['settings:read'] });
    serveTrustAnchors(api, trustAnchorsDocument());

    render(await TrustAnchorsPage());

    expect(screen.getByRole('heading', { level: 1, name: 'Chip trust store' })).toBeVisible();
    expect(screen.getByRole('table', { name: 'Trust anchor sources' })).toBeVisible();
    expect(api.find('GET', TRUST_ANCHORS_PATH)).toBeDefined();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    // Each section is a region named by its own heading.
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual([
      'Summary',
      'Sources',
      'Anchors per country',
      'Withdrawn anchors',
      'Certificate revocation lists',
      'Sandbox anchors',
    ]);
  });

  it('shows the forbidden panel without settings:read, without reading the store', async () => {
    api.me({ permissions: ['inquiries:read', 'verifications:read', 'pii:view'] });

    render(await TrustAnchorsPage());

    expect(screen.getByRole('heading', { name: 'You do not have access' })).toBeVisible();
    expect(screen.getByTestId('forbidden-panel')).toHaveTextContent('settings:read');
    expect(api.find('GET', TRUST_ANCHORS_PATH)).toBeUndefined();
  });

  it('shows the forbidden panel when the API refuses the store', async () => {
    api.me({ permissions: ['settings:read'] });
    api.onProblem('GET', TRUST_ANCHORS_PATH, 403, 'forbidden');

    render(await TrustAnchorsPage());

    expect(screen.getByRole('heading', { name: 'You do not have access' })).toBeVisible();
  });

  it('is titled for the browser tab and sits in the console layout', () => {
    expect(metadata.title).toBe('Chip trust store');
    expect(TrustAnchorsLayout).toBe(ConsoleLayout);
  });
});

describe('the chip trust store loading and error states', () => {
  it('announces that the trust store is loading', () => {
    render(<Loading />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading the chip trust store…');
  });

  it('explains a failure without internals and offers a retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const retry = vi.fn();

    render(<TrustAnchorsError error={new Error('socket hang up')} retry={retry} />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('The chip trust store could not be loaded.');
    expect(within(alert).queryByText(/socket/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
