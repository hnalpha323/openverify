'use client';

/**
 * A device's trust mark and its control (C127.9). The mark says when, by whom and for which reason
 * code a device was trusted; a run links its page. Trusting a device changes no check and no
 * signal: only a workflow condition can read the mark, which the words say beside it. With
 * `devices:write` the operator trusts the device with a snake_case reason, or removes the mark;
 * both are reversible and audit-logged, so neither asks for a confirmation.
 */
import type { DeviceResource } from '@openverify/contracts';
import Link from 'next/link';
import { fieldErrorOf, type ActionResult, type ActionState } from '../../lib/action-state';
import { Detail } from '../detail';
import { withoutFieldErrors } from '../field-errors';
import { FormField, controlClassName } from '../form-field';
import { LINK_CLASS } from '../link-styles';
import { ProblemDisplay } from '../problem-display';
import { SubmitButton } from '../submit-button';
import { Timestamp } from '../timestamp';
import { useToast } from '../toasts';
import { useFormAction } from '../use-form-action';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

const REASON = '/meta/trust-reason';

const ACTOR_WORDS = { user: 'user', 'api-key': 'API key', 'workflow-run': 'workflow run' } as const;

function TrustedBy({
  actor,
}: {
  readonly actor: NonNullable<DeviceResource['attributes']['trusted-by']>;
}) {
  const id = <code className="font-mono text-xs break-all">{actor.id}</code>;
  return (
    <>
      {`${ACTOR_WORDS[actor.type]} `}
      {actor.type === 'workflow-run' ? (
        <Link href={`/workflows/runs/${actor.id}`} className={LINK_CLASS}>
          {id}
        </Link>
      ) : (
        id
      )}
    </>
  );
}

export function DeviceTrust({
  inquiryId,
  device,
  action,
}: {
  readonly inquiryId: string;
  readonly device: DeviceResource;
  /** `setDeviceTrust`, with `devices:write`; `null` shows the mark only. */
  readonly action: Action | null;
}) {
  const { attributes } = device;
  const trustedAt = attributes['trusted-at'];
  const trustedBy = attributes['trusted-by'];
  const reason = attributes['trust-reason'];
  const trusted = trustedAt !== null && trustedBy !== null && reason !== null;
  return (
    <>
      <Detail term="Trust">
        <span className="flex flex-col gap-1">
          {trusted ? (
            <span>
              {`Trusted for ${reason} at `}
              <Timestamp value={trustedAt} />
              {' by '}
              <TrustedBy actor={trustedBy} />
            </span>
          ) : (
            <span>Not trusted</span>
          )}
          <span className="text-xs text-ink-muted">
            Trusting a device changes no check and no signal: only a workflow condition can read the
            mark.
          </span>
          {action !== null && (
            <TrustControl
              inquiryId={inquiryId}
              deviceId={device.id}
              trusted={trusted}
              action={action}
            />
          )}
        </span>
      </Detail>
    </>
  );
}

function TrustControl({
  inquiryId,
  deviceId,
  trusted,
  action,
}: {
  readonly inquiryId: string;
  readonly deviceId: string;
  readonly trusted: boolean;
  readonly action: Action;
}) {
  const { show } = useToast();
  const { pending, problem, formProps } = useFormAction(action, {
    resetOnSuccess: true,
    onSuccess: () => {
      show({
        tone: 'success',
        message: trusted ? 'The trust mark was removed.' : 'The device is trusted.',
      });
    },
  });
  const ids = (
    <>
      <input type="hidden" name="device-id" value={deviceId} />
      <input type="hidden" name="inquiry-id" value={inquiryId} />
    </>
  );
  if (trusted) {
    return (
      <form {...formProps} aria-label="Remove the trust mark" className="flex flex-col gap-2">
        {ids}
        <input type="hidden" name="mode" value="untrust" />
        <div>
          <SubmitButton variant="secondary" pendingLabel="Removing…" pending={pending}>
            Remove the trust mark
          </SubmitButton>
        </div>
        <ProblemDisplay problem={problem} />
      </form>
    );
  }
  return (
    <form {...formProps} aria-label="Trust this device" className="flex flex-wrap items-end gap-3">
      {ids}
      <input type="hidden" name="mode" value="trust" />
      <FormField
        label="Reason code"
        description="A snake_case code, such as known_customer_device; never words about a person."
        error={fieldErrorOf(problem, REASON)}
        className="min-w-64"
      >
        {(control) => (
          <input
            {...control}
            name="trust-reason"
            required
            pattern="[a-z][a-z0-9_]{0,63}"
            autoComplete="off"
            spellCheck={false}
            className={controlClassName(control)}
          />
        )}
      </FormField>
      <SubmitButton variant="secondary" pendingLabel="Trusting…" pending={pending}>
        Trust
      </SubmitButton>
      <ProblemDisplay problem={withoutFieldErrors(problem, [REASON])} className="basis-full" />
    </form>
  );
}
