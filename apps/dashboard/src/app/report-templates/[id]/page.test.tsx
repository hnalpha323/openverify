import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../components/toasts';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../testing/api-routes';
import { fakeRequest } from '../../../testing/fake-request';
import { expectNotFound } from '../../../testing/next-errors';
import {
  REPORT_CONFIG_IDS as IDS,
  TEMPLATE_NAME,
  reportDraft,
  reportTemplate,
  reportTemplateVersion,
} from '../../../testing/report-config-fixtures';
import {
  CONFIG_EDITOR,
  CONFIG_VIEWER,
  REPORT_TEMPLATE_VERSIONS_PATH,
  serveReportTemplate,
} from '../../../testing/routes/report-config';
import ReportTemplatePage, { metadata } from './page';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: CONFIG_EDITOR });
  serveReportTemplate(api, reportTemplate(), [reportDraft(), reportTemplateVersion()]);
});

afterEach(() => {
  api.restore();
});

const page = (id: string = IDS.template, searchParams: Record<string, string> = {}) =>
  ReportTemplatePage({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve(searchParams),
  });

async function renderTemplate(searchParams: Record<string, string> = {}) {
  render(<ToastProvider>{await page(IDS.template, searchParams)}</ToastProvider>);
}

describe('a report template’s page (C71, C86)', () => {
  it('shows the template, its type with its tiers and stage, and its current version resolved', async () => {
    await renderTemplate();

    expect(screen.getByRole('heading', { level: 1, name: TEMPLATE_NAME })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Report templates' })).toHaveAttribute(
      'href',
      '/report-templates',
    );
    const about = screen.getByRole('region', { name: 'Report type' });
    expect(about).toHaveTextContent('Watchlist');
    expect(within(about).getByText('Beta')).toHaveAttribute('data-status', 'beta');
    expect(about).toHaveTextContent('R lists');
    expect(about).toHaveTextContent('H name score');

    const current = screen.getByRole('region', { name: 'Current version' });
    expect(within(current).getByRole('link', { name: 'Version 1' })).toHaveAttribute(
      'href',
      `/report-templates/${IDS.template}/versions/${IDS.version}`,
    );
    const config = within(current).getByRole('table', { name: 'Configuration of version 1' });
    expect(config).toHaveTextContent('Every 30 days');
    expect(config).toHaveTextContent('openverify-sandbox');
  });

  it('lists the versions, newest first, each linked, with its status', async () => {
    await renderTemplate();

    const versions = screen.getByRole('table', { name: 'Versions' });
    const [, newest, ...older] = within(versions).getAllByRole('row');
    if (newest === undefined) {
      throw new Error('no version row');
    }
    expect([newest, ...older].map((row) => within(row).getByRole('link').textContent)).toEqual([
      'Version 2',
      'Version 1',
    ]);
    expect(within(newest).getByText('Draft')).toHaveAttribute('data-status', 'draft');
    expect(within(versions).getByRole('link', { name: 'Version 2' })).toHaveAttribute(
      'href',
      `/report-templates/${IDS.template}/versions/${IDS.draft}`,
    );
    expect(Object.fromEntries(api.find('GET', REPORT_TEMPLATE_VERSIONS_PATH)?.query ?? [])).toEqual(
      { 'filter[report-template-id]': IDS.template, 'page[size]': '25' },
    );
  });

  it('pages the versions with their cursor', async () => {
    serveReportTemplate(
      api,
      reportTemplate(),
      [reportTemplateVersion()],
      `/api/v1/report-template-versions?page%5Bafter%5D=${IDS.version}`,
    );

    await renderTemplate({ after: IDS.draft });

    expect(api.find('GET', REPORT_TEMPLATE_VERSIONS_PATH)?.query.get('page[after]')).toBe(
      IDS.draft,
    );
    expect(screen.getByRole('link', { name: 'Next page' })).toHaveAttribute(
      'href',
      `/report-templates/${IDS.template}?after=${IDS.version}`,
    );
  });

  it('offers a new draft and archiving with report-templates:write', async () => {
    await renderTemplate();

    const actions = screen.getByRole('group', { name: 'Template actions' });
    expect(
      within(actions)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['New draft', 'Archive']);
  });

  it('offers activation for an archived template', async () => {
    serveReportTemplate(api, reportTemplate({ status: 'archived' }), [reportTemplateVersion()]);

    await renderTemplate();

    expect(
      within(screen.getByRole('group', { name: 'Template actions' })).getByRole('button', {
        name: 'Activate',
      }),
    ).toBeVisible();
  });

  it('is read-only for a principal without report-templates:write', async () => {
    api.me({ permissions: CONFIG_VIEWER });

    await renderTemplate();

    expect(screen.queryByRole('group', { name: 'Template actions' })).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('is not found for a malformed id, without calling the API', async () => {
    await expectNotFound(page('rptp_x'));

    expect(api.requests).toHaveLength(0);
  });

  it('is not found when the API does not show it', async () => {
    api.onProblem('GET', `/report-templates/${IDS.template}`, 404);

    await expectNotFound(page());
  });

  it('shows the forbidden panel without report-templates:read', async () => {
    api.me({ permissions: ['watchlists:read'] });

    render(await page());

    expect(screen.getByRole('heading', { level: 1, name: 'You do not have access' })).toBeVisible();
    expect(api.requests.map((request) => request.path)).toEqual(['/dashboard/me']);
  });

  it('is titled for the browser tab', () => {
    expect(metadata.title).toBe('Report template');
  });
});
