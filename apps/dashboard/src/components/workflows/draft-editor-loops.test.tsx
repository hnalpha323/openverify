import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { WORKFLOW_IDS as IDS } from '../../testing/workflow-fixtures';
import { DraftEditor, type DraftResult } from './draft-editor';
import { ConditionBuilder } from './editor/condition-builder';

type Action = (
  state: ActionState<DraftResult>,
  formData: FormData,
) => Promise<ActionResult<DraftResult>>;

const MODULE = { id: 'wfl_01JB0000000000000000000007', name: 'Synthetic screening' };

const calculate = (id: string, name: string) => ({
  id,
  name,
  type: 'action',
  'action-key': 'calculate',
  'action-version': 1,
  config: {},
});

/** A for-each loop whose body holds one action, and a while loop after it. */
const looped = () => ({
  'schema-version': 1,
  trigger: { type: 'trigger-api', config: {} },
  inputs: [],
  variables: [],
  steps: [
    { id: 'each', name: 'Each item', type: 'loop', mode: 'for-each', items: 'trigger.items' },
    calculate('tag', 'Tag'),
    {
      id: 'again',
      name: 'Again',
      type: 'loop',
      mode: 'while',
      condition: false,
      'max-iterations': 10,
    },
    calculate('inner', 'Inner'),
    { id: 'output', name: 'Output', type: 'output', mappings: {} },
  ],
  edges: [
    { id: 'e1', from: 'trigger', 'from-port': 'next', to: 'each' },
    { id: 'e2', from: 'each', 'from-port': 'body', to: 'tag' },
    { id: 'e3', from: 'each', 'from-port': 'done', to: 'again' },
    { id: 'e4', from: 'again', 'from-port': 'body', to: 'inner' },
    { id: 'e5', from: 'inner', 'from-port': 'next', to: 'again', 'to-port': 'continue' },
    { id: 'e6', from: 'again', 'from-port': 'done', to: 'output' },
  ],
  outputs: [],
  layout: {},
});

function show() {
  const action = vi.fn<Action>(() =>
    Promise.resolve({ ok: true, data: { saved: true, lockVersion: 1, errors: [], warnings: [] } }),
  );
  render(
    <DraftEditor
      workflowId={IDS.workflow}
      lockVersion={0}
      definition={JSON.stringify(looped(), null, 2)}
      warnings={[]}
      actions={[]}
      modules={[MODULE]}
      action={action}
    />,
  );
}

const tree = () => screen.getByRole('tree');
const item = (name: string) => within(tree()).getByRole('treeitem', { name });
const definitionText = () =>
  JSON.parse(screen.getByRole<HTMLTextAreaElement>('textbox', { name: /Definition/ }).value) as {
    steps: Record<string, unknown>[];
    edges: Record<string, unknown>[];
  };
const afterFrame = () =>
  act(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      }),
  );

async function pick(itemName: string, entry: string) {
  await afterFrame();
  item(itemName).focus();
  await userEvent.keyboard('{Enter}');
  const menu = screen.getByRole('menu', { name: `Actions for ${itemName}` });
  const choice = within(menu).getByRole('menuitem', { name: entry });
  choice.focus();
  await userEvent.keyboard('{Enter}');
}

// K9-7 (Phase 8's R005): loops and modules authored outside the raw JSON, keyboard first.
describe('loops and modules in the workflow editor, from the outline (R005)', () => {
  it('leads a body step back into its loop’s continue port from the step’s menu', async () => {
    show();

    await pick('Action calculate: Tag', 'Lead next back to Loop: Each item');

    expect(definitionText().edges).toContainEqual(
      expect.objectContaining({
        from: 'tag',
        'from-port': 'next',
        to: 'each',
        'to-port': 'continue',
      }),
    );
  });

  it('offers the listed workflows as modules in the palette', async () => {
    show();

    await pick('Action calculate: Tag', 'Add a step after…');

    expect(screen.getByRole('radio', { name: /Module: Synthetic screening/ })).toBeVisible();
  });

  it('edits a for-each loop’s list and a while loop’s bound and condition in their settings', async () => {
    show();

    await pick('Loop: Each item', 'Open settings');
    const each = screen.getByRole('region', { name: 'Step settings' });
    const items = within(each).getByRole('textbox', { name: 'List to loop over' });
    expect(items).toHaveValue('trigger.items');
    await userEvent.clear(items);
    await userEvent.type(items, 'trigger.tags');
    expect(definitionText().steps[0]?.items).toBe('trigger.tags');

    await pick('Loop: Again', 'Open settings');
    const again = screen.getByRole('region', { name: 'Step settings' });
    expect(within(again).getByRole('region', { name: 'Condition of Again' })).toBeVisible();
    const most = within(again).getByRole('spinbutton', { name: 'Most times the body runs' });
    await userEvent.clear(most);
    await userEvent.type(most, '25');
    expect(definitionText().steps[2]?.['max-iterations']).toBe(25);
  });
});

describe('the condition builder’s list predicate (R005, C114.6)', () => {
  it('compares a list’s elements and says what an unreadable element does', async () => {
    const onChange = vi.fn();
    render(
      <ConditionBuilder
        label="Condition of the route VIP"
        condition={{ some: [{ var: 'trigger.tags' }, { '===': [{ var: '' }, 'vip'] }] }}
        onNull={undefined}
        position="route"
        scope={[
          {
            path: 'trigger.tags',
            type: 'list',
            options: [],
            nullable: false,
            pii: false,
            source: 'Trigger',
          },
        ]}
        onChange={onChange}
      />,
    );

    const comparison = screen.getByRole('combobox', {
      name: 'Comparison of comparison 1 of group 1',
    });
    expect(comparison).toHaveValue('any-is');
    const unreadable = screen.getByRole('combobox', {
      name: 'When an element of comparison 1 of group 1 cannot be read',
    });
    await userEvent.selectOptions(unreadable, 'exclude');

    expect(onChange).toHaveBeenLastCalledWith(
      { some: [{ var: 'trigger.tags' }, { '===': [{ var: '' }, 'vip'] }, 'exclude'] },
      undefined,
    );
  });
});
