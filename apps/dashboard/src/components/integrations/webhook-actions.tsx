'use client';

import {
  WEBHOOK_PREVIOUS_SECRET_DEFAULT_TTL_SECONDS,
  WEBHOOK_PREVIOUS_SECRET_MAX_TTL_SECONDS,
  type WebhookStatus,
} from '@openverify/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ConfirmActionButton } from '../confirm-action-button';
import { FormField, controlClassName } from '../form-field';
import { formatUtc } from '../timestamp';
import type { CreatedWebhook, RotatedSecret } from './action-data';
import { InstantActionButton } from './instant-action-button';
import { SECONDARY_LINK_BUTTON } from './link-button';
import { SecretActionButton } from './secret-action-button';

type Action<Data = undefined> = (
  state: ActionState<Data>,
  formData: FormData,
) => Promise<ActionResult<Data>>;

export interface WebhookActionsProps {
  readonly webhookId: string;
  readonly status: WebhookStatus;
  readonly enable: Action;
  readonly disable: Action;
  readonly archive: Action;
  readonly clone: Action<CreatedWebhook>;
  readonly rotate: Action<RotatedSecret>;
}

const SECONDS = new Intl.NumberFormat('en-US');

/**
 * The changes an operator with `webhooks:write` can make to a webhook (C14): edit, enable or
 * disable, rotate the signing secret with an overlap, clone, archive. An archived webhook can
 * only be cloned. New secrets are shown once, in the one-time secret dialog.
 */
export function WebhookActions({
  webhookId,
  status,
  enable,
  disable,
  archive,
  clone,
  rotate,
}: WebhookActionsProps) {
  const router = useRouter();
  const fields = { 'webhook-id': webhookId };

  const cloneButton = (
    <SecretActionButton
      label="Clone"
      title="Clone this webhook?"
      description="The copy has the same URL, events, API version, custom headers, filters and blocklist, and a new signing secret. It starts disabled."
      confirmLabel="Clone webhook"
      pendingLabel="Cloning…"
      action={clone}
      fields={fields}
      secretTitle="Webhook cloned"
      secretLabel="Signing secret"
      secretDescription={() => 'The copy is disabled: enable it once its endpoint is ready.'}
      onClosed={(data) => {
        router.push(`/webhooks/${data.id}`);
      }}
    />
  );

  if (status === 'archived') {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-ink-muted">
          An archived webhook never receives events again and cannot change.
        </p>
        {cloneButton}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-start gap-3">
      <Link href={`/webhooks/${webhookId}/edit`} className={SECONDARY_LINK_BUTTON}>
        Edit
      </Link>
      {status === 'disabled' ? (
        <InstantActionButton
          label="Enable"
          pendingLabel="Enabling…"
          action={enable}
          fields={fields}
          successMessage="The webhook is enabled."
        />
      ) : (
        <InstantActionButton
          label="Disable"
          pendingLabel="Disabling…"
          action={disable}
          fields={fields}
          successMessage="The webhook is disabled."
        />
      )}
      <SecretActionButton
        label="Rotate secret"
        title="Rotate the signing secret?"
        description="Deliveries are signed with a new secret. During the overlap they also carry a signature made with the current one, so your endpoint keeps verifying them while you switch."
        confirmLabel="Rotate"
        pendingLabel="Rotating…"
        action={rotate}
        fields={fields}
        secretTitle="New signing secret"
        secretLabel="Signing secret"
        secretDescription={(data) =>
          `The previous secret also signs deliveries until ${formatUtc(data.previousSecretExpiresAt)} UTC.`
        }
      >
        <FormField
          label="Overlap in seconds"
          description={`How long the current secret keeps signing too, up to ${SECONDS.format(WEBHOOK_PREVIOUS_SECRET_MAX_TTL_SECONDS)} (7 days). 0 retires it now.`}
        >
          {(control) => (
            <input
              {...control}
              type="number"
              name="previous-secret-expires-in-seconds"
              min={0}
              max={WEBHOOK_PREVIOUS_SECRET_MAX_TTL_SECONDS}
              step={1}
              defaultValue={WEBHOOK_PREVIOUS_SECRET_DEFAULT_TTL_SECONDS}
              className={controlClassName(control)}
            />
          )}
        </FormField>
      </SecretActionButton>
      {cloneButton}
      <ConfirmActionButton
        label="Archive"
        title="Archive this webhook?"
        description="It never receives events again, and it cannot be changed or enabled again. Its deliveries stay listed."
        confirmLabel="Archive webhook"
        pendingLabel="Archiving…"
        action={archive}
        fields={fields}
        successMessage="The webhook is archived."
      />
    </div>
  );
}
