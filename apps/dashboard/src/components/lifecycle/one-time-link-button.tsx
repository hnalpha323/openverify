'use client';

import { Button } from '@openverify/ui';
import { useState } from 'react';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { Dialog } from '../dialog';
import { FormField, controlClassName } from '../form-field';
import { OneTimeSecretDialog } from '../one-time-secret-dialog';
import { ProblemDisplay } from '../problem-display';
import { SubmitButton } from '../submit-button';
import { formatUtc } from '../timestamp';
import { useFormAction } from '../use-form-action';

/** A one-time link to the hosted flow (C10), as the action returns it once. */
export interface OneTimeLink {
  readonly link: string;
  /** ISO 8601. */
  readonly expiresAt: string;
}

export interface OneTimeLinkButtonProps {
  readonly inquiryId: string;
  readonly action: (
    state: ActionState<OneTimeLink>,
    formData: FormData,
  ) => Promise<ActionResult<OneTimeLink>>;
}

/** Lifetimes offered (C10: 5 minutes to 30 days, never past the inquiry's expiry). */
const LIFETIMES = [
  { value: '', label: 'Template default' },
  { value: '3600', label: '1 hour' },
  { value: '86400', label: '24 hours' },
  { value: '604800', label: '7 days' },
  { value: '2592000', label: '30 days' },
] as const;

/**
 * Generates a single-use link to the hosted flow and shows it once (C21): the link lives in this
 * component's state only while its dialog is open, and is never written to a URL, storage or a
 * log.
 */
export function OneTimeLinkButton({ inquiryId, action }: OneTimeLinkButtonProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [secret, setSecret] = useState<OneTimeLink | null>(null);
  // The link stays only in `secret`, which closing the dialog drops (the action state keeps
  // nothing). A refusal keeps the chosen lifetime (Workflow 2D K003).
  const { pending, problem, clearProblem, formProps } = useFormAction(action, {
    onSuccess: (link) => {
      setFormOpen(false);
      setSecret(link);
    },
  });

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          clearProblem();
          setFormOpen(true);
        }}
      >
        Generate one-time link
      </Button>
      <Dialog
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
        }}
        title="Generate a one-time link"
        description="The end user opens the hosted flow with it once. Older unused links stop working, and no link outlives the inquiry."
        dismissible={!pending}
        size="sm"
      >
        <form {...formProps} className="flex flex-col gap-4">
          <input type="hidden" name="inquiry-id" value={inquiryId} />
          <FormField label="Link lifetime">
            {(control) => (
              <select
                {...control}
                name="expires-in-seconds"
                defaultValue=""
                className={controlClassName(control)}
              >
                {LIFETIMES.map((lifetime) => (
                  <option key={lifetime.value} value={lifetime.value}>
                    {lifetime.label}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <ProblemDisplay problem={problem} />
          <div className="flex flex-wrap justify-end gap-3">
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => {
                setFormOpen(false);
              }}
            >
              Cancel
            </Button>
            <SubmitButton pendingLabel="Generating…" pending={pending}>
              Generate link
            </SubmitButton>
          </div>
        </form>
      </Dialog>
      {secret !== null && (
        <OneTimeSecretDialog
          open
          title="One-time link"
          label="Link"
          secret={secret.link}
          description={`It works once and expires on ${formatUtc(secret.expiresAt)} UTC. This is the only time it is shown: copy it now and send it to the end user.`}
          onClose={() => {
            setSecret(null);
          }}
        />
      )}
    </>
  );
}
