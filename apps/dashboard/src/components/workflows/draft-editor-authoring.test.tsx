import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { WORKFLOW_IDS as IDS } from '../../testing/workflow-fixtures';
import { DraftEditor, type DraftResult } from './draft-editor';
import { emptyDefinition, serialise } from './editor/document-model';
import type { CatalogueAction } from './editor/palette-model';

type Action = (
  state: ActionState<DraftResult>,
  formData: FormData,
) => Promise<ActionResult<DraftResult>>;

const ACTIONS: CatalogueAction[] = [
  {
    key: 'calculate',
    version: 1,
    kind: 'control',
    stage: 'ga',
    delivery: 'control',
    adverse: 'never',
    triggers: null,
    available: true,
    reason: null,
  },
];

const twoActions = () => ({
  'schema-version': 1,
  trigger: { type: 'trigger-api', config: {} },
  inputs: [],
  variables: [],
  steps: [
    {
      id: 'first',
      name: 'First',
      type: 'action',
      'action-key': 'calculate',
      'action-version': 1,
      config: {},
    },
    {
      id: 'second',
      name: 'Second',
      type: 'action',
      'action-key': 'calculate',
      'action-version': 1,
      config: {},
    },
    { id: 'output', name: 'Output', type: 'output', mappings: {} },
  ],
  edges: [
    { id: 'e1', from: 'trigger', 'from-port': 'next', to: 'first' },
    { id: 'e2', from: 'first', 'from-port': 'next', to: 'second' },
    { id: 'e3', from: 'second', 'from-port': 'next', to: 'output' },
  ],
  outputs: [],
  layout: {},
});

const show = (definition: string = serialise(emptyDefinition())) => {
  const action = vi.fn<Action>(() =>
    Promise.resolve({ ok: true, data: { saved: true, lockVersion: 1, errors: [], warnings: [] } }),
  );
  render(
    <DraftEditor
      workflowId={IDS.workflow}
      lockVersion={0}
      definition={definition}
      warnings={[]}
      actions={ACTIONS}
      action={action}
    />,
  );
  return action;
};

const tree = () => screen.getByRole('tree', { name: 'Outline of the definition' });
const item = (name: string) => within(tree()).getByRole('treeitem', { name });
const definitionText = () =>
  JSON.parse(
    screen.getByRole<HTMLTextAreaElement>('textbox', { name: /Definition/ }).value,
  ) as ReturnType<typeof twoActions>;

/**
 * Lets the frame the editor asked for run: after an edit it moves focus to the item the command
 * selected in an animation frame, so a test that then moves focus itself waits for that first,
 * whatever the machine's load.
 */
const afterFrame = () =>
  act(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      }),
  );

/** Focuses an outline item, opens its menu with Enter and picks `entry`. */
async function pick(itemName: string, entry: string) {
  await afterFrame();
  item(itemName).focus();
  await userEvent.keyboard('{Enter}');
  const menu = screen.getByRole('menu', { name: `Actions for ${itemName}` });
  const choice = within(menu).getByRole('menuitem', { name: entry });
  choice.focus();
  await userEvent.keyboard('{Enter}');
}

describe('authoring a definition through the outline alone (C141.2, WCAG 2.1.1, 2.5.7)', () => {
  it('sets the trigger, adds a conditional with two routes and a wait, keyboard only', async () => {
    show();

    await pick('Trigger: No trigger yet', 'Set the trigger…');
    const triggerDialog = screen.getByRole('dialog', { name: 'Set the trigger' });
    within(triggerDialog).getByRole('radio', { name: 'The API' }).focus();
    await userEvent.keyboard(' ');
    within(triggerDialog).getByRole('button', { name: 'Set trigger' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(item('Trigger: The API')).toBeVisible();
    expect(screen.getByRole('status', { name: 'Editor status' })).toHaveTextContent(
      'Set the trigger to The API.',
    );

    await pick('Trigger: The API', 'Add a step after…');
    const palette = screen.getByRole('dialog', { name: 'Add a step' });
    within(palette)
      .getByRole('radio', { name: /^Conditional/ })
      .focus();
    await userEvent.keyboard(' ');
    within(palette).getByRole('button', { name: 'Add step' }).focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => {
      expect(item('Conditional: Conditional')).toHaveFocus();
    });

    await pick('Conditional: Conditional', 'Add a branch');
    expect(item('Route 2')).toBeVisible();

    await pick('Route 1', 'Add a step here…');
    const waitPalette = screen.getByRole('dialog', { name: 'Add a step' });
    within(waitPalette).getByRole('button', { name: 'Add step' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(item('Wait: Wait for a time')).toBeVisible();

    const written = definitionText();
    expect(written.trigger).toEqual({ type: 'trigger-api', config: {} });
    expect(written.steps.map((step) => step.id)).toEqual(['output', 'conditional', 'wait']);
    expect(screen.getByText(/Unsaved changes/)).toBeVisible();
  });

  it('undoes and redoes with the keys inside the editor and with the buttons', async () => {
    show(JSON.stringify(twoActions(), null, 2));
    await pick('Action calculate: First', 'Delete…');
    const confirm = screen.getByRole('dialog', { name: 'Delete Action calculate: First?' });
    within(confirm).getByRole('button', { name: 'Delete' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(within(tree()).queryByRole('treeitem', { name: 'Action calculate: First' })).toBeNull();

    await afterFrame();
    item('Action calculate: Second').focus();
    await userEvent.keyboard('{Control>}z{/Control}');
    expect(item('Action calculate: First')).toBeVisible();
    expect(screen.getByRole('status', { name: 'Editor status' })).toHaveTextContent(
      'Undid the last change.',
    );
    await userEvent.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
    expect(within(tree()).queryByRole('treeitem', { name: 'Action calculate: First' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(item('Action calculate: First')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(within(tree()).queryByRole('treeitem', { name: 'Action calculate: First' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(screen.getByRole('status', { name: 'Editor status' })).toHaveTextContent(
      'Nothing to redo.',
    );
  });

  it('leaves Ctrl+Z to a text field outside the outline', async () => {
    show(JSON.stringify(twoActions(), null, 2));
    await pick('Action calculate: First', 'Move down');
    await afterFrame();
    const field = screen.getByRole('textbox', { name: /Definition/ });
    field.focus();
    await userEvent.keyboard('{Control>}z{/Control}');
    expect(definitionText().edges[0]).toMatchObject({ to: 'second' });
  });

  it('moves a step down and up its chain, and says when it cannot', async () => {
    show(JSON.stringify(twoActions(), null, 2));
    await pick('Action calculate: First', 'Move down');
    expect(definitionText().edges.map((edge) => `${edge.from}>${edge.to}`)).toEqual([
      'trigger>second',
      'second>first',
      'first>output',
    ]);
    await afterFrame();
    item('Action calculate: Second').focus();
    await userEvent.keyboard('{Enter}');
    const up = screen.getByRole('menuitem', { name: /Move up/ });
    expect(up).toHaveAttribute('aria-disabled', 'true');
    expect(up).toHaveAccessibleDescription(
      'It cannot move up: nothing of the same shape comes before it.',
    );
  });

  it('connects a path only to the targets the port rules accept', async () => {
    show(JSON.stringify(twoActions(), null, 2));
    await pick('Action calculate: First', 'Connect next step to…');
    const dialog = screen.getByRole('dialog', { name: 'Connect a path' });
    expect(
      within(dialog)
        .getAllByRole('radio')
        .map((radio) => radio.closest('label')?.textContent),
    ).toEqual(['Action calculate: Second (leads here now)', 'Output: Output']);
    within(dialog).getByRole('radio', { name: 'Output: Output' }).focus();
    await userEvent.keyboard(' ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Connect' }));
    expect(definitionText().edges[1]).toMatchObject({ from: 'first', to: 'output' });
  });

  it('renames a step from its settings, and one undo restores the whole name', async () => {
    show(JSON.stringify(twoActions(), null, 2));
    await pick('Action calculate: First', 'Open settings');
    const name = within(screen.getByRole('region', { name: 'Step settings' })).getByRole(
      'textbox',
      { name: 'Name' },
    );
    await waitFor(() => {
      expect(name).toHaveFocus();
    });
    await userEvent.clear(name);
    await userEvent.type(name, 'Score');
    expect(item('Action calculate: Score')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(item('Action calculate: First')).toBeVisible();
  });

  it('saves the definition the outline edited, and says it is saved', async () => {
    const action = show(JSON.stringify(twoActions(), null, 2));
    await pick('Action calculate: First', 'Move down');
    expect(screen.getByText(/Unsaved changes/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('The draft was saved. No problems found.')).toBeVisible();
    const sent = JSON.parse(action.mock.calls[0]?.[1].get('definition') as string) as ReturnType<
      typeof twoActions
    >;
    expect(sent.edges[0]).toMatchObject({ from: 'trigger', to: 'second' });
    expect(screen.queryByText(/Unsaved changes/)).toBeNull();
  });

  it('follows what is typed into the raw definition, and an undo returns to the document before', async () => {
    show(JSON.stringify(twoActions(), null, 2));
    const field = screen.getByRole('textbox', { name: /Definition/ });
    const renamed = twoActions();
    renamed.steps[0] = { ...renamed.steps[0], name: 'Typed' } as (typeof renamed.steps)[0];
    await userEvent.clear(field);
    await userEvent.click(field);
    await userEvent.paste(JSON.stringify(renamed));
    expect(item('Action calculate: Typed')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(item('Action calculate: First')).toBeVisible();
  });

  it('says the outline cannot edit a definition it cannot read, and offers no edits read-only', async () => {
    render(
      <DraftEditor
        workflowId={IDS.workflow}
        lockVersion={0}
        definition={JSON.stringify({ steps: [], edges: [{ id: 1 }] })}
        warnings={[]}
        actions={ACTIONS}
        action={vi.fn<Action>()}
      />,
    );
    expect(
      screen.getByText(
        'The outline cannot edit this definition until its steps and edges have their shape; edit it as JSON.',
      ),
    ).toBeVisible();

    cleanup();
    render(
      <DraftEditor
        workflowId={IDS.workflow}
        lockVersion={0}
        definition={JSON.stringify(twoActions())}
        warnings={[]}
        action={undefined}
      />,
    );
    item('Action calculate: First').focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });
});
