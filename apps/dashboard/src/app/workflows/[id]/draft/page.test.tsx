import type { Permission } from '@openverify/core';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../../components/toasts';
import { SESSION_COOKIE } from '../../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../../../testing/api-routes';
import { fakeRequest } from '../../../../testing/fake-request';
import { rscPayloadOf } from '../../../../testing/rsc-payload';
import {
  serveVersionDiff,
  serveWorkflow,
  serveWorkflowDraft,
  serveWorkflows,
  serveWorkflowVersion,
} from '../../../../testing/routes/workflows';
import {
  WORKFLOW_IDS as IDS,
  workflow,
  workflowDefinition,
  workflowDraft,
  workflowVersion,
} from '../../../../testing/workflow-fixtures';
import { serveWorkflowActions } from '../../../../testing/routes/workflow-editor';
import { workflowAction } from '../../../../testing/workflow-editor-fixtures';
import WorkflowDraftPage, { metadata } from './page';

vi.mock('next/headers', () =>
  import('../../../../testing/fake-request').then((m) => m.nextHeaders),
);
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
  serveWorkflowActions(api, [
    workflowAction('send_email', {
      kind: 'egress',
      available: false,
      reason: 'provider_not_configured',
    }),
  ]);
  // K9-7: the palette's modules are read from the environment's module workflows; none by default.
  serveWorkflows(api, []);
  // A draft beside a live version reads their diff; these suites change nothing by default.
  serveVersionDiff(api, IDS.draft, {
    'against-version-id': IDS.version,
    steps: { added: [], removed: [], changed: [] },
    edges: { added: [], removed: [] },
    'trigger-changes': [],
    'input-changes': [],
    'output-changes': [],
    'variable-changes': [],
    'layout-changes': [],
  });
});

afterEach(() => {
  api.restore();
});

const withDraft = () =>
  workflow({}, IDS.workflow).relationships['draft-version'].data === null
    ? {
        ...workflow(),
        relationships: {
          ...workflow().relationships,
          'draft-version': { data: { type: 'workflow-version' as const, id: IDS.draft } },
        },
      }
    : workflow();

const show = async (permissions: Permission[]) => {
  api.me({ permissions });
  render(
    <ToastProvider>
      {await WorkflowDraftPage({ params: Promise.resolve({ id: IDS.workflow }) })}
    </ToastProvider>,
  );
};

describe('the draft editor (C141.2, C141.4)', () => {
  it('is titled for the draft', () => {
    expect(metadata.title).toBe('Workflow draft');
  });

  it('outlines the draft and offers its definition for editing at its lock version', async () => {
    serveWorkflow(api, withDraft());
    serveWorkflowDraft(api, IDS.workflow, workflowDraft());

    await show(['workflows:read', 'workflows:write']);

    expect(screen.getByRole('tree', { name: 'Outline of the definition' })).toBeVisible();
    expect(
      screen.getByRole('treeitem', { name: 'Action send_slack_message: Tell the team' }),
    ).toBeVisible();
    const editor = screen.getByRole('form', { name: 'Edit the draft' });
    expect(screen.getByRole('textbox', { name: /Definition/ })).toHaveValue(
      JSON.stringify(workflowDefinition(), null, 2),
    );
    expect(editor.querySelector('input[name="lock-version"]')).toHaveValue('3');
    expect(screen.getByRole('button', { name: 'Check' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeVisible();
  });

  it('offers the catalogue the API serves in the palette, an unbound action as not configured (C141.4)', async () => {
    serveWorkflow(api, withDraft());
    serveWorkflowDraft(api, IDS.workflow, workflowDraft());

    await show(['workflows:read', 'workflows:write']);

    screen.getByRole('treeitem', { name: 'Trigger: The API' }).focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add a step after…' }));
    const palette = screen.getByRole('dialog', { name: 'Add a step' });
    expect(within(palette).getByRole('radio', { name: /Send email/ })).toBeEnabled();
    expect(
      within(palette).getByText('Not configured: no provider is bound for it in this environment.'),
    ).toBeVisible();
    expect(api.find('GET', '/workflow-actions')).toBeDefined();
  });

  it('starts a new draft from the live version at lock version 0 when there is none', async () => {
    serveWorkflow(api, workflow());
    serveWorkflowVersion(
      api,
      workflowVersion({
        definition: workflowDefinition() as ReturnType<
          typeof workflowVersion
        >['attributes']['definition'],
      }),
    );

    await show(['workflows:read', 'workflows:write']);

    expect(screen.getByText(/No draft yet: this starts from the live version/)).toBeVisible();
    const editor = screen.getByRole('form', { name: 'Edit the draft' });
    expect(editor.querySelector('input[name="lock-version"]')).toHaveValue('0');
  });

  it('sends a reader without pii:view the definition and the catalogue only, and asks for nothing else (C120.6)', async () => {
    serveWorkflow(api, withDraft());
    serveWorkflowDraft(api, IDS.workflow, workflowDraft());
    api.me({ permissions: ['workflows:read', 'workflows:write'] });

    const payload = await rscPayloadOf(
      await WorkflowDraftPage({ params: Promise.resolve({ id: IDS.workflow }) }),
    );

    expect(payload).toContain('send_slack_message');
    expect(payload).not.toMatch(/Synthetic step input|Synthetic output value|secret-value/);
    const asked = api.requests.map((request) => `${request.method} ${request.path}`);
    expect(
      asked.filter(
        (request) =>
          !/^GET \/(dashboard\/me|workflows|workflows\/wfl_\w+(\/draft)?|workflow-versions\/wfv_\w+\/diff|workflow-actions)$/.test(
            request,
          ),
      ),
    ).toEqual([]);
  });

  it('shows the definition read-only without workflows:write', async () => {
    serveWorkflow(api, withDraft());
    serveWorkflowDraft(api, IDS.workflow, workflowDraft());

    await show(['workflows:read']);

    expect(screen.queryByRole('form', { name: 'Edit the draft' })).toBeNull();
    expect(screen.getByRole('tree', { name: 'Outline of the definition' })).toBeVisible();
    expect(screen.getByText(/"send_slack_message"/)).toBeVisible();
  });
});

describe('the draft’s changes against the live version (C116.6, C141.5)', () => {
  const NO_CHANGE = { pointer: '', before: null, after: null };

  it('lists what the draft adds, removes and changes, in words, never by colour alone', async () => {
    serveWorkflow(api, withDraft());
    serveWorkflowDraft(api, IDS.workflow, workflowDraft());
    serveVersionDiff(api, IDS.draft, {
      'against-version-id': IDS.version,
      steps: {
        added: ['send_slack'],
        removed: ['old_step'],
        changed: [{ id: 'output', changes: [{ ...NO_CHANGE, pointer: '/steps/1/mappings' }] }],
      },
      edges: { added: ['edge_1'], removed: [] },
      'trigger-changes': [{ ...NO_CHANGE, pointer: '/trigger/type' }],
      'input-changes': [],
      'output-changes': [],
      'variable-changes': [],
      'layout-changes': ['output'],
    });

    await show(['workflows:read', 'workflows:write']);

    const changes = screen.getByRole('region', { name: 'Changes against the live version' });
    expect(changes).toHaveTextContent('Added step send_slack');
    expect(changes).toHaveTextContent('Removed step old_step');
    expect(changes).toHaveTextContent('Changed step output: /steps/1/mappings');
    expect(changes).toHaveTextContent('Added edge edge_1');
    expect(changes).toHaveTextContent('Changed the trigger: /trigger/type');
    expect(changes).toHaveTextContent('Moved only: output');
    expect(api.find('GET', `/workflow-versions/${IDS.draft}/diff`)?.query.get('against')).toBe(
      IDS.version,
    );
  });

  it('asks for no diff when nothing is live yet', async () => {
    const base = withDraft();
    serveWorkflow(api, {
      ...base,
      relationships: { ...base.relationships, 'latest-published-version': { data: null } },
    });
    serveWorkflowDraft(api, IDS.workflow, workflowDraft());

    await show(['workflows:read', 'workflows:write']);

    expect(screen.queryByRole('region', { name: 'Changes against the live version' })).toBeNull();
  });
});

describe('the palette’s modules (K9-7, R005, C119.8)', () => {
  const MODULE_IDS = {
    published: 'wfl_01JM0000000000000000000001',
    unpublished: 'wfl_01JM0000000000000000000002',
    archived: 'wfl_01JM0000000000000000000003',
  } as const;
  const unpublished = (resource: ReturnType<typeof workflow>) => ({
    ...resource,
    relationships: { ...resource.relationships, 'latest-published-version': { data: null } },
  });
  const modules = () => [
    workflow({ name: 'Synthetic address module', kind: 'module' }, MODULE_IDS.published),
    unpublished(
      workflow({ name: 'Synthetic draft module', kind: 'module' }, MODULE_IDS.unpublished),
    ),
    workflow(
      {
        name: 'Synthetic archived module',
        kind: 'module',
        status: 'archived',
        'archived-at': '2026-01-02T00:00:00.000Z',
      },
      MODULE_IDS.archived,
    ),
  ];

  const openPalette = async () => {
    screen.getByRole('treeitem', { name: 'Trigger: The API' }).focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add a step after…' }));
    return screen.getByRole('dialog', { name: 'Add a step' });
  };

  it('offers each published module workflow of the environment, read as filter[kind]=module', async () => {
    serveWorkflow(api, withDraft());
    serveWorkflowDraft(api, IDS.workflow, workflowDraft());
    serveWorkflows(api, modules());

    await show(['workflows:read', 'workflows:write']);
    const palette = await openPalette();

    expect(
      within(palette).getByRole('radio', { name: /Module: Synthetic address module/ }),
    ).toBeEnabled();
    expect(within(palette).queryByRole('radio', { name: /Synthetic draft module/ })).toBeNull();
    expect(within(palette).queryByRole('radio', { name: /Synthetic archived module/ })).toBeNull();
    const read = api.requests.find(
      (request) => request.method === 'GET' && request.path === '/workflows',
    );
    expect(read?.query.get('filter[kind]')).toBe('module');
  });

  it('offers no module to a module’s own draft, which runs none (module_nested)', async () => {
    serveWorkflow(api, {
      ...withDraft(),
      attributes: { ...withDraft().attributes, kind: 'module' },
    });
    serveWorkflowDraft(api, IDS.workflow, workflowDraft());
    serveWorkflows(api, modules());

    await show(['workflows:read', 'workflows:write']);

    expect(
      api.requests.some((request) => request.method === 'GET' && request.path === '/workflows'),
    ).toBe(false);
  });

  it.each([
    ['trigger-account', 'An account action'],
    ['trigger-case', 'A case action'],
  ])(
    'reads the modules for a draft whose trigger is %s, and the palette refuses them while it is (module_refused_for_trigger; KP10-15)',
    async (type, words) => {
      serveWorkflow(api, withDraft());
      const definition = { ...workflowDefinition(), trigger: { type, config: {} } };
      serveWorkflowDraft(
        api,
        IDS.workflow,
        workflowDraft({
          definition: definition as ReturnType<typeof workflowDraft>['attributes']['definition'],
        }),
      );
      serveWorkflows(api, modules());

      await show(['workflows:read', 'workflows:write']);

      // The trigger can change after the page loaded, so the modules are read whatever it is now.
      expect(
        api.requests.some((request) => request.method === 'GET' && request.path === '/workflows'),
      ).toBe(true);
      screen.getByRole('treeitem', { name: `Trigger: ${words}` }).focus();
      await userEvent.keyboard('{Enter}');
      await userEvent.click(screen.getByRole('menuitem', { name: 'Add a step after…' }));
      const palette = screen.getByRole('dialog', { name: 'Add a step' });
      expect(
        within(palette).getByRole('radio', { name: /Module: Synthetic address module/ }),
      ).toBeDisabled();
    },
  );

  it('reads no modules for a reader who cannot edit', async () => {
    serveWorkflow(api, withDraft());
    serveWorkflowDraft(api, IDS.workflow, workflowDraft());
    serveWorkflows(api, modules());

    await show(['workflows:read']);

    expect(
      api.requests.some((request) => request.method === 'GET' && request.path === '/workflows'),
    ).toBe(false);
  });
});
