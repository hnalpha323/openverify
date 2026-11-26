import { PERMISSIONS, type Permission } from '@openverify/core';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  API_KEY_ID,
  AUDIT_IDS,
  INQUIRY_ID,
  USER_IDS,
  allUsers,
  auditLog,
  listOf,
} from '../../components/operators/test-fixtures';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { meDocument, mockApi, type MockApi } from '../../testing/api-mock';
import { fakeRequest } from '../../testing/fake-request';
import AuditLogsError from './error';
import Loading from './loading';
import AuditLogsPage, { metadata } from './page';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('./actions', () => ({ searchAuditLogsByIp: vi.fn() }));

let api: MockApi;

beforeEach(() => {
  api = mockApi();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
});

afterEach(() => {
  api.restore();
  vi.restoreAllMocks();
});

const ALL = [...PERMISSIONS];
const AUDITOR: Permission[] = ['audit-logs:read'];

function signedIn(permissions: readonly Permission[]): MockApi {
  return api.reply(200, meDocument({ permissions }));
}

async function renderPage(searchParams: Record<string, string | string[] | undefined> = {}) {
  render(await AuditLogsPage({ searchParams: Promise.resolve(searchParams) }));
}

const ENTRIES = [
  auditLog(),
  auditLog({
    id: AUDIT_IDS.second,
    action: 'webhook.secret-rotated',
    actor: { type: 'api-key', id: API_KEY_ID },
    'resource-type': null,
    'resource-id': null,
    'ip-address': null,
    'user-agent': null,
    metadata: {},
    'created-at': '2026-10-19T08:00:00.000Z',
  }),
];

describe('audit logs page', () => {
  it("lists the environment's entries: when, action, actor, resource and address", async () => {
    signedIn(ALL).reply(200, listOf(ENTRIES)).reply(200, listOf(allUsers()));

    await renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Audit logs' })).toBeVisible();
    const table = screen.getByRole('table', { name: 'Audit log entries' });
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    const first = within(table).getByRole('link', { name: 'Oct 20, 2026, 4:35 AM' });
    expect(first).toHaveAttribute('href', `/audit-logs/${AUDIT_IDS.first}`);
    const approved = within(first.closest('tr') ?? table);
    expect(approved.getByText('inquiry.approved')).toBeVisible();
    expect(approved.getByText('Synthetic Reviewer')).toBeVisible();
    expect(approved.getByText(INQUIRY_ID)).toBeVisible();
    expect(approved.getByText('192.0.2.10')).toBeVisible();
    const rotated = within(
      within(table).getByText('webhook.secret-rotated').closest('tr') ?? table,
    );
    expect(rotated.getByText('API key')).toBeVisible();
    expect(rotated.getByText(API_KEY_ID)).toBeVisible();

    expect(api.requests.map(({ path }) => path)).toEqual([
      '/api/v1/dashboard/me',
      '/api/v1/dashboard/audit-logs',
      '/api/v1/dashboard/users',
    ]);
  });

  it('shows a system entry with no actor id (K7A-8, C15)', async () => {
    signedIn(AUDITOR).reply(
      200,
      listOf([
        auditLog({
          action: 'handoff.issued',
          actor: { type: 'system', id: null },
          'ip-address': null,
          'user-agent': null,
        }),
      ]),
    );

    await renderPage();

    const table = screen.getByRole('table', { name: 'Audit log entries' });
    const row = within(within(table).getByText('handoff.issued').closest('tr') ?? table);
    expect(row.getByText('System')).toBeVisible();
    expect(row.queryByText(/^(usr|key)_/u)).toBeNull();
  });

  it('shows "Hidden" for addresses masked without pii:view, and names no user without users:read', async () => {
    signedIn(AUDITOR).reply(200, listOf([auditLog({ 'ip-address': null, 'user-agent': null })]));

    await renderPage();

    const table = screen.getByRole('table', { name: 'Audit log entries' });
    expect(within(table).getByText('Hidden')).toBeVisible();
    expect(within(table).getByText(USER_IDS.reviewer)).toBeVisible();
    expect(within(table).queryByText('Synthetic Reviewer')).not.toBeInTheDocument();
    expect(api.requests).toHaveLength(2);
  });

  it('sends the filters of the URL to the API, and keeps them in the form', async () => {
    signedIn(AUDITOR).reply(200, listOf([]));

    await renderPage({
      action: 'inquiry.approved',
      actor: USER_IDS.reviewer,
      'resource-type': 'inquiry',
      'resource-id': INQUIRY_ID,
      from: '2026-10-01',
      to: '2026-10-20',
    });

    expect(Object.fromEntries(api.last().query)).toEqual({
      'filter[action]': 'inquiry.approved',
      'filter[actor-id]': USER_IDS.reviewer,
      'filter[resource-type]': 'inquiry',
      'filter[resource-id]': INQUIRY_ID,
      'filter[created-at-start]': '2026-10-01T00:00:00.000Z',
      'filter[created-at-end]': '2026-10-21T00:00:00.000Z',
      'page[size]': '25',
    });
    const form = screen.getByRole('search', { name: 'Filter audit log entries' });
    expect(within(form).getByLabelText('Action')).toHaveValue('inquiry.approved');
    expect(within(form).getByLabelText('Actor ID')).toHaveValue(USER_IDS.reviewer);
    expect(within(form).getByLabelText('Resource type')).toHaveValue('inquiry');
    expect(within(form).getByLabelText('Resource ID')).toHaveValue(INQUIRY_ID);
    expect(within(form).getByLabelText('From (UTC)')).toHaveValue('2026-10-01');
    expect(within(form).getByLabelText('To (UTC)')).toHaveValue('2026-10-20');
    expect(within(form).getByRole('link', { name: 'Clear filters' })).toHaveAttribute(
      'href',
      '/audit-logs',
    );
    expect(screen.getByRole('table')).toHaveTextContent('No audit entries match these filters.');
  });

  it('explains filters it cannot use, without asking the API', async () => {
    signedIn(AUDITOR);

    await renderPage({ action: 'Approved!', from: '2026-10-20', to: '2026-10-01' });

    expect(screen.getByRole('alert')).toHaveTextContent('Fix the filters to see entries.');
    const form = screen.getByRole('search', { name: 'Filter audit log entries' });
    expect(within(form).getByLabelText('Action')).toHaveAccessibleDescription(
      'For example inquiry.approved. Separate several with commas. Enter actions such as inquiry.approved, separated by commas.',
    );
    expect(within(form).getByLabelText('To (UTC)')).toHaveAccessibleDescription(
      'Inclusive. Enter a date on or after the start date.',
    );
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(api.requests).toHaveLength(1);
  });

  it('pages forward with the C1 cursor and keeps the filters', async () => {
    signedIn(AUDITOR).reply(
      200,
      listOf([auditLog()], `/api/v1/dashboard/audit-logs?page%5Bafter%5D=${AUDIT_IDS.first}`),
    );

    await renderPage({ action: 'inquiry.approved' });

    expect(screen.getByRole('link', { name: 'Next page' })).toHaveAttribute(
      'href',
      `/audit-logs?action=inquiry.approved&after=${AUDIT_IDS.first}`,
    );
  });

  it('says when nothing was recorded yet', async () => {
    signedIn(AUDITOR).reply(200, listOf([]));

    await renderPage();

    expect(screen.getByRole('table')).toHaveTextContent('No audit entries yet.');
    expect(screen.queryByRole('link', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('shows the forbidden panel without audit-logs:read', async () => {
    signedIn(['users:read']);

    await renderPage();

    expect(screen.getByRole('heading', { name: 'You do not have access' })).toBeVisible();
    expect(api.requests).toHaveLength(1);
  });

  it('is titled for the browser tab', () => {
    expect(metadata.title).toBe('Audit logs');
  });
});

describe('audit logs loading and error states', () => {
  it('announces that the entries are loading', () => {
    render(<Loading />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading the audit log…');
  });

  it('explains a failure and offers a retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const retry = vi.fn();

    render(<AuditLogsError error={new Error('internal')} retry={retry} />);

    expect(screen.getByRole('alert')).toHaveTextContent('The audit log could not be loaded.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});

describe('audit logs page: Workflow 9C (C168.6)', () => {
  it('filters by action prefix, kept in the form and the URL', async () => {
    signedIn(AUDITOR).reply(200, listOf([]));

    await renderPage({ 'action-prefix': 'settings.' });

    expect(Object.fromEntries(api.last().query)).toEqual({
      'filter[action-prefix]': 'settings.',
      'page[size]': '25',
    });
    const form = screen.getByRole('search', { name: 'Filter audit log entries' });
    expect(within(form).getByLabelText('Action prefix')).toHaveValue('settings.');
  });

  it('offers the address search only with pii:view, never as a URL filter', async () => {
    signedIn(AUDITOR).reply(200, listOf([]));
    await renderPage({ ip: '203.0.113.9' });

    expect(screen.queryByRole('search', { name: 'Find entries from one IP address' })).toBeNull();
    expect(
      screen.getByText(
        'Finding entries by IP address needs pii:view, because an address can identify a person.',
      ),
    ).toBeVisible();
    expect(api.last().query.has('filter[ip]')).toBe(false);
  });

  it('shows the address search to a reader with pii:view', async () => {
    signedIn([...AUDITOR, 'pii:view']).reply(200, listOf([]));

    await renderPage();

    expect(screen.getByRole('search', { name: 'Find entries from one IP address' })).toBeVisible();
  });
});
