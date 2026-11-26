import { fireEvent, render } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { CANVAS_ARIA_LABELS } from './canvas-words';
import type { DraftDefinition } from './document-model';
import { WorkflowCanvas } from './workflow-canvas';

beforeAll(() => {
  // jsdom measures nothing; the canvas only needs the observer to exist.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
});

const definition: DraftDefinition = {
  'schema-version': 1,
  trigger: { type: 'trigger-api', config: {} },
  inputs: [],
  variables: [],
  steps: [
    { id: 'check', name: 'Check', type: 'conditional', routes: [{ key: 'high', label: 'High' }] },
    { id: 'notify', name: 'Notify', type: 'action', 'action-key': 'send_slack_message' },
    { id: 'wait', name: 'Wait a day', type: 'wait', mode: 'time', seconds: 86400 },
    { id: 'output', name: 'Output', type: 'output', mappings: {} },
  ],
  edges: [
    { id: 'e1', from: 'trigger', 'from-port': 'next', to: 'check' },
    { id: 'e2', from: 'check', 'from-port': 'route:high', to: 'notify' },
    { id: 'e3', from: 'check', 'from-port': 'else', to: 'wait' },
    { id: 'e4', from: 'notify', 'from-port': 'next', to: 'output' },
    { id: 'e5', from: 'wait', 'from-port': 'next', to: 'output' },
  ],
  outputs: [],
  layout: {},
};

const show = (selectedId: string | null = 'check') => {
  const onSelect = vi.fn();
  const { container } = render(
    <WorkflowCanvas
      definition={definition}
      issues={[
        { pointer: '/steps/1/config/text', detail: 'is required' },
        { pointer: '/steps/1', detail: 'cannot be reached' },
      ]}
      marks={{ wait: 'added', notify: 'changed' }}
      selectedId={selectedId}
      onSelect={onSelect}
      onEdit={vi.fn()}
    />,
  );
  const node = (id: string) =>
    container.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`);
  return { container, node, onSelect };
};

/** The element, or a failure naming what is missing. */
function found(element: HTMLElement | null): HTMLElement {
  if (element === null) {
    throw new Error('The canvas drew no such node.');
  }
  return element;
}

describe('WorkflowCanvas (C141.1, C141.3, C141.5)', () => {
  it('draws each node named as the outline names it, its problems as a badge it is described by', () => {
    const { container, node } = show();
    const notify = node('notify');
    expect(notify).toHaveAttribute('aria-label', 'Action send_slack_message: Notify, 2 errors');
    expect(notify).toHaveTextContent('2 errors');
    const described = (notify?.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => container.ownerDocument.getElementById(id)?.textContent ?? '')
      .join(' ');
    expect(described).toContain('is required');
    expect(described).toContain('cannot be reached');
    expect(node('trigger')).toHaveAttribute('aria-label', 'Trigger: The API');
  });

  it('marks what the draft changed against the live version with an icon and a word', () => {
    const { node } = show();
    expect(node('wait')).toHaveTextContent('Added');
    expect(node('notify')).toHaveTextContent('Changed');
    expect(node('check')).not.toHaveTextContent(/Added|Changed/);
  });

  // A handle is a generic div the library renders: a name there is an ARIA attribute axe refuses
  // (aria-prohibited-attr), so the port is named by a title for the pointer, and the keyboard
  // connects through the outline (C141.2).
  it('gives every port a titled handle with a 24 px hit area and no ARIA attribute, and a way in to every step but the trigger', () => {
    const { node } = show();
    const handles = (id: string) =>
      [...(node(id)?.querySelectorAll<HTMLElement>('.react-flow__handle') ?? [])].map((handle) => [
        handle.dataset.handleid,
        handle.classList.contains('wf-handle'),
        handle.getAttribute('title'),
        [...handle.attributes].some((attribute) => attribute.name.startsWith('aria-')),
      ]);
    expect(handles('check')).toEqual([
      ['in', true, 'Into Conditional: Check', false],
      ['route:high', true, 'Route high of Conditional: Check', false],
      ['else', true, 'Else of Conditional: Check', false],
    ]);
    expect(handles('trigger')).toEqual([['next', true, 'Next of Trigger: The API', false]]);
  });

  it('shows the selected node as selected, and selects the node clicked', () => {
    const { node, onSelect } = show('check');
    expect(node('check')).toHaveClass('selected');
    fireEvent.click(found(node('wait')));
    expect(onSelect).toHaveBeenCalledWith('wait');
  });

  // The library shows `keyboardDisabled` while its keyboard access is on (12.12.0).
  it('keeps the library’s attribution link, and describes its nodes in the console’s words', () => {
    const { container } = show();
    expect(container.querySelector('a[href^="https://reactflow.dev"]')).toHaveTextContent(
      'React Flow',
    );
    expect(container).toHaveTextContent(
      String(CANVAS_ARIA_LABELS['node.a11yDescription.keyboardDisabled']),
    );
  });
});
