import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { WORKFLOW_IDS as IDS, workflowDefinition } from '../../testing/workflow-fixtures';
import { DraftEditor, type DraftResult } from './draft-editor';
import { WORKFLOW_DEFINITION_PROBLEM_WORDS } from './workflow-words';

type Action = (
  state: ActionState<DraftResult>,
  formData: FormData,
) => Promise<ActionResult<DraftResult>>;

describe('DraftEditor (C141.2, C141.4)', () => {
  it('announces a check’s problems, counts them on their step and goes to the step', async () => {
    const action = vi.fn<Action>(() =>
      Promise.resolve({
        ok: true,
        data: {
          saved: false,
          lockVersion: null,
          errors: [
            { pointer: '/steps/0/config/text', code: 'config_invalid', detail: 'is required' },
          ],
          warnings: [],
        },
      }),
    );
    render(
      <DraftEditor
        workflowId={IDS.workflow}
        lockVersion={3}
        definition={JSON.stringify(workflowDefinition(), null, 2)}
        warnings={[]}
        action={action}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Check' }));

    expect(await screen.findByText('1 error and 0 warnings.')).toHaveAttribute('role', 'status');
    expect(action.mock.calls[0]?.[1].get('intent')).toBe('check');
    const step = screen.getByRole('treeitem', {
      name: 'Action send_slack_message: Tell the team, 1 error',
    });
    await userEvent.click(screen.getByRole('button', { name: 'Go to step send_slack' }));
    await waitFor(() => {
      expect(step).toHaveFocus();
    });
  });

  it('keeps the new lock version after a save, and says the draft was saved', async () => {
    const action = vi.fn<Action>(() =>
      Promise.resolve({
        ok: true,
        data: { saved: true, lockVersion: 4, errors: [], warnings: [] },
      }),
    );
    render(
      <DraftEditor
        workflowId={IDS.workflow}
        lockVersion={3}
        definition={JSON.stringify(workflowDefinition(), null, 2)}
        warnings={[]}
        action={action}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    expect(await screen.findByText('The draft was saved. No problems found.')).toHaveAttribute(
      'role',
      'status',
    );
    expect(
      screen.getByRole('form', { name: 'Edit the draft' }).querySelector('[name="lock-version"]'),
    ).toHaveValue('4');
  });

  it('says each problem in words beside its code and the API’s detail, and says when the list is stale (C113.6)', async () => {
    const action = vi.fn<Action>(() =>
      Promise.resolve({
        ok: true,
        data: {
          saved: false,
          lockVersion: null,
          errors: [{ pointer: '/steps/0', code: 'on_null_missing', detail: 'needs on-null' }],
          warnings: [{ pointer: '/steps/0', code: 'output_unread', detail: 'nothing reads it' }],
        },
      }),
    );
    render(
      <DraftEditor
        workflowId={IDS.workflow}
        lockVersion={3}
        definition={JSON.stringify(workflowDefinition(), null, 2)}
        warnings={[]}
        action={action}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Check' }));

    const errors = await screen.findByRole('region', { name: 'Errors' });
    expect(errors).toHaveTextContent(
      `${String(WORKFLOW_DEFINITION_PROBLEM_WORDS.on_null_missing)} needs on-null (on_null_missing)`,
    );
    expect(screen.getByRole('region', { name: 'Warnings' })).toHaveTextContent(
      `${String(WORKFLOW_DEFINITION_PROBLEM_WORDS.output_unread)} nothing reads it (output_unread)`,
    );
    expect(screen.queryByText(/The definition changed after this check/)).toBeNull();

    await userEvent.type(screen.getByRole('textbox', { name: /Definition/ }), ' ');

    expect(screen.getByText(/The definition changed after this check/)).toBeVisible();
  });

  it('says a definition that is not JSON has no outline', () => {
    render(
      <DraftEditor
        workflowId={IDS.workflow}
        lockVersion={0}
        definition="{"
        warnings={[]}
        action={vi.fn<Action>()}
      />,
    );

    expect(screen.queryByRole('tree')).toBeNull();
    expect(
      screen.getByText('The definition is not valid JSON, so it has no outline.'),
    ).toBeVisible();
  });
});
