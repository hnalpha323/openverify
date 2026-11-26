import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GraphCanvas } from './graph-canvas';
import { LINE, LINE_ADAPTER } from './test-adapter';

describe('GraphCanvas (C155.1)', () => {
  describe('in a browser that can measure it', () => {
    beforeEach(() => {
      vi.stubGlobal(
        'ResizeObserver',
        class {
          observe = vi.fn();
          unobserve = vi.fn();
          disconnect = vi.fn();
        },
      );
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('draws what the adapter describes, named as the outline names it, in its words', () => {
      const onSelect = vi.fn();
      const { container } = render(
        <GraphCanvas
          adapter={LINE_ADAPTER}
          document={LINE}
          issues={[{ pointer: '/nodes/1', detail: 'cannot be reached' }]}
          marks={{ c: 'added' }}
          selectedId="a"
          onSelect={onSelect}
          onEdit={vi.fn()}
        />,
      );

      const node = (id: string) =>
        container.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`);
      expect(node('a')).toHaveAttribute('aria-label', 'Node a');
      expect(node('b')).toHaveAttribute('aria-label', 'Node b, 1 error');
      expect(node('c')).toHaveTextContent('Added');
      expect(screen.getByRole('button', { name: 'Fit the line in view' })).toBeVisible();

      fireEvent.click(node('c') ?? document.body);
      expect(onSelect).toHaveBeenCalledWith('c');
    });
  });

  it('says where to look instead while it cannot draw', () => {
    render(
      <GraphCanvas
        adapter={LINE_ADAPTER}
        document={LINE}
        issues={[]}
        marks={{}}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText(/the outline lists every step/)).toBeVisible();
  });
});
