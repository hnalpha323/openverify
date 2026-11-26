/**
 * KP11-95 (8D's R007, checklist line 8D-R007): the wait-for-events form and a conditional route's
 * label input, which had no unit test. Each change applies as one undoable edit through `apply`, with
 * the edited definition, the message the editor announces and the gesture that merges typing.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  emptyDefinition,
  type DraftDefinition,
  type DraftStep,
  type Edited,
} from './document-model';
import { StepForm, type ApplyEdit } from './step-form';

const WAIT: DraftStep = {
  id: 'wait_for_review',
  type: 'wait',
  name: 'Wait for the review',
  mode: 'events',
  subject: 'trigger.inquiry.id',
  events: ['inquiry.approved', 'inquiry.declined'],
  'timeout-seconds': 86_400,
  'on-timeout': 'continue',
};

const CONDITIONAL: DraftStep = {
  id: 'route_by_country',
  type: 'conditional',
  name: 'Route by country',
  routes: [
    { key: 'domestic', label: 'Domestic' },
    { key: 'abroad', label: 'Abroad' },
  ],
};

const definitionWith = (step: DraftStep): DraftDefinition => ({
  ...emptyDefinition(),
  steps: [step, ...emptyDefinition().steps],
});

const show = (step: DraftStep) => {
  const definition = definitionWith(step);
  const apply = vi.fn<ApplyEdit>();
  render(
    <StepForm
      workflowId="wf_01JZ0000000000000000000000"
      step={step}
      definition={definition}
      action={undefined}
      scope={[]}
      apply={apply}
    />,
  );
  return apply;
};

/** The step as the last applied edit leaves it. */
const stepAfter = (
  apply: ReturnType<typeof vi.fn<ApplyEdit>>,
  id: string,
): DraftStep | undefined => {
  const edited: Edited | null | undefined = apply.mock.calls.at(-1)?.[0];
  return edited?.definition.steps.find((step) => step.id === id);
};

describe('the wait-for-events form (KP11-95, R007)', () => {
  it('shows the subject, the timeout, what a timeout does and the events, one per line', () => {
    show(WAIT);

    expect(screen.getByLabelText('subject (required)')).toHaveValue('trigger.inquiry.id');
    expect(screen.getByLabelText('timeout-seconds (required)')).toHaveValue('86400');
    expect(screen.getByLabelText('on-timeout (required)')).toHaveValue('continue');
    expect(screen.getByLabelText('Events, one per line')).toHaveValue(
      'inquiry.approved\ninquiry.declined',
    );
    expect(screen.getByRole('region', { name: 'Filter of Wait for the review' })).toBeVisible();
  });

  it('applies the events as a trimmed list without blank lines, as one edit gesture', () => {
    const apply = show(WAIT);

    fireEvent.change(screen.getByLabelText('Events, one per line'), {
      target: { value: '  inquiry.approved \n\n inquiry.expired\n  \n' },
    });

    expect(stepAfter(apply, WAIT.id)?.events).toEqual(['inquiry.approved', 'inquiry.expired']);
    expect(apply).toHaveBeenLastCalledWith(
      expect.anything(),
      'Changed events of Wait for the review.',
      `wait:${WAIT.id}:events`,
    );
  });

  it('applies a whole number of seconds as a number, and refuses one that is not', async () => {
    const user = userEvent.setup();
    const apply = show(WAIT);
    const timeout = screen.getByLabelText('timeout-seconds (required)');

    await user.clear(timeout);
    await user.type(timeout, '3600');
    expect(stepAfter(apply, WAIT.id)?.['timeout-seconds']).toBe(3600);
    expect(apply).toHaveBeenLastCalledWith(
      expect.anything(),
      'Changed timeout-seconds of Wait for the review.',
      `wait:${WAIT.id}:timeout-seconds`,
    );

    const calls = apply.mock.calls.length;
    await user.type(timeout, '.5');
    expect(apply.mock.calls.length).toBe(calls + 1);
    expect(timeout).toHaveAttribute('aria-invalid', 'true');
  });

  it('applies what a timeout does from its two choices', async () => {
    const user = userEvent.setup();
    const apply = show(WAIT);

    await user.selectOptions(screen.getByLabelText('on-timeout (required)'), 'error');

    expect(stepAfter(apply, WAIT.id)?.['on-timeout']).toBe('error');
  });

  it('shows no event list for a wait on time', () => {
    show({ id: 'pause', type: 'wait', name: 'Pause', mode: 'time', seconds: 60 });

    expect(screen.getByLabelText('seconds (required)')).toHaveValue('60');
    expect(screen.queryByLabelText('Events, one per line')).toBeNull();
  });
});

describe("a conditional route's label (KP11-95, R007)", () => {
  it('shows each route in the order its condition is tried, with its label', () => {
    show(CONDITIONAL);

    const labels = screen.getAllByLabelText('Label');
    expect(labels.map((input) => (input as HTMLInputElement).value)).toEqual([
      'Domestic',
      'Abroad',
    ]);
    expect(labels[0]).toHaveAttribute('maxLength', '80');
    expect(screen.getByRole('group', { name: 'Route 1: Domestic' })).toBeVisible();
  });

  it("renames only that route, trimmed, keyed on the route's key", async () => {
    const user = userEvent.setup();
    const apply = show(CONDITIONAL);
    const domestic = screen.getAllByLabelText('Label')[0] ?? document.body;

    await user.clear(domestic);
    await user.type(domestic, '  Home country  ');

    expect(stepAfter(apply, CONDITIONAL.id)?.routes).toEqual([
      { key: 'domestic', label: 'Home country' },
      { key: 'abroad', label: 'Abroad' },
    ]);
    expect(apply).toHaveBeenLastCalledWith(
      expect.anything(),
      'Renamed the route domestic.',
      `route:${CONDITIONAL.id}:domestic:label`,
    );
  });

  it('applies no empty label: a route always keeps a name', async () => {
    const user = userEvent.setup();
    const apply = show(CONDITIONAL);
    const abroad = screen.getAllByLabelText('Label')[1] ?? document.body;

    await user.clear(abroad);
    await user.type(abroad, '   ');

    expect(apply).not.toHaveBeenCalled();
  });
});
