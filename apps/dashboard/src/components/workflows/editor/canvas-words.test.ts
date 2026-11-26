import { describe, expect, it } from 'vitest';
import { CANVAS_ARIA_LABELS } from './canvas-words';

/** The keys of the library's `AriaLabelConfig` at @xyflow/react 12.12.0. */
const LIBRARY_KEYS = [
  'node.a11yDescription.default',
  'node.a11yDescription.keyboardDisabled',
  'node.a11yDescription.ariaLiveMessage',
  'edge.a11yDescription.default',
  'controls.ariaLabel',
  'controls.zoomIn.ariaLabel',
  'controls.zoomOut.ariaLabel',
  'controls.fitView.ariaLabel',
  'controls.interactive.ariaLabel',
  'minimap.ariaLabel',
  'handle.ariaLabel',
] as const;

describe('the canvas library’s strings in the console’s words (C141.3)', () => {
  it('replaces every string the library would say itself', () => {
    expect(Object.keys(CANVAS_ARIA_LABELS).sort()).toEqual([...LIBRARY_KEYS].sort());
    for (const key of LIBRARY_KEYS) {
      const value = CANVAS_ARIA_LABELS[key];
      expect(typeof value === 'function' || (typeof value === 'string' && value.length > 0)).toBe(
        true,
      );
    }
  });

  it('points a node’s description at the outline, and says where a moved node went', () => {
    expect(CANVAS_ARIA_LABELS['node.a11yDescription.default']).toContain('outline');
    const live = CANVAS_ARIA_LABELS['node.a11yDescription.ariaLiveMessage'];
    expect(live?.({ direction: 'down', x: 10, y: 20 })).toBe('Moved the step down, to 10, 20.');
  });
});
