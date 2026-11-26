import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../components/toasts';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../testing/api-routes';
import { fakeRequest } from '../../../testing/fake-request';
import { template } from '../../../testing/lifecycle-fixtures';
import {
  THEME_EDITOR,
  THEME_IDS,
  THEME_SETS_PATH,
  THEME_VIEWER,
  serveSettings,
  serveThemeSet,
  serveThemeSetRevisions,
  themeSetResource,
  themeSetRevisionResource,
} from '../../../testing/routes/themes-copy';
import ThemeSetPage, { metadata } from './page';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/navigation', async (original) => ({
  ...(await original<typeof import('next/navigation')>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

let api: RouteApi;
const page = async (id: string = THEME_IDS.set, params: Record<string, string> = {}) =>
  render(
    <ToastProvider>
      {await ThemeSetPage({
        params: Promise.resolve({ id }),
        searchParams: Promise.resolve(params),
      })}
    </ToastProvider>,
  );

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: THEME_VIEWER });
  serveThemeSetRevisions(api, THEME_IDS.set, [
    themeSetRevisionResource(3, { restoredFrom: 1 }),
    themeSetRevisionResource(2),
    themeSetRevisionResource(1),
  ]);
  serveSettings(api);
});

afterEach(() => {
  api.restore();
});

describe('a theme set (C160)', () => {
  it('shows its name, status, the revision flows render and every gate pair of both palettes', async () => {
    serveThemeSet(api, themeSetResource({ revision: 3, isDefault: true }));

    await page();

    expect(metadata.title).toBe('Theme set');
    expect(screen.getByRole('heading', { level: 1, name: 'Synthetic Brand' })).toBeVisible();
    expect(screen.getByText('Default set')).toBeVisible();
    expect(
      screen.getByText(/Revision 3: flows that use this set render this revision/),
    ).toBeVisible();
    for (const variant of ['Light', 'Dark']) {
      const table = screen.getByRole('table', {
        name: `${variant} palette: every pair the gate checks`,
      });
      expect(within(table).getAllByRole('row')).toHaveLength(17);
    }
    expect(screen.getByText(/The line colour has no pair/)).toBeVisible();
    expect(screen.getByText('Text over images.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Save styles' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Theme set actions' })).toBeNull();
    expect(
      Object.fromEntries(
        api.find('GET', `${THEME_SETS_PATH}/${THEME_IDS.set}/revisions`)?.query ?? [],
      ),
    ).toEqual({
      'page[size]': '20',
    });
  });

  it('lists the revisions newest first as the API answers them, each restorable but the one in use', async () => {
    api.me({ permissions: THEME_EDITOR });
    serveThemeSet(api, themeSetResource({ revision: 3 }));

    await page();

    const table = screen.getByRole('table', { name: 'Revisions' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => within(row).getByRole('rowheader').textContent)).toEqual([
      '3',
      '2',
      '1',
    ]);
    expect(within(table).getByText('Restored from revision 1')).toBeVisible();
    expect(within(table).getByText('In use')).toBeVisible();
    expect(within(table).getByRole('button', { name: 'Restore 2' })).toBeVisible();
  });

  it('offers editing, duplicating, archiving and the default to an editor', async () => {
    api.me({ permissions: THEME_EDITOR });
    serveThemeSet(api, themeSetResource());

    await page();

    const actions = screen.getByRole('group', { name: 'Theme set actions' });
    expect(within(actions).getByRole('button', { name: 'Make default' })).toBeVisible();
    expect(within(actions).getByRole('button', { name: 'Duplicate' })).toBeVisible();
    expect(within(actions).getByRole('button', { name: 'Archive' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save styles' })).toBeVisible();
    expect(screen.getByRole('form', { name: 'Logo and font files' })).toBeVisible();
    expect(screen.getByRole('form', { name: 'Name' })).toBeVisible();
  });

  it('offers the real-screen preview over the templates a reader of templates may open', async () => {
    api.me({ permissions: [...THEME_EDITOR, 'inquiry-templates:read'] });
    serveThemeSet(api, themeSetResource());
    api.on('GET', '/inquiry-templates', 200, { data: [template()], links: { next: null } });

    await page();

    const preview = screen.getByRole('form', { name: 'Preview on real screens' });
    expect(
      within(preview).getByRole('option', { name: 'Synthetic ID and selfie' }),
    ).toBeInTheDocument();
    expect(Object.fromEntries(api.find('GET', '/inquiry-templates')?.query ?? [])).toEqual({
      'page[size]': '25',
    });
  });

  it('keeps an archived set read-only and says what archiving did', async () => {
    api.me({ permissions: THEME_EDITOR });
    serveThemeSet(api, themeSetResource({ status: 'archived' }));

    await page();

    expect(screen.getByText(/This set is archived/)).toBeVisible();
    expect(screen.queryByRole('group', { name: 'Theme set actions' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save styles' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Restore/ })).toBeNull();
  });

  it('is not found for a malformed id, and forbidden without theme-sets:read', async () => {
    await expect(page('nope')).rejects.toThrow();

    api.me({ permissions: ['inquiries:read'] });
    await page();
    expect(screen.getByText(/theme-sets:read/)).toBeVisible();
    expect(api.find('GET', `${THEME_SETS_PATH}/${THEME_IDS.set}`)).toBeUndefined();
  });
});
