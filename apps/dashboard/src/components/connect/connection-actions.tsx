'use client';

import type { ConnectionDirection, ConnectionStatus } from '@openverify/contracts';
import { Checkbox, Field, Input } from '@openverify/ui';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ConfirmActionButton } from '../confirm-action-button';
import { JsonEditor } from '../json-editor';
import { StepUpCodeField } from '../operators/step-up-code-field';
import { SharePolicyView } from './share-policy-view';
import type { PolicyStatement } from './share-policy-words';

export type ConnectAction = (state: ActionState, formData: FormData) => Promise<ActionResult>;

/** C168.1 (K9-11): the passkey step-up's start. */
export type StartStepUpWebauthn = () => Promise<
  ActionResult<{ readonly options: Record<string, unknown> }>
>;

export interface ConnectionActionHandlers {
  readonly activate: ConnectAction;
  readonly deactivate: ConnectAction;
  readonly reactivate: ConnectAction;
  readonly changePolicy: ConnectAction;
  readonly startStepUpWebauthn?: StartStepUpWebauthn;
}

export interface ConnectionActionButtonsProps {
  readonly connectionId: string;
  readonly status: ConnectionStatus;
  readonly direction: ConnectionDirection;
  /** The counterparty as the operator reads it, for the dialogs' words. */
  readonly counterpartyName: string;
  readonly policyVersion: number;
  /** The current policy in words, shown before the activation is confirmed (C242.1). */
  readonly statements: readonly PolicyStatement[];
  /** The current policy body as JSON, the change dialog's starting text. */
  readonly policyJson: string;
  /** `connect-connections:activate` (organisation-level, admin only). */
  readonly canActivate: boolean;
  /** `connect-connections:write` (organisation-level). */
  readonly canWrite: boolean;
  readonly actions: ConnectionActionHandlers;
}

/** C231.3: the reference the platform seals and never judges; it is not personal data. */
const AGREEMENT_HELP =
  'The reference of the data-sharing agreement between the two organizations, one that also records the transfer safeguards (such as standard contractual clauses) where the source is established in another jurisdiction. Do not enter personal data.';

/**
 * C242.1, C231.3-C231.6: the actions each side may take. The destination's administrator activates
 * a pending connection, reading the policy first and confirming with a second factor; either side
 * deactivates; the source reactivates and changes the policy.
 */
export function ConnectionActionButtons({
  connectionId,
  status,
  direction,
  counterpartyName,
  policyVersion,
  statements,
  policyJson,
  canActivate,
  canWrite,
  actions,
}: ConnectionActionButtonsProps) {
  const isDestination = direction !== 'outbound';
  const isSource = direction !== 'inbound';
  const fields = { 'connection-id': connectionId };
  const awaitsActivation = isDestination && status === 'pending';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start gap-3">
        {awaitsActivation && canActivate && (
          <ConfirmActionButton
            label="Activate"
            tone="primary"
            title={`Activate the connection from ${counterpartyName}`}
            description={`You accept version ${String(policyVersion)} of this share policy for your organization. Shares then reach you under it, each resting on its own consent record.`}
            confirmLabel="Activate"
            pendingLabel="Activating…"
            action={actions.activate}
            fields={{ ...fields, 'policy-version': String(policyVersion) }}
            successMessage="The connection is active."
          >
            <SharePolicyView statements={statements} />
            <Field label="Agreement reference" description={AGREEMENT_HELP}>
              <Input name="agreement-reference" required maxLength={500} autoComplete="off" />
            </Field>
            <Checkbox
              name="acknowledged"
              value="true"
              label="I accept this policy for my organization"
            />
            <StepUpCodeField
              {...(actions.startStepUpWebauthn === undefined
                ? {}
                : { startWebauthn: actions.startStepUpWebauthn })}
            />
          </ConfirmActionButton>
        )}
        {canWrite && isSource && status !== 'archived' && (
          <ConfirmActionButton
            label="Change the policy"
            variant="secondary"
            tone="primary"
            title="Change the share policy"
            description={`This writes version ${String(policyVersion + 1)}. An active connection returns to pending until the destination accepts it; a share token already created keeps the version it was created under.`}
            confirmLabel="Save the new version"
            pendingLabel="Saving…"
            action={actions.changePolicy}
            fields={fields}
            successMessage="The new policy version is saved."
          >
            <JsonEditor
              label="Share policy (JSON)"
              name="share-policy"
              defaultValue={policyJson}
              rows={18}
              required
            />
          </ConfirmActionButton>
        )}
        {canWrite && (status === 'pending' || status === 'active') && (
          <ConfirmActionButton
            label="Deactivate"
            title={`Deactivate the connection with ${counterpartyName}`}
            description="Every share token not redeemed yet expires at once, and a redemption still running fails. Nothing already copied is recalled. Only the source can reactivate it, and the destination must then activate it again."
            confirmLabel="Deactivate"
            pendingLabel="Deactivating…"
            action={actions.deactivate}
            fields={fields}
            successMessage="The connection is inactive."
          />
        )}
        {canWrite && isSource && status === 'inactive' && (
          <ConfirmActionButton
            label="Reactivate"
            tone="primary"
            title={`Reactivate the connection with ${counterpartyName}`}
            description="The connection returns to pending: the destination must activate it again before any share reaches it."
            confirmLabel="Reactivate"
            pendingLabel="Reactivating…"
            action={actions.reactivate}
            fields={fields}
            successMessage="The connection is pending again."
          />
        )}
      </div>
      {awaitsActivation && !canActivate && (
        <p className="text-sm text-ink-muted">
          Only an administrator of your organization can activate a connection, with a second factor
          verified in the last 10 minutes.
        </p>
      )}
    </div>
  );
}
