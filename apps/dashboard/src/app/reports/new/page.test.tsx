import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../components/toasts';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../testing/api-routes';
import { fakeRequest } from '../../../testing/fake-request';
import { REPORT_IDS, reportTemplate, reportTemplateList } from '../../../testing/report-fixtures';
import { serveReportTemplatePages } from '../../../testing/routes/report-config';
import NewReportPage, { metadata } from './page';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', async (original) => ({
  ...(await original<typeof import('next/navigation')>()),
  useRouter: () => ({ push: vi.fn() }),
}));

const TEMPLATES = '/report-templates';
const EMAIL_TEMPLATE = 'rptp_01M5Y5Z400VF5JFP7ER3C45AY3';
let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: ['reports:read', 'reports:write', 'report-templates:read'] });
  api.on(
    'GET',
    TEMPLATES,
    200,
    reportTemplateList([
      reportTemplate('watchlist'),
      reportTemplate('email-address', { id: EMAIL_TEMPLATE }),
    ]),
  );
});

afterEach(() => {
  api.restore();
});

const page = (params: Record<string, string> = {}) =>
  NewReportPage({ searchParams: Promise.resolve(params) });
const show = async (params: Record<string, string> = {}) => {
  render(<ToastProvider>{await page(params)}</ToastProvider>);
};

describe('the create report page (C72.1, C86)', () => {
  it('is titled Create report', () => {
    expect(metadata.title).toBe('Create report');
  });

  it('first asks for one of the active templates, in a plain GET form', async () => {
    await show();

    expect(screen.getByRole('heading', { level: 1, name: 'Create report' })).toBeVisible();
    const choose = screen.getByRole('form', { name: 'Choose a report template' });
    expect(choose).toHaveAttribute('method', 'get');
    const select = within(choose).getByRole('combobox', { name: 'Report template' });
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Default watchlist (Watchlist)', 'Default email address (Email address)']);
    expect(Object.fromEntries(api.find('GET', TEMPLATES)?.query ?? [])).toEqual({
      'filter[status]': 'active',
      'page[size]': '100',
    });
    expect(screen.queryByRole('form', { name: 'Create report' })).toBeNull();
  });

  it('then asks for the query of the chosen template’s type, with its tier and stage', async () => {
    await show({ template: EMAIL_TEMPLATE });

    const create = screen.getByRole('form', { name: 'Create report' });
    expect(within(create).getByRole('textbox', { name: 'Email address' })).toBeVisible();
    expect(screen.getByText('Default email address')).toBeVisible();
    expect(screen.getByText('Beta')).toHaveAttribute('data-stage', 'beta');
    expect(
      within(screen.getByRole('form', { name: 'Choose a report template' })).getByRole('combobox', {
        name: 'Report template',
      }),
    ).toHaveValue(EMAIL_TEMPLATE);
  });

  it('offers to link an account only to an operator who reads accounts (C72.2)', async () => {
    api.me({
      permissions: ['reports:read', 'reports:write', 'report-templates:read', 'accounts:read'],
    });

    await show({ template: REPORT_IDS.template });

    expect(screen.getByRole('textbox', { name: 'Account ID (optional)' })).toBeVisible();
  });

  it('says a template that is not an active one cannot be used, and asks again', async () => {
    await show({ template: 'rptp_01M5Y5Z400VF5JFP7ER3C45AY9' });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Choose an active report template from the list.',
    );
    expect(screen.queryByRole('form', { name: 'Create report' })).toBeNull();
  });

  it('says when there is no template to create a report from', async () => {
    api.on('GET', TEMPLATES, 200, reportTemplateList([]));

    await show();

    expect(screen.getByRole('heading', { name: 'No active report template' })).toBeVisible();
  });

  it('shows the forbidden panel without reports:write or report-templates:read', async () => {
    api.me({ permissions: ['reports:read', 'report-templates:read'] });

    render(await page());

    expect(screen.getByRole('heading', { name: 'You do not have access' })).toBeVisible();
    expect(api.find('GET', TEMPLATES)).toBeUndefined();
  });
});

/** A synthetic template id, `rptp_` and 26 Crockford characters ending in `n`. */
const templateId = (n: number) => `rptp_01M5Y5Z400VF5JFP7ER3C4${String(n).padStart(4, '0')}`;
/** `count` active watchlist templates, numbered from `from`. */
const templates = (count: number, from = 0) =>
  Array.from({ length: count }, (_, index) =>
    reportTemplate('watchlist', {
      id: templateId(from + index),
      name: `Synthetic template ${String(from + index + 1)}`,
    }),
  );
const choices = () =>
  within(
    screen.getByRole('form', { name: 'Choose a report template' }),
  ).getByRole<HTMLSelectElement>('combobox', { name: 'Report template' });

describe('the create report page past the first page of templates (Workflow 6B R013)', () => {
  it('lists the active templates of every page, and creates from one past the first', async () => {
    serveReportTemplatePages(api, [
      [reportTemplate('watchlist')],
      [reportTemplate('email-address', { id: EMAIL_TEMPLATE })],
    ]);

    await show({ template: EMAIL_TEMPLATE });

    expect([...choices().options].map((option) => option.value)).toEqual([
      REPORT_IDS.template,
      EMAIL_TEMPLATE,
    ]);
    expect(choices()).toHaveValue(EMAIL_TEMPLATE);
    expect(screen.getByRole('form', { name: 'Create report' })).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(api.all('GET', TEMPLATES).map((request) => request.query.get('page[after]'))).toEqual([
      null,
      REPORT_IDS.template,
    ]);
  });

  it('says when the list stops at 1,000 templates, and never calls one past it unavailable', async () => {
    serveReportTemplatePages(
      api,
      Array.from({ length: 11 }, (_, page) => templates(100, page * 100)),
    );

    await show({ template: templateId(1_050) });

    expect(choices().options).toHaveLength(1_000);
    expect(choices()).toHaveAccessibleDescription(
      'Only the first 1,000 active templates are listed.',
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Template not listed');
    expect(alert).toHaveTextContent('not among the first 1,000 active templates listed');
    expect(alert).not.toHaveTextContent('not available');
  });
});
