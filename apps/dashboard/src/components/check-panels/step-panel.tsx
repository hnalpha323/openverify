'use client';

/**
 * The step-panel slot (C155.3, C153.1; verification round V07): the flow builder renders it for
 * the selected step, beside the step's own form. For a verification step it shows that type's
 * check panels (each check's tier, type, stage with the beta badge and default requirement, what
 * its result does, and the branches of the draft that read it) and hands every change back as a
 * whole `verification-config`; any other step shows nothing here. Created by
 * `dashboard-flow-builder` at `[9c-checkpoint:graph-editor]`; `dashboard-template-forms`' since.
 */
import type { VerificationConfig } from '@openverify/contracts';
import type { FlowV2, FlowV2Step } from '@openverify/flow-spec';
import type { ReactNode } from 'react';
import { apiTypeOfStep } from './check-panel-model';
import { VerificationTypePanel } from './verification-type-panel';

export interface StepPanelProps {
  /** The draft's flow, migrated to v2 when it was stored as v1 (C147.1). */
  readonly flow: FlowV2;
  /** The selected step, one of `flow.steps`. */
  readonly step: FlowV2Step;
  /** The version's `verification-config`, which the check panels edit. */
  readonly verificationConfig: VerificationConfig;
  /** Whether the draft may be changed here: a draft, and `inquiry-templates:write`. */
  readonly editable: boolean;
  /**
   * A new `verification-config`: the builder records it as one undoable edit (with `message` as
   * its announcement) and autosaves the draft with `If-Match` (C155.6).
   */
  readonly onVerificationConfigChange: (next: VerificationConfig, message: string) => void;
}

export function StepPanel({
  flow,
  step,
  verificationConfig,
  editable,
  onVerificationConfigChange,
}: StepPanelProps): ReactNode {
  const apiType = apiTypeOfStep(step.type);
  if (apiType === null) {
    return null;
  }
  return (
    <VerificationTypePanel
      apiType={apiType}
      config={verificationConfig[apiType]}
      flow={flow}
      editable={editable}
      onChange={(next, message) => {
        onVerificationConfigChange({ ...verificationConfig, [apiType]: next }, message);
      }}
    />
  );
}
