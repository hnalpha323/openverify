import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { DraftSaved } from '../../app/graph/actions';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ACCOUNT_CONFIG, EMAIL_CONFIG, GRAPH_IDS as IDS } from '../../testing/graph-fixtures';
import { later } from '../../testing/later';
import { ToastProvider } from '../toasts';
import { GRAPH_PROBLEM_WORDS } from './graph-words';
import { CreateTemplateForm, DraftEditor, RunQueryForm, STARTER_CONFIG } from './template-forms';

type Plain = (state: ActionState, formData: FormData) => Promise<ActionResult>;
type Saving = (
  state: ActionState<DraftSaved>,
  formData: FormData,
) => Promise<ActionResult<DraftSaved>>;
type Pathed = (
  state: ActionState<{ path: string }>,
  formData: FormData,
) => Promise<ActionResult<{ path: string }>>;

const wrap = (node: ReactNode) => render(<ToastProvider>{node}</ToastProvider>);

describe('the template forms (C102.1, C108)', () => {
  it('creates a template from a starter configuration that publishes as it is', async () => {
    const user = userEvent.setup();
    const action = vi.fn<Pathed>(() => later({ ok: true as const, data: { path: '/x' } }));
    wrap(<CreateTemplateForm action={action} />);
    const editor = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Configuration' });
    expect(JSON.parse(editor.value)).toEqual(STARTER_CONFIG);
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Shared contact details');
    await user.click(screen.getByRole('button', { name: 'Create template' }));
    const sent = action.mock.calls[0]?.[1];
    expect(sent?.get('name')).toBe('Shared contact details');
    expect(JSON.parse(sent?.get('config') as string)).toEqual(STARTER_CONFIG);
  });

  it('shows a refusal at its pointer inside the configuration, in words', async () => {
    const user = userEvent.setup();
    const action = vi.fn<Pathed>(() =>
      later({
        ok: false as const,
        problem: {
          title: 'Check the values you entered',
          errors: [{ pointer: '/data/attributes/config/max-hops', detail: 'Invalid input' }],
        },
      }),
    );
    wrap(<CreateTemplateForm action={action} />);
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'x');
    await user.click(screen.getByRole('button', { name: 'Create template' }));
    const problems = await screen.findByRole('list', { name: 'Problems in Configuration' });
    expect(within(problems).getByText('/max-hops')).toBeVisible();
    expect(within(problems).getByText('Hops (max-hops)')).toBeVisible();
  });

  it('saves a draft, then says at each pointer and in words what publishing would refuse', async () => {
    const user = userEvent.setup();
    const action = vi.fn<Saving>(() =>
      later({
        ok: true as const,
        data: {
          publishProblems: [
            { pointer: '/connect-kinds/1', words: GRAPH_PROBLEM_WORDS.weak_kind_not_allowed },
          ],
        },
      }),
    );
    wrap(
      <DraftEditor
        templateId={IDS.template}
        versionId={IDS.draft}
        config={ACCOUNT_CONFIG}
        action={action}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    const note = await screen.findByRole('note', {
      name: 'Publishing this draft would be refused',
    });
    expect(within(note).getByText('/connect-kinds/1')).toBeVisible();
    expect(within(note).getByText(/A weak kind needs include-weak-kinds/)).toBeVisible();
    const sent = action.mock.calls[0]?.[1];
    expect(sent?.get('graph-query-template-id')).toBe(IDS.template);
    expect(sent?.get('version-id')).toBe(IDS.draft);
  });

  it('runs a template with a labelled field for each parameter and the hint of its kind', async () => {
    const user = userEvent.setup();
    const action = vi.fn<Plain>(() => later({ ok: true as const, data: undefined }));
    wrap(
      <RunQueryForm
        templateId={IDS.template}
        parameters={ACCOUNT_CONFIG.parameters}
        piiView
        action={action}
      />,
    );
    const field = screen.getByRole('textbox', { name: 'account_id' });
    expect(field).toHaveAccessibleDescription(/An account id/);
    await user.type(field, IDS.accountA);
    await user.click(
      screen.getByRole('checkbox', { name: 'Wait for the result (at most 10 seconds)' }),
    );
    await user.click(screen.getByRole('button', { name: 'Run query' }));
    const sent = action.mock.calls[0]?.[1];
    expect(sent?.get('graph-query-template-id')).toBe(IDS.template);
    expect(sent?.get('parameter:account_id')).toBe(IDS.accountA);
    expect(sent?.get('run-sync')).toBe('on');
  });

  it('keeps a person-identifying parameter from a principal without pii:view, saying why', () => {
    wrap(
      <RunQueryForm
        templateId={IDS.template}
        parameters={EMAIL_CONFIG.parameters}
        piiView={false}
        action={vi.fn<Plain>()}
      />,
    );
    expect(screen.getByRole('textbox', { name: 'email' })).toBeDisabled();
    expect(screen.getByText(/identifies a person, so running it needs pii:view/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Run query' })).toBeDisabled();
  });
});
