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
  serveTemplateWithVersions,
  serveTranslations,
  translationRow,
  translationsPath,
} from '../../../../testing/routes/themes-copy';
import TemplateTranslationsPage, { metadata } from './page';

vi.mock('next/headers', () =>
  import('../../../../testing/fake-request').then((m) => m.nextHeaders),
);
vi.mock('next/navigation', async (original) => ({
  ...(await original<typeof import('next/navigation')>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

let api: RouteApi;
const ID = LIFECYCLE_IDS.template;
const page = async () =>
  render(
    <ToastProvider>
      {await TemplateTranslationsPage({
        params: Promise.resolve({ id: ID }),
        searchParams: Promise.resolve({}),
      })}
    </ToastProvider>,
  );

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: ['inquiry-templates:read'] });
});

afterEach(() => {
  api.restore();
});

describe('the template translations tab (C161.5, C162)', () => {
  it('is titled, under the template, with the Translations section marked as the page', async () => {
    serveTemplateWithVersions(api, template(), [version()]);
    serveTranslations(api, [], ID);

    await page();

    expect(metadata.title).toBe('Template translations');
    expect(screen.getByRole('heading', { level: 1, name: 'Translations' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Translations' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByText(/From version 1 \(published/)).toBeVisible();
  });

  it('shows every enabled locale with its review status, the texts with their rules, and the rules of consent copy', async () => {
    serveTemplateWithVersions(api, template(), [
      version({ 'enabled-locales': ['en', 'ar'], 'default-locale': 'en' }),
    ]);
    serveTranslations(
      api,
      [translationRow('consent.biometric', { en: 'Synthetic consent for {days} days' })],
      ID,
    );

    await page();

    const status = screen.getByRole('table', { name: 'Review status of the built-in texts' });
    expect(within(status).getByText(/Machine-drafted/)).toBeVisible();
    expect(within(status).getByText(/Source language/)).toBeVisible();
    const texts = screen.getByRole('table', { name: 'Texts per language' });
    expect(within(texts).getByText('consent.biometric')).toBeVisible();
    expect(within(texts).getByText('Placeholders: {days}, {organization}')).toBeVisible();
    expect(within(texts).getByText('Legal weight: consent')).toBeVisible();
    expect(within(texts).getByRole('textbox', { name: 'consent.biometric, en' })).toHaveValue(
      'Synthetic consent for {days} days',
    );
    expect(within(texts).getByRole('textbox', { name: 'consent.biometric, ar' })).toHaveAttribute(
      'dir',
      'auto',
    );
    expect(screen.getByText(/consent_copy_incomplete/)).toBeVisible();
    expect(screen.getByText('Else the built-in text in that language.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Download translations.csv' })).toHaveAttribute(
      'href',
      `/templates/${ID}/translations/csv`,
    );
    expect(screen.queryByRole('button', { name: 'Save texts' })).toBeNull();
    expect(screen.queryByRole('form', { name: 'Import CSV' })).toBeNull();
  });

  it('offers the draft’s languages with its ETag, saving and the CSV import to an editor, and lists the draft’s copy problems in words', async () => {
    api.me({ permissions: COPY_EDITOR });
    serveTemplateWithVersions(api, template(), [
      version(),
      draft({
        'enabled-locales': ['en', 'fr'],
        'default-locale': 'en',
        validation: {
          status: 'invalid',
          problems: [
            {
              pointer: '/copy/messages/fr/consent.processing',
              code: 'consent_copy_incomplete',
              detail: 'synthetic',
              severity: 'error',
            },
          ],
        },
      }),
    ]);
    serveTranslations(api, [], ID);

    await page();

    expect(screen.getByText(/From version 2 \(draft\)/)).toBeVisible();
    const locales = screen.getByRole('form', { name: 'Languages' });
    expect(within(locales).getByRole('checkbox', { name: 'French (fr)' })).toBeChecked();
    expect(within(locales).getByRole('checkbox', { name: 'Arabic (ar)' })).not.toBeChecked();
    expect(screen.getByText(/a fallback would record consent/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save texts' })).toBeVisible();
    expect(screen.getByRole('form', { name: 'Import CSV' })).toBeVisible();
  });

  it('shows the forbidden panel without inquiry-templates:read, and asks the API nothing', async () => {
    api.me({ permissions: ['theme-sets:read'] });

    await page();

    expect(screen.getByText(/inquiry-templates:read/)).toBeVisible();
    expect(api.find('GET', translationsPath(ID))).toBeUndefined();
  });
});
