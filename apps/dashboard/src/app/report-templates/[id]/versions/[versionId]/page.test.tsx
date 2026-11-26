import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../../../components/toasts';
import { SESSION_COOKIE } from '../../../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../../../testing/api-routes';
import { fakeRequest } from '../../../../../testing/fake-request';
import { expectNotFound } from '../../../../../testing/next-errors';
import {
  REPORT_CONFIG_IDS as IDS,
  TEMPLATE_NAME,
  reportDraft,
  reportTemplate,
  reportTemplateVersion,
} from '../../../../../testing/report-config-fixtures';
import { rscPayloadOf } from '../../../../../testing/rsc-payload';
import {
  CONFIG_EDITOR,
  CONFIG_VIEWER,
  serveReportTemplateVersion,
} from '../../../../../testing/routes/report-config';
import ReportTemplateVersionPage, { metadata } from './page';

vi.mock('next/headers', () =>
  import('../../../../../testing/fake-request').then((m) => m.nextHeaders),
);
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let api: RouteApi;

/** A draft that tightens the preset and screens weak aliases, beside the template's lists. */
const DRAFT = reportDraft({
  config: {
    'recurrence-interval-days': 30,
    'search-lists': ['openverify-sandbox'],
    'name-matching': { preset: 'strict' },
    'screen-weak-aliases': true,
  },
});

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: CONFIG_EDITOR });
  serveReportTemplateVersion(api, DRAFT, reportTemplate());
  serveReportTemplateVersion(api, reportTemplateVersion(), reportTemplate());
});

afterEach(() => {
  api.restore();
});

const page = (versionId: string = IDS.draft, id: string = IDS.template) =>
  ReportTemplateVersionPage({ params: Promise.resolve({ id, versionId }) });

async function renderVersion(versionId: string = IDS.draft) {
  render(<ToastProvider>{await page(versionId)}</ToastProvider>);
}

describe('a report template version’s page (C71, C86)', () => {
  it('edits a draft as JSON, starting from what it sets, with the resolved configuration beside it', async () => {
    await renderVersion();

    expect(screen.getByRole('heading', { level: 1, name: 'Version 2' })).toBeVisible();
    expect(screen.getByRole('link', { name: TEMPLATE_NAME })).toHaveAttribute(
      'href',
      `/report-templates/${IDS.template}`,
    );
    expect(screen.getByText('Draft')).toHaveAttribute('data-status', 'draft');
    const form = screen.getByRole('form', { name: 'Edit the draft configuration' });
    const editor = within(form).getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Configuration',
    });
    expect(JSON.parse(editor.value)).toEqual({
      'recurrence-interval-days': 30,
      'search-lists': ['openverify-sandbox'],
      'name-matching': { preset: 'strict' },
      'screen-weak-aliases': true,
    });
    const resolved = screen.getByRole('table', { name: 'Resolved configuration (saved)' });
    expect(resolved).toHaveTextContent('Strict, minimum score 0.85');
    expect(resolved).toHaveTextContent('Year ± 1');
  });

  it('publishes a draft with report-templates:publish, saying what publishing does and checks', async () => {
    await renderVersion();

    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));

    const dialog = screen.getByRole('dialog', { name: 'Publish version 2?' });
    expect(dialog).toHaveTextContent('new reports use it');
    expect(dialog).toHaveTextContent('keep the version they were created from');
    expect(dialog).toHaveTextContent('an empty list');
    expect(dialog).toHaveTextContent('Save your changes first');
  });

  it('shows a draft read-only to a principal without report-templates:write, and no publish', async () => {
    api.me({ permissions: CONFIG_VIEWER });

    await renderVersion();

    expect(screen.queryByRole('form', { name: 'Edit the draft configuration' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
    expect(screen.getByRole('table', { name: 'Resolved configuration' })).toBeVisible();
  });

  it('offers publish without the editor to a principal holding publish only', async () => {
    api.me({ permissions: ['report-templates:read', 'report-templates:publish'] });

    await renderVersion();

    expect(screen.queryByRole('form', { name: 'Edit the draft configuration' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeVisible();
  });

  it('shows a published version read-only, with its publication time', async () => {
    await renderVersion(IDS.version);

    expect(screen.getByRole('heading', { level: 1, name: 'Version 1' })).toBeVisible();
    expect(screen.getByText('Published')).toHaveAttribute('data-status', 'published');
    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
    expect(screen.getByRole('table', { name: 'Resolved configuration' })).toHaveTextContent(
      'Every 30 days',
    );
  });

  it('carries only what the API returned in its RSC payload', async () => {
    const payload = await rscPayloadOf(await page());

    expect(payload).toContain('openverify-sandbox');
    expect(api.requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'GET /dashboard/me',
      `GET /report-template-versions/${IDS.draft}`,
      `GET /report-templates/${IDS.template}`,
    ]);
  });

  it('is not found for a version of another template', async () => {
    serveReportTemplateVersion(
      api,
      reportDraft({ templateId: IDS.otherTemplate }),
      reportTemplate(),
    );

    await expectNotFound(page());
  });

  it('is not found for malformed ids, without calling the API', async () => {
    await expectNotFound(page('rptpv_x'));
    await expectNotFound(page(IDS.draft, 'rptp_x'));

    expect(api.requests).toHaveLength(0);
  });

  it('shows the forbidden panel without report-templates:read', async () => {
    api.me({ permissions: ['watchlists:read'] });

    render(await page());

    expect(screen.getByRole('heading', { level: 1, name: 'You do not have access' })).toBeVisible();
  });

  it('is titled for the browser tab', () => {
    expect(metadata.title).toBe('Report template version');
  });

  it('edits a draft through a form generated from its type’s contract, the JSON kept below (C153.4)', async () => {
    await renderVersion();

    const form = screen.getByRole('form', { name: 'Edit the draft configuration as a form' });
    expect(within(form).getByRole('combobox', { name: 'screen-weak-aliases' })).toHaveValue('true');
    expect(screen.getByRole('form', { name: 'Edit the draft configuration' })).toBeVisible();
  });

  it('offers no generated form for a version that is not a draft', async () => {
    render(<ToastProvider>{await page(IDS.version)}</ToastProvider>);

    expect(
      screen.queryByRole('form', { name: 'Edit the draft configuration as a form' }),
    ).toBeNull();
  });
});
