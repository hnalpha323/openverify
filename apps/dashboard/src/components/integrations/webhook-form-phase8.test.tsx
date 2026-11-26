/** The webhook form's Phase 8 filter keys (C143.4): workflows, case templates and lists. */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ENVIRONMENTS } from '../../testing/api-mock';
import { INTEGRATION_IDS } from './testing-fixtures';
import { CreateWebhookForm, EditWebhookForm } from './webhook-form';

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const GROUPS = [{ label: 'Workflows', names: ['workflow-run.completed'] }];
const VERSIONS = ['2026-10-01'];
const WORKFLOW = 'wfl_01MB0000000000000000000001';
const CASE_TEMPLATE = 'ctmpl_01MB0000000000000000000001';
const LIST = 'lst_01MB0000000000000000000001';

describe('the webhook form’s workflow, case template and list filters (C143.4)', () => {
  it('shows each refusal at its filter, by the API’s pointer', async () => {
    render(
      <CreateWebhookForm
        environmentId={ENVIRONMENTS.sandbox.id}
        action={() =>
          Promise.resolve({
            ok: false,
            problem: {
              title: 'Check the values you entered',
              errors: [
                { pointer: '/data/attributes/filters/workflow-ids/0', detail: 'Bad workflow ID' },
                {
                  pointer: '/data/attributes/filters/case-template-ids/1',
                  detail: 'Bad case template ID',
                },
                { pointer: '/data/attributes/filters/list-ids', detail: 'Duplicate list' },
              ],
            },
          })
        }
        groups={GROUPS}
        apiVersions={VERSIONS}
      />,
    );

    await userEvent.type(screen.getByRole('textbox', { name: /Endpoint URL/ }), 'https://a.test');
    await userEvent.click(screen.getByRole('button', { name: /Create webhook/ }));

    expect(
      await screen.findByRole('textbox', { name: 'Workflow IDs', description: /Bad workflow ID/ }),
    ).toBeVisible();
    expect(
      screen.getByRole('textbox', {
        name: 'Case template IDs',
        description: /Bad case template ID/,
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('textbox', { name: 'List IDs', description: /Duplicate list/ }),
    ).toBeVisible();
  });

  it('starts an edit from the stored filters', () => {
    render(
      <EditWebhookForm
        action={vi.fn()}
        webhookId={INTEGRATION_IDS.webhook}
        defaults={{
          url: 'https://hooks.example.test',
          enabledEvents: ['workflow-run.completed'],
          apiVersion: '2026-10-01',
          inquiryTemplateIds: [],
          accountTypeIds: [],
          workflowIds: [WORKFLOW],
          caseTemplateIds: [CASE_TEMPLATE],
          listIds: [LIST],
          attributeBlocklist: [],
          customHeaderNames: [],
        }}
        groups={GROUPS}
        apiVersions={VERSIONS}
      />,
    );

    expect(screen.getByRole('textbox', { name: 'Workflow IDs' })).toHaveValue(WORKFLOW);
    expect(screen.getByRole('textbox', { name: 'Case template IDs' })).toHaveValue(CASE_TEMPLATE);
    expect(screen.getByRole('textbox', { name: 'List IDs' })).toHaveValue(LIST);
  });
});
