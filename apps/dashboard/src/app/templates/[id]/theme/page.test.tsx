import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../../components/toasts';
import { SESSION_COOKIE } from '../../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../../testing/api-routes';
import { fakeRequest } from '../../../../testing/fake-request';
import { LIFECYCLE_IDS, draft, template, version } from '../../../../testing/lifecycle-fixtures';
import {
  COPY_EDITOR,
  THEME_IDS,
  THEME_SETS_PATH,
  serveTemplateWithVersions,
  serveThemeSets,
  themeSetResource,
} from '../../../../testing/routes/themes-copy';
import TemplateThemePage, { metadata } from './page';

vi.mock('next/headers', () =>
  import('../../../../testing/fake-request').then((m) => m.nextHeaders),
);

let api: RouteApi;
const ID = LIFECYCLE_IDS.template;
vi.mock('next/navigation', async (original) => ({
  ...(await original<typeof import('next/navigation')>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const page = () =>
  TemplateThemePage({ params: Promise.resolve({ id: ID }), searchParams: Promise.resolve({}) });

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: ['inquiry-templates:read', 'theme-sets:read'] });
});

afterEach(() => {
  api.restore();
});

describe('the template theme tab (C160.7)', () => {
  it('is titled, under the template, with the Theme section marked as the page', async () => {
    serveTemplateWithVersions(api, template(), [version()]);
    serveThemeSets(api, [themeSetResource({ isDefault: true })]);

    render(await page());

    expect(metadata.title).toBe('Template theme');
    expect(screen.getByRole('heading', { level: 1, name: 'Theme' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Theme' })).toHaveAttribute('aria-current', 'page');
  });

  it('shows the published version read-only, with how to change it', async () => {
    serveTemplateWithVersions(api, template(), [version({ 'theme-set-id': THEME_IDS.set })]);
    serveThemeSets(api, [themeSetResource()]);

    render(await page());

    expect(screen.getByRole('combobox', { name: 'Theme set' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Theme set' })).toHaveValue(THEME_IDS.set);
    expect(screen.queryByRole('button', { name: 'Save the draft' })).toBeNull();
  });

  it('offers an editor the draft, saved with its ETag', async () => {
    api.me({ permissions: COPY_EDITOR });
    serveTemplateWithVersions(api, template(), [version(), draft({ 'theme-set-id': null })]);
    serveThemeSets(api, [themeSetResource({ isDefault: true })]);

    render(<ToastProvider>{await page()}</ToastProvider>);

    const form = screen.getByRole('form', { name: 'Theme' });
    expect(within(form).getByRole('combobox', { name: 'Theme set' })).toBeEnabled();
    expect(within(form).getByRole('button', { name: 'Save the draft' })).toBeVisible();
    expect(form.querySelector('input[name="etag"]')).toHaveValue(`"${'a'.repeat(64)}"`);
    expect(screen.getByText(/checks that the set is still an active set/)).toBeVisible();
    expect(Object.fromEntries(api.find('GET', THEME_SETS_PATH)?.query ?? [])).toMatchObject({
      'filter[status]': 'active',
    });
  });

  it('shows the forbidden panel without theme-sets:read, and asks the API nothing', async () => {
    api.me({ permissions: ['inquiry-templates:read'] });

    render(await page());

    expect(screen.getByText(/theme-sets:read/)).toBeVisible();
    expect(api.find('GET', THEME_SETS_PATH)).toBeUndefined();
  });
});
