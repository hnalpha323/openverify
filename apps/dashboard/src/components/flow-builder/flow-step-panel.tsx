'use client';

/**
 * The selected step's panel in the flow builder (C155.3): the step's own form, then the step-panel
 * slot (`check-panels/step-panel.tsx`), which `dashboard-template-forms` fills with the check panels
 * of a verification step (verification round V07).
 */
import type { VerificationConfig } from '@openverify/contracts';
import type { FlowV2 } from '@openverify/flow-spec';
import { useId, type ReactNode } from 'react';
import { FLOW_BUILDER_COPY } from '../../lib/copy/flow-builder';
import { StepPanel } from '../check-panels/step-panel';

export interface FlowStepPanelProps {
  readonly flow: FlowV2;
  readonly stepId: string;
  readonly verificationConfig: VerificationConfig;
  readonly editable: boolean;
  readonly onVerificationConfigChange: (next: VerificationConfig, message: string) => void;
  /** The step's own form, generated from its schema (C155.3), above the slot. */
  readonly children?: ReactNode;
}

const copy = FLOW_BUILDER_COPY.stepPanel;

export function FlowStepPanel({
  flow,
  stepId,
  verificationConfig,
  editable,
  onVerificationConfigChange,
  children,
}: FlowStepPanelProps) {
  const headingId = useId();
  const step = flow.steps.find((candidate) => candidate.id === stepId);
  if (step === undefined) {
    return <p className="text-sm">{copy.missing}</p>;
  }
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <h3 id={headingId} className="text-base font-semibold">
        {copy.heading('name' in step && typeof step.name === 'string' ? step.name : step.id)}
      </h3>
      {children}
      <StepPanel
        flow={flow}
        step={step}
        verificationConfig={verificationConfig}
        editable={editable}
        onVerificationConfigChange={onVerificationConfigChange}
      />
    </section>
  );
}
