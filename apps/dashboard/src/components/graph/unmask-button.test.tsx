import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GRAPH_IDS as IDS, NODE_IDS, SHARED_EMAIL } from '../../testing/graph-fixtures';
import { later } from '../../testing/later';
import { GRAPH_PROBLEM_WORDS } from './graph-words';
import { UnmaskButton, type UnmaskAction } from './unmask-button';

const props = { queryId: IDS.query, nodeId: NODE_IDS.email, type: 'email_address' } as const;

describe('the click-to-unmask (C102.6, P17)', () => {
  it('calls the audited unmask only on an explicit press, never on hover or focus, then shows the value', async () => {
    const user = userEvent.setup();
    const unmask = vi.fn<UnmaskAction>(() =>
      later({ ok: true as const, data: { value: SHARED_EMAIL } }),
    );
    render(<UnmaskButton {...props} unmask={unmask} />);
    const button = screen.getByRole('button', {
      name: `Show the value of Email address (confirmed) ${NODE_IDS.email}`,
    });
    fireEvent.mouseOver(button);
    fireEvent.focus(button);
    expect(unmask).not.toHaveBeenCalled();

    button.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByText(SHARED_EMAIL)).toBeVisible();
    expect(unmask).toHaveBeenCalledTimes(1);
    const formData = unmask.mock.calls[0]?.[1];
    expect(formData?.get('graph-query-id')).toBe(IDS.query);
    expect(formData?.get('node-id')).toBe(NODE_IDS.email);
    expect(screen.getByRole('status')).toHaveTextContent('Shown and recorded in the audit log.');
  });

  it.each([
    [429, undefined, /too many graph requests/i],
    [410, 'graph_query_redacted', GRAPH_PROBLEM_WORDS.graph_query_redacted],
    [404, 'graph_node_not_found', GRAPH_PROBLEM_WORDS.graph_node_not_found],
  ] as const)('says a %i in words', async (status, code, words) => {
    const user = userEvent.setup();
    const unmask = vi.fn<UnmaskAction>(() =>
      later({
        ok: false as const,
        problem: {
          title: 'Synthetic',
          status,
          detail: 'Synthetic detail.',
          ...(code === undefined ? {} : { code }),
        },
      }),
    );
    render(<UnmaskButton {...props} unmask={unmask} />);
    await user.click(screen.getByRole('button', { name: /^Show the value/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(words);
    expect(screen.queryByText(SHARED_EMAIL)).toBeNull();
  });

  it('says a value the record no longer holds is not available, never an empty value', async () => {
    const unmask = vi.fn<UnmaskAction>(() => later({ ok: true as const, data: { value: null } }));
    render(<UnmaskButton {...props} unmask={unmask} />);
    await act(async () => {
      screen.getByRole('button', { name: /^Show the value/ }).click();
      await later(undefined, 30);
    });
    expect(screen.getByText('No value is held for this node any more.')).toBeVisible();
  });
});
