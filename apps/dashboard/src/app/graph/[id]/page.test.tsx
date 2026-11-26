import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../components/toasts';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../testing/api-routes';
import { fakeRequest } from '../../../testing/fake-request';
import {
  EMAIL_CONFIG,
  GRAPH_IDS as IDS,
  NODE_IDS,
  TEMPLATE_NAME,
  graphList,
  graphQuery,
  graphTemplate,
  page as pageOf,
  graphTemplateVersion,
} from '../../../testing/graph-fixtures';
import { expectNotFound } from '../../../testing/next-errors';
import {
  GRAPH_DEVELOPER,
  GRAPH_READER,
  GRAPH_REVIEWER,
  serveGraphQuery,
  serveGraphTemplate,
  serveGraphTemplateVersion,
} from '../../../testing/routes/graph';
import { CASE_IDS, caseQueue, caseTemplate } from '../../../testing/cases-fixtures';
import {
  CASE_TEMPLATES_PATH,
  serveCaseQueues,
  serveCaseTemplates,
} from '../../../testing/routes/cases';
import GraphQueryPage, { metadata } from './page';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: GRAPH_REVIEWER });
  serveGraphQuery(api, graphQuery());
  serveGraphTemplateVersion(api, graphTemplateVersion());
  serveGraphTemplate(api, graphTemplate());
  api.on('GET', '/lists', 200, pageOf([graphList()]));
});

afterEach(() => {
  api.restore();
});

const page = (id: string = IDS.query) => GraphQueryPage({ params: Promise.resolve({ id }) });

async function renderPage(id?: string) {
  render(<ToastProvider>{await page(id)}</ToastProvider>);
}

describe('a graph query’s explorer page (C108)', () => {
  it('shows the result’s summary, its template, and the explorer on the table view, without running anything', async () => {
    await renderPage();
    expect(metadata.title).toBe('Graph query');
    expect(screen.getByRole('heading', { level: 1, name: 'Graph query' })).toBeVisible();
    expect(screen.getByText(IDS.query)).toBeVisible();
    expect(screen.getByRole('link', { name: `${TEMPLATE_NAME}, version 1` })).toHaveAttribute(
      'href',
      `/graph/templates/${IDS.template}`,
    );
    expect(screen.getByText('3 accounts and 2 shared values')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Table view' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('table', { name: 'Accounts in this result' })).toBeVisible();
    expect(api.requests.filter((request) => request.method !== 'GET')).toHaveLength(0);
    expect(api.requests.some((request) => request.path.endsWith('/value'))).toBe(false);
  });

  it('gives a reviewer with pii:view the unmask, the expansion, rerun and every bulk action, with the lists to fill', async () => {
    await renderPage();
    expect(
      screen.getByRole('button', {
        name: `Show the value of Email address (confirmed) ${NODE_IDS.email}`,
      }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: `Expand around ${IDS.accountB}` })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Rerun' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Cancel query' })).toBeNull();
    const actions = within(screen.getByRole('combobox', { name: 'Action' }));
    expect(actions.getAllByRole('option')).toHaveLength(5);
    expect(api.find('GET', '/lists')?.query.get('filter[status]')).toBe('active');
  });

  it('hides the unmask and the actions that need pii:view from a developer, who sees each parameter’s name only', async () => {
    api.me({ permissions: GRAPH_DEVELOPER });
    serveGraphQuery(api, graphQuery({ params: { account_id: null } }));
    await renderPage();
    expect(screen.queryByRole('button', { name: /^Show the value/ })).toBeNull();
    const parameters = screen.getByRole('group', { name: 'Parameters' });
    expect(within(parameters).getByText('account_id')).toBeVisible();
    expect(within(parameters).getByText('Hidden')).toBeVisible();
    const actions = within(screen.getByRole('combobox', { name: 'Action' }));
    expect(actions.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Add a tag',
      'Remove a tag',
      'Set the account status',
    ]);
    expect(api.find('GET', '/lists')).toBeUndefined();
  });

  it('offers a principal with graph:read only no run, no expansion and no bulk action', async () => {
    api.me({ permissions: GRAPH_READER });
    await renderPage();
    expect(screen.queryByRole('button', { name: 'Rerun' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Expand around/ })).toBeNull();
    expect(screen.getByText(/Expanding around an account needs graph:write/)).toBeVisible();
    expect(
      screen.getByText(/Your role holds none of the scopes a bulk action needs/),
    ).toBeVisible();
  });

  it('offers no expansion when the template has no account_id parameter', async () => {
    serveGraphTemplateVersion(api, graphTemplateVersion({ config: EMAIL_CONFIG }));
    await renderPage();
    expect(screen.queryByRole('button', { name: /^Expand around/ })).toBeNull();
    expect(screen.getByText(/has no account_id parameter/)).toBeVisible();
  });

  it('says a submitted query has no result yet, and offers to cancel it', async () => {
    serveGraphQuery(api, graphQuery({ status: 'submitted' }));
    await renderPage();
    expect(screen.getByText('No result yet.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Cancel query' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Rerun' })).toBeNull();
    expect(screen.queryByRole('table', { name: 'Accounts in this result' })).toBeNull();
  });

  it('says a redacted result is gone, with no explorer', async () => {
    serveGraphQuery(api, graphQuery({ redacted: true }));
    await renderPage();
    expect(screen.getByText(/was redacted/)).toBeVisible();
    expect(screen.queryByRole('table', { name: 'Accounts in this result' })).toBeNull();
  });

  it('renders the result when explorer-url is null, on its own route (K7B-11)', async () => {
    serveGraphQuery(api, graphQuery({ explorerUrl: null }));
    serveGraphTemplateVersion(api, graphTemplateVersion());
    serveGraphTemplate(api, graphTemplate());
    await renderPage();

    expect(screen.getByText(IDS.query)).toBeVisible();
    expect(screen.getByRole('table', { name: 'Accounts in this result' })).toBeVisible();
  });

  it('says in words that the index is still being built', async () => {
    serveGraphQuery(api, graphQuery({ kindsNotIndexed: ['phone_number'] }));
    await renderPage();
    expect(
      screen.getByText(/The index is still being built: phone number \(confirmed\) is not indexed/),
    ).toBeVisible();
  });

  it('answers not found for an id that is not a graph query’s', async () => {
    await expectNotFound(page('grphq_nope'));
    expect(api.requests).toHaveLength(0);
  });

  it('shows the forbidden panel without graph:read, calling nothing else', async () => {
    api.me({ permissions: ['accounts:read'] });
    await renderPage();
    expect(screen.getByText(/graph:read/)).toBeVisible();
    expect(api.find('GET', `/graph-queries/${IDS.query}`)).toBeUndefined();
  });
});

describe('the explorer’s create-case button (C140.6, Workflow 8C)', () => {
  it('offers create-case with cases:write, on the published active templates, with the queues', async () => {
    api.me({
      permissions: [...GRAPH_REVIEWER, 'cases:write', 'case-templates:read', 'case-queues:read'],
    });
    serveCaseTemplates(api, [
      caseTemplate(),
      caseTemplate({
        id: CASE_IDS.otherTemplate,
        name: 'Synthetic unpublished',
        key: 'UNP',
        publishedVersion: null,
        draftVersion: 1,
      }),
    ]);
    serveCaseQueues(api, [caseQueue()]);

    await renderPage();

    const action = screen.getByRole('combobox', { name: 'Action' });
    expect(within(action).getByRole('option', { name: 'Create a case' })).toBeInTheDocument();
    expect(Object.fromEntries(api.find('GET', CASE_TEMPLATES_PATH)?.query ?? [])).toMatchObject({
      'filter[status]': 'active',
    });
  });

  it('does not offer it without cases:write, asking for no template', async () => {
    await renderPage();

    expect(
      within(screen.getByRole('combobox', { name: 'Action' })).queryByRole('option', {
        name: 'Create a case',
      }),
    ).toBeNull();
    expect(api.find('GET', CASE_TEMPLATES_PATH)).toBeUndefined();
  });
});
