import type { Permission } from '@openverify/core';
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/toasts';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import {
  serveWorkflow,
  serveWorkflowVersion,
  serveWorkflows,
} from '../../testing/routes/workflows';
import { WORKFLOW_IDS as IDS, workflow, workflowVersion } from '../../testing/workflow-fixtures';
import CaseActionPage from './[id]/page';
import CaseActionsPage from './page';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const CASE_ACTION = 'cact_01MB0000000000000000000001';
const WRITER: Permission[] = ['workflows:read', 'workflows:write'];
const binding = {
  type: 'case-action',
  id: CASE_ACTION,
  attributes: {
    label: 'Escalate',
    status: 'archived',
    placement: 'header',
    prefill: {},
    'created-at': '2026-11-01T09:00:00.000Z',
    'updated-at': '2026-11-01T09:00:00.000Z',
  },
  relationships: {
    workflow: { data: { type: 'workflow', id: IDS.workflow } },
    'case-templates': { data: [{ type: 'case-template', id: IDS.caseTemplate }] },
  },
};
let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.on('GET', '/case-actions', 200, { data: [binding], links: { next: null } });
  api.on('GET', `/case-actions/${CASE_ACTION}`, 200, { data: binding });
  serveWorkflows(api, [workflow()]);
  serveWorkflow(api, workflow());
  serveWorkflowVersion(
    api,
    workflowVersion({
      'trigger-type': 'trigger-case',
      inputs: [{ name: 'note', type: 'string', required: false }],
    }),
  );
});

afterEach(() => {
  api.restore();
});

describe('case action bindings (C140.1, C141.7)', () => {
  it('lists each binding with its templates in words, and offers binding a running workflow', async () => {
    api.me({ permissions: WRITER });
    render(<ToastProvider>{await CaseActionsPage()}</ToastProvider>);

    const table = screen.getByRole('table', { name: 'Case actions' });
    expect(within(table).getByRole('row', { name: /Escalate/ })).toHaveTextContent('Archived');
    expect(table).toHaveTextContent(IDS.caseTemplate);
    expect(screen.getByRole('form', { name: 'Bind a case action' })).toBeVisible();
  });

  it('edits one binding with its templates and a prefill per input', async () => {
    api.me({ permissions: WRITER });
    render(
      <ToastProvider>
        {await CaseActionPage({ params: Promise.resolve({ id: CASE_ACTION }) })}
      </ToastProvider>,
    );

    const form = screen.getByRole('form', { name: 'Edit the action' });
    expect(within(form).getByRole('textbox', { name: /Case template ids/ })).toHaveValue(
      IDS.caseTemplate,
    );
    expect(within(form).getByRole('textbox', { name: /note \(string\)/ })).toHaveValue('');
  });
});
