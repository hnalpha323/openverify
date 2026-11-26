import { checkFlowGraph, flowV2Schema, type BranchStep, type FlowV2 } from '@openverify/flow-spec';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BranchRoutes } from './branch-routes';
import { stepTemplate } from './flow-model';

const SIGNAL = 'signals.inquiry/automation_artefact_count';

/**
 * A branch right after consent (no screen between them) with a route on a client-collected
 * flow-provisional signal and a route on a list's match that leads elsewhere than else.
 */
function warnedFlow(waitFor?: BranchStep['waitFor']): FlowV2 {
  return flowV2Schema.parse({
    metadata: { specVersion: 2, id: 'synthetic', version: 1, name: 'Synthetic' },
    entry: 's_consent0',
    steps: [
      stepTemplate('consent', 's_consent0'),
      {
        id: 's_branch00',
        type: 'branch',
        name: 'Risk',
        routes: [
          {
            key: 'bot',
            label: 'Bot',
            condition: { '>': [{ var: SIGNAL }, 2] },
            onNull: 'skip-route',
          },
          {
            key: 'listed',
            label: 'Listed',
            condition: { '===': [{ var: 'lists.lst_01JB0000000000000000000001.matched' }, true] },
            onNull: 'review',
          },
        ],
        ...(waitFor === undefined ? {} : { waitFor }),
      },
      stepTemplate('completion', 's_done0000'),
      stepTemplate('failure', 's_fail0000'),
    ],
    edges: [
      { id: 'e_1', from: 's_consent0', port: 'next', to: 's_branch00' },
      { id: 'e_2', from: 's_branch00', port: 'route:bot', to: 's_fail0000' },
      { id: 'e_3', from: 's_branch00', port: 'route:listed', to: 's_fail0000' },
      { id: 'e_4', from: 's_branch00', port: 'else', to: 's_done0000' },
    ],
  });
}

function show(flow: FlowV2) {
  const onApply = vi.fn();
  const step = flow.steps.find((each) => each.id === 's_branch00') as BranchStep;
  render(
    <BranchRoutes
      flow={flow}
      step={step}
      editable
      problems={checkFlowGraph(flow, { mode: 'save' })}
      onApply={onApply}
    />,
  );
  return { onApply, user: userEvent.setup() };
}

const branchOf = (flow: FlowV2 | undefined) =>
  flow?.steps.find((step) => step.id === 's_branch00') as BranchStep | undefined;

/** The test flow's branch, or a failure naming it. */
function branchIn(flow: FlowV2): BranchStep {
  const step = flow.steps.find((each) => each.id === 's_branch00');
  if (step?.type !== 'branch') {
    throw new Error('The test flow has no branch s_branch00');
  }
  return step;
}

describe('a branch’s warnings in the builder (C150.9, C150.11)', () => {
  it('shows the format’s own warnings at the branch, in words, never as errors', () => {
    show(warnedFlow());

    const warnings = screen.getByRole('list', { name: 'Warnings at this branch' });
    expect(warnings).toHaveTextContent(/client-collected signal/i);
    expect(warnings).toHaveTextContent(/screen after consent/i);
    expect(warnings).toHaveTextContent(/Listed/);
    expect(warnings).toHaveTextContent(/flag_for_review/);
    expect(within(warnings).queryByText(/error/i)).toBeNull();
  });

  it('shows no warning list when the format finds none at the branch', () => {
    const flow = warnedFlow();
    render(
      <BranchRoutes flow={flow} step={branchIn(flow)} editable problems={[]} onApply={vi.fn()} />,
    );

    expect(screen.queryByRole('list', { name: 'Warnings at this branch' })).toBeNull();
  });
});

describe('a branch’s waitFor, edited outside the JSON (C150.5, C150.9)', () => {
  it('names a read signal that the wait does not name, and adds it with a provisional wait', async () => {
    const { onApply, user } = show(warnedFlow());

    const wait = screen.getByRole('group', { name: 'Wait for facts (waitFor)' });
    expect(wait).toHaveTextContent(/not in the wait: .*inquiry\/automation_artefact_count/);
    await user.click(within(wait).getByRole('checkbox', { name: SIGNAL }));

    const next = branchOf(onApply.mock.calls.at(-1)?.[0] as FlowV2 | undefined);
    expect(next?.waitFor).toEqual({ facts: [SIGNAL], maxSeconds: 5 });
  });

  it('keeps the longest wait within the contract’s 1 to 30 seconds, and drops the wait with its last fact', async () => {
    const { onApply, user } = show(warnedFlow({ facts: [SIGNAL], maxSeconds: 5 }));
    const wait = screen.getByRole('group', { name: 'Wait for facts (waitFor)' });
    const seconds = within(wait).getByRole('spinbutton', { name: 'Longest wait, in seconds' });

    fireEvent.change(seconds, { target: { value: '31' } });
    expect(within(wait).getByText(/from 1 to 30 seconds/i)).toBeVisible();
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.change(seconds, { target: { value: '12' } });
    expect(branchOf(onApply.mock.calls.at(-1)?.[0] as FlowV2)?.waitFor).toEqual({
      facts: [SIGNAL],
      maxSeconds: 12,
    });

    await user.click(within(wait).getByRole('checkbox', { name: SIGNAL }));
    expect(branchOf(onApply.mock.calls.at(-1)?.[0] as FlowV2)?.waitFor).toBeUndefined();
  });

  it('says what a value still unknown after the wait does: each route’s onNull', () => {
    show(warnedFlow({ facts: [SIGNAL], maxSeconds: 5 }));

    const after = screen.getByRole('list', { name: 'After the wait, an unknown value follows' });
    expect(after).toHaveTextContent('Route Bot: Try the next route');
    expect(after).toHaveTextContent(
      'Route Listed: Take else, and send the inquiry to review at completion',
    );
  });
});

// A new branch's route has the empty condition `{}` (stepTemplate), which the builder edits as
// "no comparison yet" instead of leaving it to the JSON.
describe('a new branch’s empty route in the condition builder (C155.10)', () => {
  it('offers a comparison for a route whose condition is still empty', () => {
    const flow = warnedFlow();
    const branch = branchIn(flow);
    const empty = {
      ...branch,
      routes: [{ key: 'route_1', label: 'Route 1', condition: {} }],
    };
    render(<BranchRoutes flow={flow} step={empty} editable problems={[]} onApply={vi.fn()} />);

    const route = screen.getByRole('region', { name: 'Condition of the route Route 1' });
    expect(within(route).getByRole('button', { name: 'Add a comparison' })).toBeVisible();
  });
});
