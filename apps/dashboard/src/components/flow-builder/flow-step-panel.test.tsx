import type { VerificationConfig } from '@openverify/contracts';
import { migrateFlow } from '@openverify/flow-spec';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { StepPanelProps } from '../check-panels/step-panel';
import { VERSION_CONTENT } from '../../testing/lifecycle-fixtures';
import { FlowStepPanel } from './flow-step-panel';

const slot = vi.hoisted(() => ({ props: [] as StepPanelProps[] }));

vi.mock('../check-panels/step-panel', () => ({
  StepPanel: (props: StepPanelProps) => {
    slot.props.push(props);
    return <p>Step panel slot for {props.step.id}</p>;
  },
}));

const flow = migrateFlow(VERSION_CONTENT.flow);
const config: VerificationConfig = VERSION_CONTENT['verification-config'];

describe('the flow builder’s step panel (C155.3; V07)', () => {
  it('renders the step-panel slot for the selected step, with the draft’s flow and config', () => {
    const step = flow.steps[1];
    if (step === undefined) {
      throw new Error('The default flow has a second step.');
    }
    const onChange = vi.fn();

    render(
      <FlowStepPanel
        flow={flow}
        stepId={step.id}
        verificationConfig={config}
        editable
        onVerificationConfigChange={onChange}
      />,
    );

    expect(screen.getByText(`Step panel slot for ${step.id}`)).toBeVisible();
    expect(slot.props.at(-1)).toEqual({
      flow,
      step,
      verificationConfig: config,
      editable: true,
      onVerificationConfigChange: onChange,
    });
  });

  it('renders no slot for a step the flow does not hold', () => {
    slot.props.length = 0;

    render(
      <FlowStepPanel
        flow={flow}
        stepId="missing"
        verificationConfig={config}
        editable={false}
        onVerificationConfigChange={vi.fn()}
      />,
    );

    expect(slot.props).toEqual([]);
    expect(screen.getByText(/no longer in the flow/)).toBeVisible();
  });
});
