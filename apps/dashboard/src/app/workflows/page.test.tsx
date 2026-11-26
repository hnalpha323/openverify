import type { Permission } from '@openverify/core';
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/toasts';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import { serveRecipes, serveWorkflows } from '../../testing/routes/workflows';
import { WORKFLOW_IDS as IDS, recipes, workflow } from '../../testing/workflow-fixtures';
import WorkflowsPage from './page';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  serveRecipes(api, recipes());
});

afterEach(() => {
  api.restore();
});

const show = async (permissions: Permission[]) => {
  api.me({ permissions });
  render(<ToastProvider>{await WorkflowsPage()}</ToastProvider>);
};

describe('the workflows page (C141)', () => {
  it('lists each workflow with its kind and status in words, linking its page', async () => {
    serveWorkflows(api, [workflow()]);

    await show(['workflows:read']);

    const table = screen.getByRole('table', { name: 'Workflows' });
    expect(within(table).getByRole('link', { name: 'Review on report match' })).toHaveAttribute(
      'href',
      `/workflows/${IDS.workflow}`,
    );
    expect(within(table).getByText('Running')).toBeVisible();
  });

  it('says why a workflow is paused, the publisher_revoked banner reason in words', async () => {
    serveWorkflows(api, [workflow({ status: 'paused', 'paused-reason': 'publisher_revoked' })]);

    await show(['workflows:read']);

    expect(screen.getByRole('table', { name: 'Workflows' })).toHaveTextContent(
      /Paused because its publisher lost a right/,
    );
  });

  it('lists the two recipes, each naming what it still needs, installable with workflows:write', async () => {
    serveWorkflows(api, []);

    await show(['workflows:read', 'workflows:write']);

    const table = screen.getByRole('table', { name: 'Recipes' });
    expect(within(table).getByText('Re-screen on account field change')).toBeVisible();
    expect(table).toHaveTextContent('report-template-id');
    expect(table).toHaveTextContent('case-template-id, decision-basis, contest-route');
    expect(within(table).getAllByRole('button', { name: /^Install/ })).toHaveLength(2);
  });

  it('offers no install without workflows:write', async () => {
    serveWorkflows(api, []);

    await show(['workflows:read']);

    expect(screen.queryByRole('button', { name: /^Install/ })).toBeNull();
  });

  it('shows the forbidden panel without workflows:read', async () => {
    await show(['inquiries:read']);

    expect(screen.getByText('You do not have access')).toBeVisible();
  });
});

describe('creating a workflow (C112.6, C141)', () => {
  it('offers the create form with workflows:write only', async () => {
    serveWorkflows(api, []);

    await show(['workflows:read', 'workflows:write']);

    expect(screen.getByRole('form', { name: 'Create a workflow' })).toBeVisible();
  });

  it('offers no create form without workflows:write', async () => {
    serveWorkflows(api, []);

    await show(['workflows:read']);

    expect(screen.queryByRole('form', { name: 'Create a workflow' })).toBeNull();
  });
});

describe('the account and case action links (C118.7, C140.1; Workflow 8D)', () => {
  it('links the account and case action bindings with workflows:write', async () => {
    serveWorkflows(api, []);

    await show(['workflows:read', 'workflows:write']);

    expect(screen.getByRole('link', { name: 'Account actions' })).toHaveAttribute(
      'href',
      '/account-actions',
    );
    expect(screen.getByRole('link', { name: 'Case actions' })).toHaveAttribute(
      'href',
      '/case-actions',
    );
  });
});
