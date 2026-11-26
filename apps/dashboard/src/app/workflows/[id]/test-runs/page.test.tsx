import type { Permission } from '@openverify/core';
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../../components/toasts';
import { SESSION_COOKIE } from '../../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../../testing/api-routes';
import { fakeRequest } from '../../../../testing/fake-request';
import { rscPayloadOf } from '../../../../testing/rsc-payload';
import {
  serveWorkflow,
  serveWorkflowActions,
  serveWorkflowDraft,
  serveWorkflowRun,
  serveWorkflowVersions,
} from '../../../../testing/routes/workflows';
import {
  WORKFLOW_IDS as IDS,
  testRunCatalogue,
  testRunDefinition,
  workflow,
  workflowDraft,
  workflowRun,
  workflowRunStep,
  workflowVersion,
} from '../../../../testing/workflow-fixtures';
import TestRunPage from './page';

vi.mock('next/headers', () =>
  import('../../../../testing/fake-request').then((m) => m.nextHeaders),
);
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const SANDBOX = { id: 'env_01J9ZK3M5Q7R8S9T0V1W2X3Y51', kind: 'sandbox' as const };
const PRODUCTION = { id: 'env_01J9ZK3M5Q7R8S9T0V1W2X3Y52', kind: 'production' as const };
const TESTER: Permission[] = ['workflows:read', 'workflows:trigger', 'workflow-runs:read'];
const TEST_RUN = 'wfr_01MB0000000000000000000007';

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  const base = workflow();
  serveWorkflow(api, {
    ...base,
    relationships: {
      ...base.relationships,
      'draft-version': { data: { type: 'workflow-version', id: IDS.draft } },
    },
  });
  serveWorkflowDraft(
    api,
    IDS.workflow,
    workflowDraft({ definition: testRunDefinition() as never }),
  );
  serveWorkflowVersions(api, [workflowVersion(), workflowDraft()]);
  serveWorkflowActions(api, testRunCatalogue());
});

afterEach(() => {
  api.restore();
});

const element = async (
  permissions: Permission[],
  searchParams: Record<string, string> = {},
  environment: { id: string; kind: 'sandbox' | 'production' } = SANDBOX,
) => {
  api.me({ permissions, environment, environments: [SANDBOX, PRODUCTION] });
  return (
    <ToastProvider>
      {await TestRunPage({
        params: Promise.resolve({ id: IDS.workflow }),
        searchParams: Promise.resolve(searchParams),
      })}
    </ToastProvider>
  );
};

const show = async (...args: Parameters<typeof element>) => {
  render(await element(...args));
};

describe('the sandbox test-run panel (C120.7, C126.4, C141.9)', () => {
  it('says in words that test runs are for sandbox environments, and offers no form in production', async () => {
    await show(TESTER, {}, PRODUCTION);

    expect(screen.getByRole('status', { name: 'Sandbox only' })).toHaveTextContent(
      /Test runs run only in a sandbox environment/,
    );
    expect(screen.queryByRole('form', { name: 'Start a test run' })).toBeNull();
  });

  it('offers the version, the trigger object, the step range, overrides, hosts and acknowledgements', async () => {
    await show(TESTER);

    const form = screen.getByRole('form', { name: 'Start a test run' });
    expect(
      within(within(form).getByRole('combobox', { name: 'Version' }))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['The draft', 'Version 1']);
    expect(within(form).getByRole('radio', { name: 'An existing object' })).toBeChecked();
    expect(within(form).getByRole('radio', { name: 'A synthetic payload' })).not.toBeChecked();
    expect(
      within(within(form).getByRole('combobox', { name: 'Start step' }))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['From the trigger', 'score', 'send_slack', 'decline']);
    expect(within(form).getByRole('textbox', { name: /Output overrides/ })).toBeVisible();
    expect(
      within(form).getByRole('textbox', { name: /Hosts a real request may reach/ }),
    ).toBeVisible();
    expect(
      within(form).getByRole('checkbox', { name: /Run decline for real \(irreversible\)/ }),
    ).not.toBeChecked();
    expect(
      within(form).getByRole('checkbox', { name: /send_slack may send personal data/ }),
    ).not.toBeChecked();
    expect(form).toHaveTextContent(/messages go to the recording provider/);
  });

  it('takes the step range from the URL, so a step can be tested alone', async () => {
    await show(TESTER, { 'start-step': 'score', 'end-step': 'score' });

    const form = screen.getByRole('form', { name: 'Start a test run' });
    expect(within(form).getByRole('combobox', { name: 'Start step' })).toHaveValue('score');
    expect(within(form).getByRole('combobox', { name: 'End step' })).toHaveValue('score');
    expect(screen.getByRole('heading', { name: 'Evaluate Code test of score' })).toBeVisible();
  });

  it('shows a started run: its link, each step with its output, and the console lines', async () => {
    serveWorkflowRun(api, workflowRun({ 'test-run-id': TEST_RUN }, TEST_RUN), [
      workflowRunStep({
        'node-id': 'score',
        'action-key': 'evaluate_code',
        output: { value: 7, 'source-sha256': 'c'.repeat(64) },
        console: ['Synthetic console line'],
      }),
    ]);

    await show(TESTER, { run: TEST_RUN, 'start-step': 'score', 'end-step': 'score' });

    const result = screen.getByRole('region', { name: 'Test run result' });
    expect(within(result).getByRole('link', { name: TEST_RUN })).toHaveAttribute(
      'href',
      `/workflows/runs/${TEST_RUN}`,
    );
    expect(result).toHaveTextContent('"value": 7');
    expect(within(result).getByRole('list', { name: 'Console of score' })).toHaveTextContent(
      'Synthetic console line',
    );
    expect(result).toHaveTextContent(/shown only to the test run’s creator/);
  });

  it('offers searching the messages the run recorded with sandbox:read, by a form that keeps the recipient out of the URL', async () => {
    serveWorkflowRun(api, workflowRun({ 'test-run-id': TEST_RUN }, TEST_RUN), []);

    await show([...TESTER, 'sandbox:read'], { run: TEST_RUN });

    const search = screen.getByRole('form', { name: 'Find recorded messages' });
    expect(search).not.toHaveAttribute('method', 'get');
    expect(within(search).getByRole('combobox', { name: 'Kind' })).toBeVisible();
    expect(within(search).getByRole('textbox', { name: 'Recipient' })).toBeVisible();
  });

  it('offers no message search without sandbox:read', async () => {
    serveWorkflowRun(api, workflowRun({ 'test-run-id': TEST_RUN }, TEST_RUN), []);

    await show(TESTER, { run: TEST_RUN });

    expect(screen.queryByRole('form', { name: 'Find recorded messages' })).toBeNull();
  });

  it('carries no step value or console line into the page without pii:view', async () => {
    serveWorkflowRun(api, workflowRun({ 'test-run-id': TEST_RUN }, TEST_RUN), [
      workflowRunStep({ 'node-id': 'score', input: null, output: null, console: null }),
    ]);

    const payload = await rscPayloadOf(
      await element([...TESTER, 'sandbox:read'], { run: TEST_RUN }),
    );

    expect(payload).not.toContain('Synthetic');
    expect(payload).toContain('Hidden without pii:view');
  });

  it('carries the values the API served into the page with pii:view, so the test above can fail', async () => {
    serveWorkflowRun(api, workflowRun({ 'test-run-id': TEST_RUN }, TEST_RUN), [
      workflowRunStep({ 'node-id': 'score', console: ['Synthetic console line'] }),
    ]);

    const payload = await rscPayloadOf(
      await element([...TESTER, 'sandbox:read', 'pii:view'], { run: TEST_RUN }),
    );

    expect(payload).toContain('Synthetic console line');
    expect(payload).toContain('Synthetic step input');
  });

  it('needs workflows:trigger', async () => {
    await show(['workflows:read']);

    expect(screen.getByText('You do not have access')).toBeVisible();
  });
});
