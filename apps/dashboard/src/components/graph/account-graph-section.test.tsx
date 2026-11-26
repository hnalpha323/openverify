import type { Permission } from '@openverify/core';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import {
  EMAIL_CONFIG,
  GRAPH_IDS as IDS,
  TEMPLATE_NAME,
  accountGraphComponent,
  graphQuery,
  graphTemplate,
  graphTemplateVersion,
  single,
} from '../../testing/graph-fixtures';
import { rscPayloadOf } from '../../testing/rsc-payload';
import {
  GRAPH_DEVELOPER,
  GRAPH_READER,
  GRAPH_REVIEWER,
  serveAccountGraphComponent,
  serveGraphTemplates,
  serveGraphTemplateVersion,
} from '../../testing/routes/graph';
import { ToastProvider } from '../toasts';
import { AccountGraphSection } from './account-graph-section';
import { GRAPH_PROBLEM_WORDS } from './graph-words';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const OTHER_VERSION = 'grqtv_01JC0000000000000000000009';
let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: GRAPH_REVIEWER });
  serveAccountGraphComponent(api, accountGraphComponent());
  serveGraphTemplates(api, [
    graphTemplate(),
    graphTemplate({
      id: IDS.otherTemplate,
      name: 'From an email',
      publishedVersionId: OTHER_VERSION,
    }),
    graphTemplate({
      id: 'grqt_01JC0000000000000000000005',
      name: 'Unpublished',
      publishedVersion: null,
    }),
  ]);
  serveGraphTemplateVersion(api, graphTemplateVersion());
  serveGraphTemplateVersion(
    api,
    graphTemplateVersion({
      id: OTHER_VERSION,
      templateId: IDS.otherTemplate,
      config: EMAIL_CONFIG,
    }),
  );
});

afterEach(() => {
  api.restore();
});

const section = (permissions: readonly Permission[] = GRAPH_REVIEWER) =>
  AccountGraphSection({ accountId: IDS.accountB, permissions: new Set(permissions) });

async function renderSection(permissions?: readonly Permission[]) {
  render(<ToastProvider>{await section(permissions)}</ToastProvider>);
}

describe('the account page’s graph section (C108)', () => {
  it('offers the active, published templates that bind account_id, and runs nothing on render', async () => {
    await renderSection();
    const choice = screen.getByRole('combobox', { name: 'Template' });
    expect(
      within(choice)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([TEMPLATE_NAME]);
    expect(api.find('GET', '/graph-query-templates')?.query.get('filter[status]')).toBe('active');
    expect(api.requests.filter((request) => request.method !== 'GET')).toHaveLength(0);
  });

  it('shows the component size with the beta badge and when it was computed (K7B-2, C101.6)', async () => {
    await renderSection();

    const size = screen.getByText('Linked through strong identifiers: 4').closest('p');
    expect(size).not.toBeNull();
    expect(size).toHaveTextContent('Beta');
    expect(size).toHaveTextContent('Oct 20, 2026');
    expect(api.find('GET', `/accounts/${IDS.accountB}/graph-component`)).toBeDefined();
  });

  it('shows the size even when no template binds account_id', async () => {
    serveGraphTemplates(api, []);
    await renderSection();

    expect(screen.getByText('Linked through strong identifiers: 4')).toBeVisible();
    expect(screen.getByText(/No published template takes an account_id parameter/)).toBeVisible();
  });

  it('says "Not computed yet" for an account newer than the last run, never a size', async () => {
    serveAccountGraphComponent(
      api,
      accountGraphComponent({ state: 'not-computed', size: null, 'computed-at': null }),
    );
    await renderSection();

    expect(screen.getByText('Not computed yet')).toBeVisible();
    expect(screen.queryByText(/Linked through strong identifiers/)).toBeNull();
    expect(screen.queryByText('Beta')).toBeNull();
  });

  it('says "Components are off" while the setting is off, never a size', async () => {
    serveAccountGraphComponent(
      api,
      accountGraphComponent({ state: 'disabled', size: null, 'computed-at': null }),
    );
    await renderSection();

    expect(screen.getByText('Components are off')).toBeVisible();
    expect(screen.queryByText(/Linked through strong identifiers/)).toBeNull();
  });

  it('shows the direct connections of the account on an explicit press, and opens the result in the explorer', async () => {
    const user = userEvent.setup();
    api.on(
      'POST',
      '/graph-queries',
      201,
      single(graphQuery({ kindsNotIndexed: ['phone_number'] })),
    );
    await renderSection();
    await user.click(screen.getByRole('button', { name: 'Show direct connections' }));
    const table = await screen.findByRole('table', { name: 'Direct connections' });
    expect(within(table).getByRole('rowheader', { name: IDS.accountA })).toBeVisible();
    expect(within(table).getByText('Email address (confirmed)')).toBeVisible();
    expect(within(table).getByRole('rowheader', { name: IDS.accountC })).toBeVisible();
    expect(within(table).getByText('Phone number (unconfirmed)')).toBeVisible();
    expect(within(table).queryByRole('rowheader', { name: IDS.accountB })).toBeNull();
    expect(screen.getByText(/The index is still being built/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open in the explorer' })).toHaveAttribute(
      'href',
      `/graph/${IDS.query}`,
    );
    expect(api.find('POST', '/graph-queries')?.body).toEqual({
      data: {
        type: 'graph-query',
        attributes: {
          'graph-query-template-id': IDS.template,
          'parameter-map': { account_id: IDS.accountB },
        },
      },
      meta: { 'run-sync': true },
    });
  });

  it('opens the result on the console’s own route when explorer-url is null (K7B-11)', async () => {
    const user = userEvent.setup();
    api.on('POST', '/graph-queries', 201, single(graphQuery({ explorerUrl: null })));
    await renderSection();
    await user.click(screen.getByRole('button', { name: 'Show direct connections' }));

    expect(await screen.findByRole('link', { name: 'Open in the explorer' })).toHaveAttribute(
      'href',
      `/graph/${IDS.query}`,
    );
  });

  it('says a refused run in words', async () => {
    const user = userEvent.setup();
    api.onProblem('POST', '/graph-queries', 429, undefined, { code: 'graph_sync_limited' });
    await renderSection();
    await user.click(screen.getByRole('button', { name: 'Show direct connections' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      GRAPH_PROBLEM_WORDS.graph_sync_limited,
    );
  });

  it('says when the account shares no value in the result', async () => {
    const user = userEvent.setup();
    api.on(
      'POST',
      '/graph-queries',
      201,
      single(graphQuery({ nodes: [{ type: 'account', value: IDS.accountB }], links: [] })),
    );
    await renderSection();
    await user.click(screen.getByRole('button', { name: 'Show direct connections' }));
    expect(
      await screen.findByText('This account shares no value with another account in this result.'),
    ).toBeVisible();
  });

  it('offers no run without graph:write, saying why', async () => {
    await renderSection(GRAPH_READER);
    expect(screen.queryByRole('button', { name: 'Show direct connections' })).toBeNull();
    expect(screen.getByText(/needs graph:write/)).toBeVisible();
  });

  it('points to the templates when none binds account_id', async () => {
    serveGraphTemplates(api, []);
    await renderSection();
    expect(screen.getByText(/No published template takes an account_id parameter/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Query templates' })).toHaveAttribute(
      'href',
      '/graph/templates',
    );
  });

  it('puts no parameter value or node value in the RSC payload for a principal without pii:view', async () => {
    api.me({ permissions: GRAPH_DEVELOPER });
    const payload = await rscPayloadOf(await section(GRAPH_DEVELOPER));
    expect(payload).toContain(IDS.template);
    expect(payload).not.toMatch(/example\.test/);
    expect(api.requests.some((request) => request.path.endsWith('/value'))).toBe(false);
  });
});
