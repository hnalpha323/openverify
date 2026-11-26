/**
 * C172.1, C172.5: the version's layout arranges the case page's modules in columns by order, a
 * collapsed one behind a disclosure, and each available case action is shown in its placement only
 * (a module the page does not show hands its actions to the header).
 */
import type { CaseLayoutModule } from '@openverify/core';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { availableActions } from '../../../testing/reviewer-fixtures';
import { placeActions } from './action-placements';
import { CaseLayoutGrid } from './case-layout-grid';
import { arrangeModules } from './layout-model';

const LAYOUT = {
  columns: 2,
  modules: [
    { key: 'comments' as const, column: 1, order: 1, collapsed: false },
    { key: 'timeline' as const, column: 1, order: 0, collapsed: false },
    { key: 'graph' as const, column: 2, order: 0, collapsed: true },
    { key: 'attachments' as const, column: 2, order: 1, collapsed: false },
  ],
};

describe('arrangeModules', () => {
  it('orders each column by order, keeping only what the reader sees', () => {
    const visible = new Set<CaseLayoutModule>(['comments', 'timeline', 'graph']);

    expect(arrangeModules(LAYOUT, visible)).toEqual({
      columns: 2,
      placed: [
        [
          { key: 'timeline', collapsed: false },
          { key: 'comments', collapsed: false },
        ],
        [{ key: 'graph', collapsed: true }],
      ],
    });
  });

  it('keeps the default arrangement for a version without a layout', () => {
    expect(arrangeModules(null, new Set(['comments']))).toBeNull();
    expect(arrangeModules(undefined, new Set(['comments']))).toBeNull();
  });
});

const action = (id: string, placement: string) => {
  const base = availableActions().data[0];
  if (base === undefined) throw new Error('fixture');
  return { ...base, id, attributes: { ...base.attributes, label: id, placement } };
};

describe('placeActions', () => {
  it('puts each action in its own placement, and a module the page does not show hands its actions to the header', () => {
    const header = action('cact_01JE00000000000000000000H1', 'header');
    const switcher = action('cact_01JE00000000000000000000S1', 'status-switcher');
    const comments = action('cact_01JE00000000000000000000M1', 'module:comments');
    const hidden = action('cact_01JE00000000000000000000M2', 'module:graph');

    const placed = placeActions([header, switcher, comments, hidden], new Set(['comments']));

    expect(placed.header.map((each) => each.id)).toEqual([header.id, hidden.id]);
    expect(placed.statusSwitcher.map((each) => each.id)).toEqual([switcher.id]);
    expect(placed.byModule.get('comments')?.map((each) => each.id)).toEqual([comments.id]);
    expect(placed.byModule.has('graph')).toBe(false);
  });
});

describe('CaseLayoutGrid', () => {
  it('shows each column as a list of its modules in order, a collapsed one behind a closed disclosure', () => {
    const arrangement = arrangeModules(LAYOUT, new Set(['comments', 'timeline', 'graph']));
    if (arrangement === null) throw new Error('arranged');

    render(
      <CaseLayoutGrid
        arrangement={arrangement}
        nodes={{
          comments: <section aria-label="Comments">comments</section>,
          timeline: <section aria-label="Timeline">timeline</section>,
          graph: <section aria-label="Graph">graph</section>,
        }}
      />,
    );

    const first = within(screen.getByRole('region', { name: 'Column 1' }));
    expect(first.getAllByRole('region').map((region) => region.getAttribute('aria-label'))).toEqual(
      ['Timeline', 'Comments'],
    );
    const second = screen.getByRole('region', { name: 'Column 2' });
    const details = second.querySelector('details');
    expect(details?.open).toBe(false);
    expect(within(second).getByText('Graph', { selector: 'summary' })).toBeVisible();
  });
});
