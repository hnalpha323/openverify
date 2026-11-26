import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { WORKFLOW_IDS as IDS } from '../../testing/workflow-fixtures';
import { DraftEditor, type DraftResult } from './draft-editor';

type Action = (
  state: ActionState<DraftResult>,
  formData: FormData,
) => Promise<ActionResult<DraftResult>>;

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
});

const twoActions = {
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
};

const show = (marks: Readonly<Record<string, 'added' | 'changed'>> = {}) => {
  const view = render(
    <DraftEditor
      workflowId={IDS.workflow}
      lockVersion={1}
      definition={JSON.stringify(twoActions, null, 2)}
      warnings={[]}
      marks={marks}
      action={vi.fn<Action>()}
    />,
  );
  const node = (id: string) =>
    view.container.ownerDocument.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`);
  return { node };
};

const layoutOf = () =>
  (
    JSON.parse(screen.getByRole<HTMLTextAreaElement>('textbox', { name: /Definition/ }).value) as {
      layout: Record<string, unknown>;
    }
  ).layout;

/** The element, or a failure naming what is missing. */
function found(element: HTMLElement | null): HTMLElement {
  if (element === null) {
    throw new Error('The canvas drew no such node.');
  }
  return element;
}

describe('the canvas beside the outline (C141.1, C141.3, C141.5)', () => {
  it('summarises the canvas in words and points to the outline (WCAG 1.1.1)', () => {
    show();
    const canvas = screen.getByRole('region', { name: 'Canvas' });
    expect(
      within(canvas).getByText(
        '2 steps, 0 branches, 0 errors. The outline lists the same steps and edits them by keyboard.',
      ),
    ).toBeVisible();
  });

  it('follows a selection between the canvas and the outline', async () => {
    const { node } = show();
    fireEvent.click(found(node('second')));
    expect(
      within(screen.getByRole('region', { name: 'Step settings' })).getByRole('textbox', {
        name: 'Name',
      }),
    ).toHaveValue('Second');
    expect(screen.getByRole('treeitem', { name: 'Action calculate: Second' })).toHaveAttribute(
      'tabindex',
      '0',
    );
    await userEvent.click(screen.getByRole('treeitem', { name: 'Action calculate: First' }));
    expect(node('first')).toHaveClass('selected');
    expect(node('second')).not.toHaveClass('selected');
  });

  it('tidies the layout up as one command that undo takes back', async () => {
    show();
    await userEvent.click(screen.getByRole('button', { name: 'Tidy up' }));
    expect(Object.keys(layoutOf()).sort()).toEqual(['first', 'output', 'second', 'trigger']);
    expect(screen.getByRole('status', { name: 'Editor status' })).toHaveTextContent(
      'Tidied up the layout.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(layoutOf()).toEqual({});
  });

  it('marks the steps the draft changed on the canvas, beside the list', () => {
    const { node } = show({ second: 'added' });
    expect(node('second')).toHaveTextContent('Added');
  });
});
