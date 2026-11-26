import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { OutlineItem } from './definition-outline-model';
import { DefinitionOutline } from './definition-outline';

const item = (
  id: string,
  label: string,
  children: OutlineItem[] = [],
  issues: OutlineItem['issues'] = [],
): OutlineItem => ({ id, label, stepIndex: null, issues, children });

const items = [
  item('trigger', 'Trigger: An event', [
    item('check_risk', 'Conditional: check risk', [
      item('check_risk/route:high', 'Route high', [
        item(
          'send_slack',
          'Action send_slack_message: send slack',
          [],
          [{ pointer: '/steps/1/config', detail: 'is required' }],
        ),
      ]),
    ]),
  ]),
];

describe('DefinitionOutline (C141.2, APG tree view)', () => {
  it('is a tree named for the definition, each item named by its label and error count', () => {
    render(<DefinitionOutline items={items} />);

    const tree = screen.getByRole('tree', { name: 'Outline of the definition' });
    expect(tree).toBeVisible();
    expect(
      screen.getByRole('treeitem', { name: 'Action send_slack_message: send slack, 1 error' }),
    ).toBeVisible();
    expect(screen.getByRole('treeitem', { name: 'Trigger: An event' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('moves with the arrow keys, Home and End, and collapses and expands a group', async () => {
    render(<DefinitionOutline items={items} />);
    const trigger = screen.getByRole('treeitem', { name: 'Trigger: An event' });
    expect(trigger).toHaveAttribute('tabindex', '0');

    trigger.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('treeitem', { name: 'Conditional: check risk' })).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(
      screen.getByRole('treeitem', { name: 'Action send_slack_message: send slack, 1 error' }),
    ).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('treeitem', { name: 'Route high' })).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('treeitem', { name: 'Route high' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(
      screen.queryByRole('treeitem', { name: 'Action send_slack_message: send slack, 1 error' }),
    ).toBeNull();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('treeitem', { name: 'Route high' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await userEvent.keyboard('{Home}');
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('tabindex', '0');
  });

  it('gives each item its own visible text as its whole name, holding no other item’s text (axe label-content-name-mismatch, WCAG 2.5.3)', () => {
    render(<DefinitionOutline items={items} />);
    const treeitems = screen.getAllByRole('treeitem');
    expect(treeitems).toHaveLength(4);
    for (const treeitem of treeitems) {
      expect(treeitem.textContent).toBe(
        treeitem.ownerDocument.getElementById(treeitem.getAttribute('aria-labelledby') ?? '')
          ?.textContent,
      );
    }
    expect(screen.getByRole('treeitem', { name: 'Route high' })).toHaveAttribute('aria-level', '3');
  });
});
