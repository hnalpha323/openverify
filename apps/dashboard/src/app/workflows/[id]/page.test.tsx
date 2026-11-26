import type { Permission } from '@openverify/core';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../components/toasts';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../testing/api-routes';
import { fakeRequest } from '../../../testing/fake-request';
import {
  WORKFLOW_RUNS_PATH,
  serveTriggerDeliveries,
  serveWorkflow,
  serveWorkflowRuns,
  serveWorkflowVersions,
} from '../../../testing/routes/workflows';
import {
  WORKFLOW_IDS as IDS,
  workflow,
  triggerDelivery,
  workflowRun,
  workflowVersion,
} from '../../../testing/workflow-fixtures';
import WorkflowPage from './page';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const DEVELOPER: Permission[] = ['workflows:read', 'workflows:write', 'workflow-runs:read'];
let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  serveWorkflowVersions(api, [workflowVersion()]);
  serveWorkflowRuns(api, [workflowRun()]);
  serveTriggerDeliveries(api, []);
});

afterEach(() => {
  api.restore();
});

const show = async (
  permissions: Permission[] = DEVELOPER,
  searchParams: Record<string, string> = {},
) => {
  api.me({ permissions });
  render(
    <ToastProvider>
      {await WorkflowPage({
        params: Promise.resolve({ id: IDS.workflow }),
        searchParams: Promise.resolve(searchParams),
      })}
    </ToastProvider>,
  );
};

describe('the workflow page (C141.5, C141.6, C121.5)', () => {
  it('names the workflow with its status in words', async () => {
    serveWorkflow(api, workflow());

    await show();

    expect(screen.getByRole('heading', { level: 1, name: 'Review on report match' })).toBeVisible();
    expect(screen.getByText('Running', { selector: 'dd' })).toBeVisible();
  });

  it('shows the publisher_revoked banner from the paused reason', async () => {
    serveWorkflow(api, workflow({ status: 'paused', 'paused-reason': 'publisher_revoked' }));

    await show();

    expect(screen.getByRole('alert', { name: 'Paused' })).toHaveTextContent(
      /publisher lost a right its live version needs/,
    );
  });

  it('lists the version history with the warnings of each, publisher_scope_lost among them', async () => {
    serveWorkflow(api, workflow());
    serveWorkflowVersions(api, [
      workflowVersion({ warnings: [{ pointer: '', code: 'publisher_scope_lost' }] }),
    ]);

    await show();

    const table = screen.getByRole('table', { name: 'Version history' });
    expect(within(table).getByRole('row', { name: /^1/ })).toHaveTextContent('Published');
    expect(table).toHaveTextContent('publisher_scope_lost');
    expect(api.find('GET', '/workflow-versions')?.query.get('filter[workflow-id]')).toBe(
      IDS.workflow,
    );
  });

  it('lists its runs with their status in words, each linking its page', async () => {
    serveWorkflow(api, workflow());

    await show();

    const runs = screen.getByRole('table', { name: 'Runs of this workflow' });
    expect(within(runs).getByRole('link', { name: IDS.run })).toHaveAttribute(
      'href',
      `/workflows/runs/${IDS.run}`,
    );
    expect(runs).toHaveTextContent('Completed');
    expect(api.find('GET', WORKFLOW_RUNS_PATH)?.query.get('filter[workflow-id]')).toBe(
      IDS.workflow,
    );
  });

  it('filters the runs that have step errors', async () => {
    serveWorkflow(api, workflow());

    await show(DEVELOPER, { 'step-errors': 'true' });

    expect(api.find('GET', WORKFLOW_RUNS_PATH)?.query.get('filter[has-step-errors]')).toBe('true');
  });

  it('reads no runs without workflow-runs:read', async () => {
    serveWorkflow(api, workflow());

    await show(['workflows:read']);

    expect(screen.queryByRole('table', { name: 'Runs of this workflow' })).toBeNull();
    expect(api.all('GET', WORKFLOW_RUNS_PATH)).toHaveLength(0);
  });

  it.each([
    ['running', null, ['Pause']],
    ['paused', 'operator', ['Activate', 'Archive']],
  ] as const)(
    'offers a %s workflow its status actions with workflows:write',
    async (status, reason, labels) => {
      serveWorkflow(api, workflow({ status, 'paused-reason': reason }));

      await show();

      const group = screen.getByRole('group', { name: 'Workflow actions' });
      expect(
        within(group)
          .getAllByRole('button')
          .map((button) => button.textContent),
      ).toEqual(labels);
    },
  );

  it('offers no status action without workflows:write', async () => {
    serveWorkflow(api, workflow());

    await show(['workflows:read']);

    expect(screen.queryByRole('group', { name: 'Workflow actions' })).toBeNull();
  });
});

describe('authoring and publishing from the workflow page (C141.2, C141.5, C118.1)', () => {
  const drafted = (more: Partial<ReturnType<typeof workflow>['relationships']> = {}) => {
    const base = workflow();
    return {
      ...base,
      relationships: {
        ...base.relationships,
        'draft-version': { data: { type: 'workflow-version' as const, id: IDS.draft } },
        ...more,
      },
    };
  };

  it('opens the draft, or starts one, with workflows:write', async () => {
    serveWorkflow(api, drafted());

    await show();

    expect(screen.getByRole('link', { name: 'Open the draft' })).toHaveAttribute(
      'href',
      `/workflows/${IDS.workflow}/draft`,
    );

    api.restore();
    api = routeApi();
    serveWorkflowVersions(api, [workflowVersion()]);
    serveWorkflowRuns(api, []);
    serveTriggerDeliveries(api, []);
    serveWorkflow(api, workflow());
    await show();
    expect(screen.getByRole('link', { name: 'New draft' })).toHaveAttribute(
      'href',
      `/workflows/${IDS.workflow}/draft`,
    );
  });

  it('offers publishing the draft only with workflows:publish', async () => {
    serveWorkflow(api, drafted());

    await show([...DEVELOPER, 'workflows:publish']);

    expect(screen.getByRole('button', { name: 'Publish the draft' })).toBeVisible();
  });

  it('offers no publish without a draft or without workflows:publish', async () => {
    serveWorkflow(api, drafted());

    await show();

    expect(screen.queryByRole('button', { name: 'Publish the draft' })).toBeNull();
  });

  it('offers finishing and undoing a rollout in progress', async () => {
    serveWorkflow(
      api,
      drafted({
        'active-deployment': {
          data: { type: 'workflow-deployment', id: 'wfd_01MB0000000000000000000001' },
        },
      }),
    );
    serveWorkflowVersions(api, [
      workflowVersion({ 'rollout-percentage': 25, 'rollout-label': 'treatment' }),
    ]);

    await show([...DEVELOPER, 'workflows:publish']);

    const rollout = screen.getByRole('group', { name: 'Rollout' });
    expect(within(rollout).getByText('25% of new runs use the new version.')).toBeVisible();
    expect(within(rollout).getByRole('button', { name: 'Finish the rollout' })).toBeVisible();
    expect(within(rollout).getByRole('button', { name: 'Undo the rollout' })).toBeVisible();
  });

  it('lists the trigger deliveries that started no run, with their reason', async () => {
    serveWorkflow(api, workflow());
    serveTriggerDeliveries(api, [
      triggerDelivery(),
      triggerDelivery(
        { status: 'run_created', 'reason-code': null },
        'wftd_01MB0000000000000000000002',
        IDS.run,
      ),
    ]);

    await show();

    const table = screen.getByRole('table', { name: 'Trigger deliveries' });
    expect(within(table).getByRole('row', { name: /subject_rate_limited/ })).toHaveTextContent(
      'Refused',
    );
    expect(within(table).getByRole('link', { name: IDS.run })).toHaveAttribute(
      'href',
      `/workflows/runs/${IDS.run}`,
    );
    expect(api.find('GET', '/workflow-trigger-deliveries')?.query.get('filter[workflow-id]')).toBe(
      IDS.workflow,
    );
  });
});

describe('restoring a version (C116.5)', () => {
  it('offers each published version that is not live to restore as a draft, with workflows:publish', async () => {
    serveWorkflow(api, workflow());
    serveWorkflowVersions(api, [
      workflowVersion(),
      workflowVersion({ live: false, 'version-number': 1 }, IDS.previousVersion),
    ]);

    await show([...DEVELOPER, 'workflows:publish']);

    const history = screen.getByRole('table', { name: 'Version history' });
    expect(within(history).getAllByRole('button', { name: /^Restore version/ })).toHaveLength(1);
    expect(within(history).getByRole('button', { name: 'Restore version 1' })).toBeVisible();
  });

  it('offers no restore without workflows:publish', async () => {
    serveWorkflow(api, workflow());
    serveWorkflowVersions(api, [workflowVersion({ live: false }, IDS.previousVersion)]);

    await show();

    expect(screen.queryByRole('button', { name: /^Restore version/ })).toBeNull();
  });
});

describe('promote, cancel-runs, run filters, cursors and marks (C141.5, C141.6; Workflow 8D)', () => {
  const PRODUCTION = { id: 'env_01J9ZK3M5Q7R8S9T0V1W2X3Y52', kind: 'production' as const };
  const SANDBOX = { id: 'env_01J9ZK3M5Q7R8S9T0V1W2X3Y51', kind: 'sandbox' as const };

  const showIn = async (permissions: Permission[], searchParams: Record<string, string> = {}) => {
    api.me({ permissions, environment: SANDBOX, environments: [SANDBOX, PRODUCTION] });
    render(
      <ToastProvider>
        {await WorkflowPage({
          params: Promise.resolve({ id: IDS.workflow }),
          searchParams: Promise.resolve(searchParams),
        })}
      </ToastProvider>,
    );
  };

  it('offers promoting the live version to another environment, saying it never replaces a draft or publishes', async () => {
    serveWorkflow(api, workflow());

    await showIn([...DEVELOPER, 'workflows:publish']);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Promote' }));

    const dialog = screen.getByRole('dialog', { name: 'Promote the live version?' });
    expect(dialog).toHaveTextContent(/as a draft/);
    expect(dialog).toHaveTextContent(/never replaces a draft/);
    expect(dialog).toHaveTextContent(/never publishes/);
    const target = within(dialog).getByRole('combobox', { name: 'Target environment' });
    expect(
      within(target)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([`Production (${PRODUCTION.id})`]);
  });

  it('offers no promote without workflows:publish or without a live version', async () => {
    serveWorkflow(api, workflow());
    await showIn(DEVELOPER);
    expect(screen.queryByRole('button', { name: 'Promote' })).toBeNull();
  });

  it('offers cancelling the runs of older versions with workflow-runs:write, saying effects stay made', async () => {
    serveWorkflow(api, workflow());
    serveWorkflowVersions(api, [
      workflowVersion({ 'version-number': 2 }),
      workflowVersion({ live: false, 'version-number': 1 }, IDS.previousVersion),
    ]);

    await showIn([...DEVELOPER, 'workflow-runs:write']);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel older runs' }));

    const dialog = screen.getByRole('dialog', { name: 'Cancel the runs of older versions?' });
    expect(dialog).toHaveTextContent(/Effects already made stay made/);
    const before = within(dialog).getByRole('combobox', { name: 'Runs of versions before' });
    expect(
      within(before)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Version 2']);
  });

  it('offers no cancel of older runs without workflow-runs:write', async () => {
    serveWorkflow(api, workflow());
    await showIn(DEVELOPER);
    expect(screen.queryByRole('button', { name: 'Cancel older runs' })).toBeNull();
  });

  it('filters the runs by status, version, subject and step errors from the URL', async () => {
    serveWorkflow(api, workflow());

    await showIn(DEVELOPER, {
      'run-status': 'errored',
      'run-version': IDS.version,
      'run-subject': IDS.inquiry,
      'step-errors': 'true',
    });

    const query = api.find('GET', WORKFLOW_RUNS_PATH)?.query;
    expect(query?.get('filter[status]')).toBe('errored');
    expect(query?.get('filter[workflow-version-id]')).toBe(IDS.version);
    expect(query?.get('filter[subject-id]')).toBe(IDS.inquiry);
    expect(query?.get('filter[has-step-errors]')).toBe('true');
    const filters = screen.getByRole('search', { name: 'Filter runs' });
    expect(within(filters).getByRole('combobox', { name: 'Status' })).toHaveValue('errored');
    expect(within(filters).getByRole('textbox', { name: 'Subject id' })).toHaveValue(IDS.inquiry);
  });

  it('sends no filter value that is not well formed, and says it left it out', async () => {
    serveWorkflow(api, workflow());

    await showIn(DEVELOPER, { 'run-status': 'finished', 'run-subject': 'jane doe' });

    const query = api.find('GET', WORKFLOW_RUNS_PATH)?.query;
    expect(query?.has('filter[status]')).toBe(false);
    expect(query?.has('filter[subject-id]')).toBe(false);
    expect(screen.getByRole('status', { name: 'Run filters' })).toHaveTextContent(
      'A filter that is not well formed was left out: status, subject id.',
    );
  });

  it('pages versions, runs and deliveries each by a cursor of its own, keeping the others in place', async () => {
    const RUN_NEXT = 'wfr_01MB0000000000000000000009';
    serveWorkflow(api, workflow());
    api.on('GET', WORKFLOW_RUNS_PATH, 200, {
      data: [workflowRun()],
      links: { next: `/api/v1/workflow-runs?page[after]=${RUN_NEXT}` },
    });

    await showIn(DEVELOPER, {
      'versions-after': IDS.previousVersion,
      'deliveries-after': 'wftd_01MB0000000000000000000003',
    });

    expect(api.find('GET', '/workflow-versions')?.query.get('page[after]')).toBe(
      IDS.previousVersion,
    );
    expect(api.find('GET', '/workflow-trigger-deliveries')?.query.get('page[after]')).toBe(
      'wftd_01MB0000000000000000000003',
    );
    expect(api.find('GET', WORKFLOW_RUNS_PATH)?.query.has('page[after]')).toBe(false);
    const runPages = screen.getByRole('navigation', { name: 'Run pages' });
    const next = within(runPages).getByRole('link', { name: 'Next page' });
    const href = new URL(next.getAttribute('href') ?? '', 'http://console.invalid');
    expect(href.pathname).toBe(`/workflows/${IDS.workflow}`);
    expect(href.searchParams.get('runs-after')).toBe(RUN_NEXT);
    expect(href.searchParams.get('versions-after')).toBe(IDS.previousVersion);
    expect(href.searchParams.get('deliveries-after')).toBe('wftd_01MB0000000000000000000003');
  });

  it("shows each version's grant and its egress marks in words", async () => {
    serveWorkflow(api, workflow());
    serveWorkflowVersions(api, [
      workflowVersion({
        grant: { scopes: ['inquiries:write', 'reports:write'], pii: true },
        egress: [
          { 'step-id': 'send_slack', paths: ['trigger.name'], destination: 'hooks.slack.com' },
        ],
      }),
    ]);

    await showIn(DEVELOPER);

    const history = screen.getByRole('table', { name: 'Version history' });
    const row = within(history).getByRole('row', { name: /^1/ });
    expect(row).toHaveTextContent('inquiries:write, reports:write');
    expect(row).toHaveTextContent('Reads personal data unmasked');
    expect(row).toHaveTextContent('send_slack sends personal data to hooks.slack.com (1 path)');
  });

  it('says a draft has no grant yet and a version with no egress sends none', async () => {
    serveWorkflow(api, workflow());
    serveWorkflowVersions(api, [workflowVersion({ grant: null, egress: [] })]);

    await showIn(DEVELOPER);

    const row = within(screen.getByRole('table', { name: 'Version history' })).getByRole('row', {
      name: /^1/,
    });
    expect(row).toHaveTextContent('Derived at publish');
    expect(row).toHaveTextContent('No personal data leaves');
  });
});

describe('manual runs and the test-run link on the workflow page (C118.5, C120.7; Workflow 8D)', () => {
  it('offers manual runs of the live version with workflows:trigger', async () => {
    serveWorkflow(api, workflow());

    await show([...DEVELOPER, 'workflows:trigger']);

    expect(screen.getByRole('form', { name: 'Start manual runs' })).toBeVisible();
  });

  it('offers no manual run without workflows:trigger', async () => {
    serveWorkflow(api, workflow());

    await show(DEVELOPER);

    expect(screen.queryByRole('form', { name: 'Start manual runs' })).toBeNull();
  });

  it('links the sandbox test-run panel with workflows:trigger in a sandbox environment', async () => {
    serveWorkflow(api, workflow());

    await show([...DEVELOPER, 'workflows:trigger']);

    expect(screen.getByRole('link', { name: 'Test run' })).toHaveAttribute(
      'href',
      `/workflows/${IDS.workflow}/test-runs`,
    );
  });
});

describe('cancel older runs when the older versions are archived (C116.2; Workflow 8D)', () => {
  it('offers the live version 2 even when version 1 is archived and so not listed', async () => {
    serveWorkflow(api, workflow());
    serveWorkflowVersions(api, [workflowVersion({ 'version-number': 2 })]);
    api.me({ permissions: [...DEVELOPER, 'workflow-runs:write'] });
    render(
      <ToastProvider>
        {await WorkflowPage({
          params: Promise.resolve({ id: IDS.workflow }),
          searchParams: Promise.resolve({}),
        })}
      </ToastProvider>,
    );

    await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel older runs' }));

    const dialog = screen.getByRole('dialog', { name: 'Cancel the runs of older versions?' });
    expect(
      within(within(dialog).getByRole('combobox', { name: 'Runs of versions before' }))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Version 2']);
  });
});
