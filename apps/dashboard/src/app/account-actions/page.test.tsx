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
import AccountActionPage from './[id]/page';
import AccountActionsPage from './page';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const ACCOUNT_TYPE = 'acctp_01MB0000000000000000000001';
const WRITER: Permission[] = ['workflows:read', 'workflows:write', 'accounts:read'];
const binding = {
  type: 'account-action',
  id: IDS.accountAction,
  attributes: {
    label: 'Re-screen this account',
    status: 'active',
    prefill: { reference: 'account.fields.reference' },
    'created-at': '2026-11-01T09:00:00.000Z',
    'updated-at': '2026-11-01T09:00:00.000Z',
  },
  relationships: {
    workflow: { data: { type: 'workflow', id: IDS.workflow } },
    'account-type': { data: { type: 'account-type', id: ACCOUNT_TYPE } },
  },
};
let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.on('GET', '/account-actions', 200, { data: [binding], links: { next: null } });
  api.on('GET', `/account-actions/${IDS.accountAction}`, 200, { data: binding });
  api.on('GET', '/account-types', 200, { data: [], links: { next: null } });
  serveWorkflows(api, [workflow()]);
  serveWorkflow(api, workflow());
  serveWorkflowVersion(
    api,
    workflowVersion({
      'trigger-type': 'trigger-account',
      inputs: [
        { name: 'reference', type: 'string', required: true },
        { name: 'priority', type: 'integer', required: false },
      ],
    }),
  );
});

afterEach(() => {
  api.restore();
});

describe('account action bindings (C118.7, C141.7)', () => {
  it('lists each binding with its workflow and account type, and offers binding a running workflow', async () => {
    api.me({ permissions: WRITER });
    render(<ToastProvider>{await AccountActionsPage()}</ToastProvider>);

    const table = screen.getByRole('table', { name: 'Account actions' });
    expect(within(table).getByRole('link', { name: 'Re-screen this account' })).toHaveAttribute(
      'href',
      `/account-actions/${IDS.accountAction}`,
    );
    expect(table).toHaveTextContent(ACCOUNT_TYPE);
    expect(api.find('GET', '/workflows')?.query.get('filter[status]')).toBe('running');
    expect(screen.getByRole('form', { name: 'Bind an account action' })).toBeVisible();
  });

  it('edits one binding: a prefill path per input of the live trigger, never a value', async () => {
    api.me({ permissions: WRITER });
    render(
      <ToastProvider>
        {await AccountActionPage({ params: Promise.resolve({ id: IDS.accountAction }) })}
      </ToastProvider>,
    );

    const form = screen.getByRole('form', { name: 'Edit the action' });
    expect(within(form).getByRole('textbox', { name: /reference \(string\)/ })).toHaveValue(
      'account.fields.reference',
    );
    expect(within(form).getByRole('textbox', { name: /priority \(integer\)/ })).toHaveValue('');
    expect(within(form).getByRole('combobox', { name: 'Status' })).toHaveValue('active');
  });

  it('needs workflows:write', async () => {
    api.me({ permissions: ['workflows:read'] });
    render(<ToastProvider>{await AccountActionsPage()}</ToastProvider>);

    expect(screen.getByText('You do not have access')).toBeVisible();
  });
});
