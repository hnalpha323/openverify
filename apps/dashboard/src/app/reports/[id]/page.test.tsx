import type { Permission } from '@openverify/core';
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../components/toasts';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../testing/api-routes';
import { fakeRequest } from '../../../testing/fake-request';
import { expectNotFound } from '../../../testing/next-errors';
import {
  REPORT_IDS,
  dashboardReport,
  pendingReport,
  report,
} from '../../../testing/report-fixtures';
import ReportPage, { metadata } from './page';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const DETAIL = `/dashboard/reports/${REPORT_IDS.report}`;
/** A reviewer: reads, reviews, runs and redacts reports, with personal data. */
const REVIEWER: Permission[] = [
  'reports:read',
  'reports:write',
  'reports:review',
  'reports:redact',
  'report-templates:read',
  'accounts:read',
  'inquiries:read',
  'pii:view',
];
/** A viewer: reads reports with personal data masked (C72.2). */
const VIEWER: Permission[] = ['reports:read', 'report-templates:read', 'accounts:read'];

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: REVIEWER });
});

afterEach(() => {
  api.restore();
});

const page = (id: string = REPORT_IDS.report) => ReportPage({ params: Promise.resolve({ id }) });

async function renderReport(id: string = REPORT_IDS.report) {
  render(<ToastProvider>{await page(id)}</ToastProvider>);
}

const region = (name: string) => screen.getByRole('region', { name });
const term = (scope: HTMLElement, name: string) => {
  const dt = within(scope).getByText(name, { selector: 'dt' });
  const dd = dt.nextElementSibling;
  if (!(dd instanceof HTMLElement)) {
    throw new Error(`no value for ${name}`);
  }
  return dd;
};

describe('the report page (C86)', () => {
  it('is titled Report', () => {
    expect(metadata.title).toBe('Report');
  });

  it('shows a ready match with its status, result beside its coverage, tiers, stage and what it means', async () => {
    api.on('GET', DETAIL, 200, dashboardReport(report('watchlist')));

    await renderReport();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      `Watchlist report ${REPORT_IDS.report}`,
    );
    const result = region('Result');
    expect(term(result, 'Status')).toHaveTextContent('Ready');
    expect(term(result, 'Result')).toHaveTextContent('Match');
    expect(term(result, 'Coverage')).toHaveTextContent('Complete');
    expect(term(result, 'Tiers')).toHaveTextContent(
      'R: real logic, exact and tested; H: a heuristic, with a confidence and its reasons',
    );
    expect(term(result, 'Tiers')).toHaveTextContent(
      'R lists (parsing, versioning, normalisation), H name score',
    );
    expect(within(term(result, 'Stage')).getByText('Beta')).toHaveAttribute('data-stage', 'beta');
    expect(term(result, 'Matcher version')).toHaveTextContent('openverify-watchlist/0.1.0+keys.1');
    expect(term(result, 'Provider')).toHaveTextContent('None');
    expect(term(result, 'Thresholds')).toHaveTextContent('name-matching: tolerant');
    expect(term(result, 'Thresholds')).toHaveTextContent('min-score: 0.8');
    const means = within(result).getByRole('group', { name: 'What this result means' });
    expect(means).toHaveTextContent('Its latest run screened everything it was asked to.');
    expect(means).toHaveTextContent(
      "At least one entry of a screened list matched the person at or above the template's minimum, or by an exact identifier.",
    );
    expect(means).toHaveTextContent('A match is a lead for a reviewer, never a decision');
  });

  it('says beside complete coverage what it does not promise, for the types that compare names (owner decision 6)', async () => {
    api.on('GET', DETAIL, 200, dashboardReport(report('watchlist')));

    await renderReport();

    expect(term(region('Result'), 'Coverage')).toHaveTextContent(
      'Complete coverage does not promise romanisations outside the variant groups and ICAO’s tables, unknown spellings, or typos beyond the budget.',
    );
  });

  it('says nothing about name romanisations beside the complete coverage of a crypto address (owner decision 6)', async () => {
    api.on('GET', DETAIL, 200, dashboardReport(report('crypto-address-watchlist')));

    await renderReport();

    const coverage = term(region('Result'), 'Coverage');
    expect(coverage).toHaveTextContent('Complete');
    expect(coverage).not.toHaveTextContent('does not promise');
  });

  it('says an errored report was not screened, naming each source, and never says no match (C69.4)', async () => {
    api.on(
      'GET',
      DETAIL,
      200,
      dashboardReport(
        report('watchlist', {
          attributes: {
            status: 'errored',
            'has-match': false,
            matches: [],
            'matched-lists': [],
            errors: [
              { code: 'list_stale', source: 'eu-fsf' },
              { code: 'list_unavailable', source: 'wikidata-pep' },
            ],
          },
        }),
      ),
    );

    await renderReport();

    const result = region('Result');
    expect(term(result, 'Status')).toHaveTextContent('Errored (not screened)');
    expect(term(result, 'Result')).toHaveTextContent('Not screened');
    const errors = within(result).getByRole('list', { name: 'Why it was not fully screened' });
    expect(
      within(errors)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'List out of date: eu-fsf was not checked successfully within its stale limit or the template’s maximum list age, so it was not screened.',
      'List not available: wikidata-pep has never been synced or checked, is not configured, or was disabled, so it was not screened.',
    ]);
    expect(within(result).getByRole('group', { name: 'What this result means' })).toHaveTextContent(
      'Its latest run could not screen something.',
    );
    expect(document.body.textContent).not.toMatch(/no match/i);
    // The sources: the screened one with its provenance, and each one not screened.
    const sources = screen.getByRole('table', { name: 'Sources' });
    expect(
      within(sources).getByRole('rowheader', { name: 'eu-fsf' }).closest('tr'),
    ).toHaveTextContent('List out of date (not screened)');
    expect(
      within(sources).getByRole('rowheader', { name: 'wikidata-pep' }).closest('tr'),
    ).toHaveTextContent('List not available (not screened)');
  });

  it('says no match only beside ready, beside its coverage and each limit in words (C78.5)', async () => {
    api.on(
      'GET',
      DETAIL,
      200,
      dashboardReport(
        report('watchlist', {
          attributes: {
            'has-match': false,
            matches: [],
            'matched-lists': [],
            coverage: { complete: false, limits: ['lossy_script'] },
          },
        }),
      ),
    );

    await renderReport();

    const result = region('Result');
    expect(term(result, 'Result')).toHaveTextContent('No match');
    const coverage = term(result, 'Coverage');
    expect(coverage).toHaveTextContent('Limited');
    expect(within(coverage).getByRole('listitem')).toHaveTextContent(
      'A name was compared only through a lossy transliteration, so a miss is weaker evidence.',
    );
    expect(within(result).getByRole('group', { name: 'What this result means' })).toHaveTextContent(
      'Every selected list was screened, fresh, by the current matcher, over every name the query gave, and nothing reached the minimum.',
    );
  });

  it('lists each source with its publication, last check, origin and sync, an import never cited as the publisher', async () => {
    api.on('GET', DETAIL, 200, dashboardReport(report('watchlist')));

    await renderReport();

    const sources = screen.getByRole('table', { name: 'Sources' });
    const row = within(
      within(sources)
        .getByRole('rowheader', { name: 'openverify-sandbox' })
        .closest('tr') as HTMLElement,
    );
    expect(row.getByText('Screened, fresh when checked')).toBeVisible();
    expect(row.getByText('Oct 26, 2026, 12:00 AM')).toBeVisible();
    expect(row.getByText('Oct 26, 2026, 12:05 AM')).toBeVisible();
    expect(row.getByText('Imported from a file (not the publisher’s download)')).toBeVisible();
    expect(row.getByText('wsync-sandbox-0001')).toBeVisible();
    expect(
      row.getByText('OpenVerify synthetic sandbox list (fictional entries, for tests only)'),
    ).toBeVisible();
  });

  it('shows the query, each value with where it came from, to an operator with pii:view', async () => {
    api.on('GET', DETAIL, 200, dashboardReport(report('watchlist')));

    await renderReport();

    const query = region('Query');
    expect(term(query, 'First name')).toHaveTextContent('Avery');
    expect(term(query, 'Last name')).toHaveTextContent('Quillfeather');
    expect(term(query, 'Date of birth')).toHaveTextContent('1980-04-12');
    expect(term(query, 'Country of address')).toHaveTextContent('GB');
    expect(term(query, 'First name')).toHaveTextContent('Sent with the request');
  });

  it('shows each additional name of the query on one line (C84.2)', async () => {
    const golden = report('watchlist');
    api.on(
      'GET',
      DETAIL,
      200,
      dashboardReport(
        report('watchlist', {
          attributes: {
            query: {
              ...(golden.attributes.query as Record<string, unknown>),
              'additional-names': [{ 'name-first': 'Ava', 'name-last': 'Quill' }, { term: 'A Q' }],
            },
            'query-sources': {
              ...golden.attributes['query-sources'],
              'additional-names': 'inquiry_fields',
            },
          },
        }),
      ),
    );

    await renderReport();

    const names = term(region('Query'), 'Additional names');
    expect(
      within(names)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Ava Quill', 'A Q']);
    expect(names).toHaveTextContent('Inquiry fields');
  });

  it('shows the query masked, member by member, to an operator without pii:view (C70.3)', async () => {
    api.me({ permissions: VIEWER });
    api.on('GET', DETAIL, 200, dashboardReport(report('watchlist', { masked: true })));

    await renderReport();

    const query = region('Query');
    expect(within(query).getAllByText('Hidden')).toHaveLength(4);
    expect(document.body.textContent).not.toContain('Quillfeather');
  });

  it('labels a sandbox provider, states the notices, and lists the fields nobody could compute', async () => {
    api.on('GET', DETAIL, 200, dashboardReport(report('business-watchlist')));

    await renderReport();

    const result = region('Result');
    expect(within(result).getByRole('list', { name: 'Notices' })).toHaveTextContent(
      'This is not ownership screening',
    );
    const unavailable = within(result).getByRole('list', { name: 'Not available' });
    expect(unavailable).toHaveTextContent(
      'fitness-probity-list: This list is not built, so it was not searched.',
    );
  });

  it('names the provider that answered, labelled sandbox (ADR 0002 §3d)', async () => {
    api.on('GET', DETAIL, 200, dashboardReport(report('email-address')));

    await renderReport();

    expect(term(region('Result'), 'Provider')).toHaveTextContent('sandbox (sandbox provider)');
  });

  it('shows the details: template and version, origin, account and creation, each linked by permission', async () => {
    api.on('GET', DETAIL, 200, dashboardReport(report('watchlist')));

    await renderReport();

    const details = region('Details');
    expect(within(term(details, 'Template')).getByRole('link')).toHaveAttribute(
      'href',
      `/report-templates/${REPORT_IDS.template}`,
    );
    expect(term(details, 'Template version')).toHaveTextContent('v1');
    expect(term(details, 'Origin')).toHaveTextContent('API');
    expect(within(term(details, 'Account')).getByRole('link')).toHaveAttribute(
      'href',
      `/accounts/${REPORT_IDS.account}`,
    );
    expect(term(details, 'Inquiry')).toHaveTextContent('None');
    expect(term(details, 'Created (UTC)')).toHaveTextContent('Oct 27, 2026, 9:00 AM');
  });

  it('offers tags and redaction by permission, and neither on a redacted report', async () => {
    api.on('GET', DETAIL, 200, dashboardReport(report('watchlist')));
    await renderReport();
    expect(within(region('Tags')).getByRole('textbox', { name: 'New tag' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Redact report' })).toBeVisible();
  });

  it('shows a redacted report as redacted, its query gone, and offers no change (C73.5, H23)', async () => {
    api.on(
      'GET',
      DETAIL,
      200,
      dashboardReport(
        report('watchlist', {
          masked: true,
          attributes: { 'redacted-at': '2026-10-28T10:00:00.000Z', 'next-run-at': null },
        }),
      ),
    );

    await renderReport();

    expect(screen.getByRole('status', { name: 'Redacted' })).toHaveTextContent(
      'This report was redacted on Oct 28, 2026, 10:00 AM UTC.',
    );
    expect(within(region('Query')).getAllByText('Redacted').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Redact report' })).toBeNull();
    expect(within(region('Tags')).queryByRole('textbox', { name: 'New tag' })).toBeNull();
  });

  it('offers no tag editing or redaction to a viewer', async () => {
    api.me({ permissions: VIEWER });
    api.on('GET', DETAIL, 200, dashboardReport(report('watchlist', { masked: true })));

    await renderReport();

    expect(within(region('Tags')).queryByRole('textbox', { name: 'New tag' })).toBeNull();
    expect(within(region('Tags')).getByText('onboarding')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Redact report' })).toBeNull();
  });

  it('says a pending report has not run yet, and nothing about a match', async () => {
    api.on('GET', DETAIL, 200, dashboardReport(pendingReport('watchlist')));

    await renderReport();

    const result = region('Result');
    expect(term(result, 'Result')).toHaveTextContent('Not run yet');
    expect(within(result).getByRole('group', { name: 'What this result means' })).toHaveTextContent(
      'Created; its first run has not finished.',
    );
    expect(document.body.textContent).not.toMatch(/no match/i);
  });

  it('is not found for a malformed id, or one the API does not know', async () => {
    await expectNotFound(page('rep_1'));

    api.onProblem('GET', DETAIL, 404);
    await expectNotFound(page());
  });

  it('shows the forbidden panel without reports:read, and asks the API nothing', async () => {
    api.me({ permissions: ['inquiries:read'] });

    render(await page());

    expect(screen.getByRole('heading', { name: 'You do not have access' })).toBeVisible();
    expect(api.find('GET', DETAIL)).toBeUndefined();
  });
});
