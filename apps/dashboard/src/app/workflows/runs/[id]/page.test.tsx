import type { Permission } from '@openverify/core';
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../../components/toasts';
import { SESSION_COOKIE } from '../../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../../testing/api-routes';
import { fakeRequest } from '../../../../testing/fake-request';
import { rscPayloadOf } from '../../../../testing/rsc-payload';
import { serveWorkflowRun, serveWorkflowVersion } from '../../../../testing/routes/workflows';
import { serveWorkflowActions } from '../../../../testing/routes/workflow-editor';
import { workflowAction } from '../../../../testing/workflow-editor-fixtures';
import {
  W1,
  WORKFLOW_IDS as IDS,
  workflowDefinition,
  workflowVersion,
  workflowRun,
  workflowRunStep,
} from '../../../../testing/workflow-fixtures';
import { WORKFLOW_STEP_ERROR_WORDS } from '../../../../components/workflows/workflow-words';
import WorkflowRunPage from './page';

vi.mock('next/headers', () =>
  import('../../../../testing/fake-request').then((m) => m.nextHeaders),
);
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const READER: Permission[] = ['workflow-runs:read', 'workflows:read', 'pii:view'];
/**
 * C141.6: a reader with workflows:read also reads the version's definition, for the path, and the
 * catalogue, for each action's stage.
 */
function serveGraph(on: RouteApi) {
  serveWorkflowVersion(
    on,
    workflowVersion({
      definition: workflowDefinition() as ReturnType<
        typeof workflowVersion
      >['attributes']['definition'],
    }),
  );
  serveWorkflowActions(on, [
    workflowAction('send_slack_message', { kind: 'egress' }),
    workflowAction('run_report', { stage: 'beta' }),
  ]);
}

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  serveGraph(api);
});

afterEach(() => {
  api.restore();
});

const page = () => WorkflowRunPage({ params: Promise.resolve({ id: IDS.run }) });
const show = async (permissions: Permission[] = READER) => {
  api.me({ permissions });
  render(<ToastProvider>{await page()}</ToastProvider>);
};
const value = (name: string) =>
  screen.getByText(name, { selector: 'dt' }).nextElementSibling as HTMLElement;

describe('the run page (C120, C141.6)', () => {
  it('says a completed run with step errors so, with its workflow and version linked', async () => {
    serveWorkflowRun(
      api,
      workflowRun({
        'step-outcomes': {
          succeeded: 2,
          'failed-continued': 1,
          'timed-out': 0,
          'unknown-effect': 1,
          skipped: 0,
        },
      }),
    );

    await show();

    expect(value('Status')).toHaveTextContent('Completed with 2 step errors (1 outcome unknown)');
    expect(screen.getByRole('link', { name: IDS.workflow })).toHaveAttribute(
      'href',
      `/workflows/${IDS.workflow}`,
    );
    expect(value('Started by')).toHaveTextContent(`Event ${IDS.event}`);
  });

  it('says an errored run’s error type and step in words', async () => {
    serveWorkflowRun(
      api,
      workflowRun({
        status: 'errored',
        error: { type: 'resource-error', message: 'The step could not reach its object.' },
        'errored-step': {
          name: 'Run report',
          key: 'run_report',
          type: 'action',
          'action-key': 'run_report',
        },
      }),
    );

    await show();

    expect(value('Status')).toHaveTextContent('Errored');
    expect(value('Error')).toHaveTextContent(
      'resource-error: An object or service the step needed was not available',
    );
    expect(value('Errored step')).toHaveTextContent('Run report (run_report)');
  });

  it('says what a run in progress waits on', async () => {
    serveWorkflowRun(
      api,
      workflowRun({ status: 'in_progress', 'completed-at': null, 'waiting-on': 'event' }),
    );

    await show();

    expect(value('Status')).toHaveTextContent('In progress');
    expect(value('Waiting on')).toHaveTextContent('Waiting for an event');
  });

  it('lists each step with its status, attempts and error type in words', async () => {
    serveWorkflowRun(api, workflowRun(), [
      workflowRunStep(),
      workflowRunStep(
        {
          'node-id': 'call_api',
          status: 'failed',
          attempt: 3,
          'error-type': 'resource-error',
          'error-code': 'http_timeout',
          'effect-status': 'unknown',
          'action-key': 'make_https_request',
          output: null,
          input: null,
        },
        'wfst_01MB0000000000000000000002',
      ),
    ]);

    await show();

    const steps = screen.getByRole('table', { name: 'Steps of this run' });
    const failed = within(steps).getByRole('row', { name: /call_api/ });
    expect(failed).toHaveTextContent('Failed');
    expect(failed).toHaveTextContent('3');
    expect(failed).toHaveTextContent('resource-error (http_timeout)');
    expect(failed).toHaveTextContent('Outcome unknown');
  });

  it('says each step error code in words beside its code (C120.2)', async () => {
    serveWorkflowRun(api, workflowRun(), [
      workflowRunStep({
        'node-id': 'wait_review',
        'node-type': 'wait',
        'action-key': null,
        'action-version': null,
        status: 'timed_out',
        'error-type': 'resource-error',
        'error-code': 'wait_timed_out',
        'effect-status': null,
        output: null,
        input: null,
      }),
    ]);

    await show();

    const row = within(screen.getByRole('table', { name: 'Steps of this run' })).getByRole('row', {
      name: /wait_review/,
    });
    expect(row).toHaveTextContent(
      `resource-error (wait_timed_out): ${String(WORKFLOW_STEP_ERROR_WORDS.wait_timed_out)}`,
    );
  });

  it('draws the path taken over a read-only canvas and as a list, each status an icon and a word (C141.6)', async () => {
    serveWorkflowRun(api, workflowRun(), [workflowRunStep()]);

    await show();

    const path = screen.getByRole('region', { name: 'Path taken' });
    const list = within(path).getByRole('list', { name: 'Path taken as a list' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Trigger: The API: ▶ Started',
      'Action send_slack_message: Tell the team: ✓ Succeeded',
    ]);
    expect(path).toHaveTextContent('The run reached 1 of 1 steps.');
    expect(api.find('GET', `/workflow-versions/${IDS.version}`)).toBeDefined();
    const row = within(screen.getByRole('table', { name: 'Steps of this run' })).getByRole('row', {
      name: /send_slack/,
    });
    expect(row).toHaveTextContent('✓ Succeeded');
  });

  it('says the path needs workflows:read, and reads no version without it', async () => {
    serveWorkflowRun(api, workflowRun(), [workflowRunStep()]);

    await show(['workflow-runs:read', 'pii:view']);

    expect(screen.getByRole('region', { name: 'Path taken' })).toHaveTextContent(
      'Drawing the path needs workflows:read, to read the version’s definition.',
    );
    expect(api.find('GET', `/workflow-versions/${IDS.version}`)).toBeUndefined();
  });

  it('shows a beta report step’s badge and each match’s tier, stage and confidence (C141.9, H10)', async () => {
    serveWorkflowRun(api, workflowRun(), [
      workflowRunStep({
        'node-id': 'screen',
        'action-key': 'run_report',
        output: {
          'has-match': true,
          matches: [
            {
              id: IDS.match,
              method: 'fuzzy-name',
              tier: 'H',
              stage: 'beta',
              confidence: 0.82,
              approximate: false,
            },
          ],
        },
      }),
    ]);

    await show();

    const row = within(screen.getByRole('table', { name: 'Steps of this run' })).getByRole('row', {
      name: /screen/,
    });
    expect(within(row).getAllByText('Beta').length).toBeGreaterThanOrEqual(1);
    expect(row).toHaveTextContent('fuzzy-name');
    expect(row).toHaveTextContent('Tier H');
    expect(row).toHaveTextContent('confidence 0.82');
  });

  it('carries no masked value into the page through the path either (C120.6)', async () => {
    serveWorkflowRun(
      api,
      workflowRun({ outputs: null, variables: null, inputs: null, 'trigger-snapshot': null }),
      [workflowRunStep({ input: null, output: null })],
    );
    api.me({ permissions: ['workflow-runs:read', 'workflows:read'] });

    const payload = await rscPayloadOf(await page());

    expect(payload).not.toContain('Synthetic');
    expect(payload).toContain('Hidden without pii:view');
    expect(payload).toContain('send_slack');
  });

  it('shows values as the API served them with pii:view', async () => {
    serveWorkflowRun(api, workflowRun(), [workflowRunStep()]);

    await show();

    expect(value('Outputs')).toHaveTextContent('Synthetic output value');
  });

  it('says a masked value is hidden, a purged one purged and a redacted one redacted, never empty', async () => {
    serveWorkflowRun(
      api,
      workflowRun({ outputs: null, variables: null, inputs: null, 'trigger-snapshot': null }),
    );

    await show(['workflow-runs:read']);

    expect(value('Outputs')).toHaveTextContent('Hidden without pii:view');

    api.restore();
    api = routeApi();
    serveGraph(api);
    serveWorkflowRun(
      api,
      workflowRun({
        outputs: null,
        variables: null,
        inputs: null,
        'trigger-snapshot': null,
        'values-purged-at': W1,
      }),
    );
    api.me({ permissions: READER });
    const purged = await page();
    expect(await rscPayloadOf(purged)).toContain('Purged by retention');
  });

  it('carries no value the API masked into the page', async () => {
    serveWorkflowRun(
      api,
      workflowRun({ outputs: null, variables: null, inputs: null, 'trigger-snapshot': null }),
      [workflowRunStep({ input: null, output: null })],
    );
    api.me({ permissions: ['workflow-runs:read'] });

    expect(await rscPayloadOf(await page())).not.toContain('Synthetic');
  });

  it('shows the forbidden panel without workflow-runs:read', async () => {
    await show(['workflows:read']);

    expect(screen.getByText('You do not have access')).toBeVisible();
  });
});

describe('the run page’s controls (C120.3 to C120.5, C120.9, C141.6)', () => {
  const errored = () =>
    workflowRun({
      status: 'errored',
      error: { type: 'resource-error', message: 'The step could not reach its object.' },
      'errored-step': {
        name: 'Run report',
        key: 'run_report',
        type: 'action',
        'action-key': 'run_report',
      },
    });
  const OPERATOR: Permission[] = [...READER, 'workflow-runs:write'];
  const controls = () => screen.getByRole('group', { name: 'Run actions' });

  it('offers resume and rerun on an errored run with workflow-runs:write', async () => {
    serveWorkflowRun(api, errored());

    await show(OPERATOR);

    const group = controls();
    expect(within(group).getByRole('button', { name: 'Resume' })).toBeVisible();
    expect(within(group).getByRole('button', { name: 'Rerun' })).toBeVisible();
    expect(within(group).queryByRole('button', { name: 'Cancel run' })).toBeNull();
  });

  it('offers cancel on a run in progress', async () => {
    serveWorkflowRun(api, workflowRun({ status: 'in_progress', 'completed-at': null }));

    await show(OPERATOR);

    expect(within(controls()).getByRole('button', { name: 'Cancel run' })).toBeVisible();
    expect(within(controls()).queryByRole('button', { name: 'Rerun' })).toBeNull();
  });

  it('offers no control without workflow-runs:write or workflow-runs:redact', async () => {
    serveWorkflowRun(api, errored());

    await show();

    expect(screen.queryByRole('group', { name: 'Run actions' })).toBeNull();
  });

  it('offers redaction with workflow-runs:redact, and not once the run is redacted', async () => {
    serveWorkflowRun(api, workflowRun());

    await show([...READER, 'workflow-runs:redact']);

    expect(within(controls()).getByRole('button', { name: 'Redact run' })).toBeVisible();

    api.restore();
    api = routeApi();
    serveGraph(api);
    serveWorkflowRun(api, workflowRun({ 'redacted-at': W1, outputs: null, variables: null }));
    api.me({ permissions: [...READER, 'workflow-runs:redact'] });
    expect(await rscPayloadOf(await page())).not.toContain('Redact run');
  });
});
