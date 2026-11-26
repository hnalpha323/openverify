import type { Permission } from '@openverify/core';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunOverlayProps } from '../../../../components/workflows/overlay/run-overlay';
import { ToastProvider } from '../../../../components/toasts';
import { SESSION_COOKIE } from '../../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../../testing/api-routes';
import { fakeRequest } from '../../../../testing/fake-request';
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

const slot = vi.hoisted(() => ({ props: [] as RunOverlayProps[] }));

vi.mock('../../../../components/workflows/overlay/run-overlay', () => ({
  RunOverlay: (props: RunOverlayProps) => {
    slot.props.push(props);
    return <p>Run overlay slot</p>;
  },
}));
vi.mock('next/headers', () =>
  import('../../../../testing/fake-request').then((m) => m.nextHeaders),
);
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const SANDBOX = { id: 'env_01J9ZK3M5Q7R8S9T0V1W2X3Y51', kind: 'sandbox' as const };
const TESTER: Permission[] = ['workflows:read', 'workflows:trigger', 'workflow-runs:read'];
const TEST_RUN = 'wfr_01MB0000000000000000000007';

let api: RouteApi;

beforeEach(() => {
  slot.props.length = 0;
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
  api.me({ permissions: TESTER, environment: SANDBOX, environments: [SANDBOX] });
});

afterEach(() => {
  api.restore();
});

const show = async (searchParams: Record<string, string>) => {
  render(
    <ToastProvider>
      {await TestRunPage({
        params: Promise.resolve({ id: IDS.workflow }),
        searchParams: Promise.resolve(searchParams),
      })}
    </ToastProvider>,
  );
};

describe('the run-overlay slot on the test-run panel (C156.6; V07)', () => {
  it('renders the slot with the chosen version’s structure and the selected run’s steps', async () => {
    serveWorkflowRun(api, workflowRun({ 'test-run-id': TEST_RUN }, TEST_RUN), [
      workflowRunStep({ 'node-id': 'score', 'action-key': 'evaluate_code' }),
    ]);

    await show({ run: TEST_RUN });

    expect(screen.getByText('Run overlay slot')).toBeVisible();
    const props = slot.props.at(-1);
    expect(props?.run?.id).toBe(TEST_RUN);
    expect(props?.run?.steps.map((step) => step.nodeId)).toEqual(['score']);
    expect(props?.run?.steps[0]).toMatchObject({ iterationPath: '', overridden: false });
    const served = testRunDefinition() as { readonly steps: readonly { readonly id: string }[] };
    expect(props?.definition.steps.map((step) => step.id)).toEqual(
      served.steps.map((step) => step.id),
    );
    // The structure only (`structureOf`): no step's configuration reaches the overlay.
    expect(props?.definition.steps.some((step) => 'config' in step)).toBe(false);
    expect(props?.definition.trigger?.config).toEqual({});
  });

  it('renders the slot with no run before one is chosen', async () => {
    await show({});

    expect(screen.queryByText('Run overlay slot')).toBeNull();
  });
});
