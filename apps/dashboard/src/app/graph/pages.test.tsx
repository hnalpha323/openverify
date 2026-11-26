import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/toasts';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import {
  ACCOUNT_CONFIG,
  GRAPH_IDS as IDS,
  TEMPLATE_NAME,
  graphQuery,
  graphTemplate,
  graphTemplateDraft,
  graphTemplateVersion,
} from '../../testing/graph-fixtures';
import { expectNotFound } from '../../testing/next-errors';
import {
  GRAPH_READER,
  GRAPH_REVIEWER,
  serveGraphQueries,
  serveGraphTemplate,
  serveGraphTemplates,
  serveGraphTemplateVersion,
  serveGraphTemplateVersions,
} from '../../testing/routes/graph';
import GraphPage from './page';
import TemplatePage from './templates/[id]/page';
import TemplateVersionPage from './templates/[id]/versions/[versionId]/page';
import TemplatesPage from './templates/page';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: GRAPH_REVIEWER });
});

afterEach(() => {
  api.restore();
});

const show = async (node: Promise<ReactNode>) => {
  render(<ToastProvider>{await node}</ToastProvider>);
};

const templatePage = (id: string = IDS.template, searchParams: Record<string, string> = {}) =>
  TemplatePage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(searchParams) });

describe('the graph index (C108)', () => {
  const index = (searchParams: Record<string, string> = {}) =>
    GraphPage({ searchParams: Promise.resolve(searchParams) });

  it('links a query to the console’s own route when explorer-url is null (K7B-11)', async () => {
    serveGraphQueries(api, [graphQuery({ explorerUrl: null })]);
    await show(index());

    expect(screen.getByRole('link', { name: IDS.query })).toHaveAttribute(
      'href',
      `/graph/${IDS.query}`,
    );
  });

  it('lists the queries newest first with their status and whether the index was complete, in words', async () => {
    serveGraphQueries(api, [
      graphQuery(),
      graphQuery({ id: IDS.otherQuery, status: 'submitted', kindsNotIndexed: ['ip_address'] }),
    ]);
    await show(index());
    expect(screen.getByRole('heading', { level: 1, name: 'Graph' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Query templates' })).toHaveAttribute(
      'href',
      '/graph/templates',
    );
    const table = screen.getByRole('table', { name: 'Graph queries' });
    const [first, second] = within(table).getAllByRole('row').slice(1) as [
      HTMLElement,
      HTMLElement,
    ];
    expect(within(first).getByRole('link', { name: IDS.query })).toHaveAttribute(
      'href',
      `/graph/${IDS.query}`,
    );
    expect(within(first).getByText('Completed')).toBeVisible();
    expect(within(first).getByText('Complete')).toBeVisible();
    expect(within(second).getByText('Still being built')).toBeVisible();
    expect(api.find('GET', '/graph-queries')?.query.get('page[size]')).toBe('25');
  });

  it('filters by status, kept in the URL', async () => {
    serveGraphQueries(api, []);
    await show(index({ status: 'timed_out' }));
    expect(api.find('GET', '/graph-queries')?.query.get('filter[status]')).toBe('timed_out');
    expect(screen.getByText('No queries match this status.')).toBeVisible();
  });

  it('says how to start when there is none', async () => {
    serveGraphQueries(api, []);
    await show(index());
    expect(screen.getByText('No graph queries yet')).toBeVisible();
  });
});

describe('the query templates (C102.1, C108)', () => {
  it('lists the templates and offers to create one with graph:write', async () => {
    serveGraphTemplates(api, [
      graphTemplate(),
      graphTemplate({ id: IDS.otherTemplate, name: 'Draft only', publishedVersion: null }),
    ]);
    await show(TemplatesPage({ searchParams: Promise.resolve({}) }));
    const table = screen.getByRole('table', { name: 'Query templates' });
    expect(within(table).getByRole('link', { name: TEMPLATE_NAME })).toHaveAttribute(
      'href',
      `/graph/templates/${IDS.template}`,
    );
    expect(within(table).getByText('Version 1')).toBeVisible();
    expect(within(table).getByText('Not published')).toBeVisible();
    expect(screen.getByRole('form', { name: 'Create a query template' })).toBeVisible();
  });

  it('only lists them for a role without graph:write', async () => {
    api.me({ permissions: GRAPH_READER });
    serveGraphTemplates(api, [graphTemplate()]);
    await show(TemplatesPage({ searchParams: Promise.resolve({}) }));
    expect(screen.queryByRole('form', { name: 'Create a query template' })).toBeNull();
  });

  it('shows a template: its published configuration, the run form, a new draft and its rename and archive', async () => {
    serveGraphTemplate(api, graphTemplate({ latestVersion: 2 }));
    serveGraphTemplateVersion(api, graphTemplateVersion());
    await show(templatePage());
    expect(screen.getByRole('heading', { level: 1, name: TEMPLATE_NAME })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Version 1' })).toHaveAttribute(
      'href',
      `/graph/templates/${IDS.template}/versions/${IDS.version}`,
    );
    expect(screen.getByRole('form', { name: 'Run a query' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'account_id' })).toBeVisible();
    const draft = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Draft configuration' });
    expect(JSON.parse(draft.value)).toMatchObject({
      'connect-kinds': ACCOUNT_CONFIG['connect-kinds'],
    });
    expect(screen.queryByText(/no route lists/)).toBeNull();
    expect(screen.getByRole('form', { name: 'Rename the template' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeVisible();
    expect(api.requests.filter((request) => request.method !== 'GET')).toHaveLength(0);
  });

  it('opens a template’s only draft by its latest-version relationship, and lists it (K7B-3)', async () => {
    const draft = graphTemplateDraft({ versionNumber: 1 });
    serveGraphTemplate(api, graphTemplate({ publishedVersion: null, latestVersionId: IDS.draft }));
    serveGraphTemplateVersions(api, [draft]);
    serveGraphTemplateVersion(api, draft);
    await show(templatePage());

    const href = `/graph/templates/${IDS.template}/versions/${IDS.draft}`;
    expect(screen.getByRole('link', { name: 'Open the latest draft' })).toHaveAttribute(
      'href',
      href,
    );
    const versions = screen.getByRole('table', { name: 'Versions' });
    expect(within(versions).getByRole('link', { name: 'Version 1' })).toHaveAttribute('href', href);
    expect(versions).toHaveTextContent('Draft');
    expect(screen.queryByRole('form', { name: 'New draft' })).toBeNull();
    expect(
      api
        .find('GET', '/graph-query-template-versions')
        ?.query.get('filter[graph-query-template-id]'),
    ).toBe(IDS.template);
  });

  it('lists a published and a draft version, and opens the draft (K7B-3)', async () => {
    const draft = graphTemplateDraft();
    serveGraphTemplate(api, graphTemplate({ latestVersion: 2, latestVersionId: IDS.draft }));
    serveGraphTemplateVersions(api, [draft, graphTemplateVersion()]);
    serveGraphTemplateVersion(api, draft);
    serveGraphTemplateVersion(api, graphTemplateVersion());
    await show(templatePage());

    const rows = within(screen.getByRole('table', { name: 'Versions' })).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Version 2');
    expect(rows[1]).toHaveTextContent('Draft');
    expect(rows[2]).toHaveTextContent('Version 1');
    expect(rows[2]).toHaveTextContent('Published');
    expect(screen.getByRole('link', { name: 'Open the latest draft' })).toBeVisible();
  });

  it('offers a new draft when the latest version is the published one (K7B-3)', async () => {
    serveGraphTemplate(api, graphTemplate({ latestVersionId: IDS.version }));
    serveGraphTemplateVersions(api, [graphTemplateVersion()]);
    serveGraphTemplateVersion(api, graphTemplateVersion());
    await show(templatePage());

    expect(screen.getByRole('textbox', { name: 'Draft configuration' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Open the latest draft' })).toBeNull();
  });

  it('pages the versions by cursor (K7B-3)', async () => {
    serveGraphTemplate(api, graphTemplate());
    serveGraphTemplateVersion(api, graphTemplateVersion());
    serveGraphTemplateVersions(
      api,
      [graphTemplateVersion()],
      `/api/v1/graph-query-template-versions?page[after]=${IDS.version}`,
    );
    await show(templatePage(IDS.template, { after: IDS.draft }));

    expect(api.find('GET', '/graph-query-template-versions')?.query.get('page[after]')).toBe(
      IDS.draft,
    );
    expect(screen.getByRole('link', { name: 'Next page' })).toHaveAttribute(
      'href',
      `/graph/templates/${IDS.template}?after=${IDS.version}`,
    );
  });

  it('says an unpublished template cannot run yet', async () => {
    serveGraphTemplate(api, graphTemplate({ publishedVersion: null }));
    await show(templatePage());
    expect(screen.queryByRole('form', { name: 'Run a query' })).toBeNull();
    expect(screen.getByText(/has no published version, so it cannot run yet/)).toBeVisible();
  });

  it('answers not found for a malformed template id', async () => {
    await expectNotFound(templatePage('grqt_nope'));
  });
});

describe('a template version (C102.1, C108)', () => {
  const version = (versionId: string, id: string = IDS.template) =>
    TemplateVersionPage({ params: Promise.resolve({ id, versionId }) });

  it('edits a draft as JSON and publishes it after a confirmation, with graph:write', async () => {
    serveGraphTemplateVersion(api, graphTemplateDraft());
    serveGraphTemplate(api, graphTemplate());
    await show(version(IDS.draft));
    expect(screen.getByRole('heading', { level: 1, name: 'Version 2' })).toBeVisible();
    expect(screen.getByText('Draft')).toHaveAttribute('data-status', 'draft');
    expect(screen.getByRole('form', { name: 'Edit the draft configuration' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeVisible();
  });

  it('shows a published version read-only', async () => {
    serveGraphTemplateVersion(api, graphTemplateVersion());
    serveGraphTemplate(api, graphTemplate());
    await show(version(IDS.version));
    expect(screen.queryByRole('form', { name: 'Edit the draft configuration' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Configuration (read-only)' })).toHaveTextContent(
      '"max-hops": 4',
    );
  });

  it('answers not found for a version of another template', async () => {
    serveGraphTemplateVersion(api, graphTemplateDraft({ templateId: IDS.otherTemplate }));
    await expectNotFound(version(IDS.draft));
  });
});
