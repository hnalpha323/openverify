'use client';

import {
  CONSENT_PROOF_RETENTION_DAYS,
  SHARE_TOKEN_MAX_SECONDS,
  type DashboardSettings,
} from '@openverify/contracts';
import { Button, Checkbox, Field, Input } from '@openverify/ui';
import { fieldErrorOf, type ActionResult, type ActionState } from '../../lib/action-state';
import { Detail } from '../detail';
import { EnvironmentField } from '../environment-field';
import { ProblemDisplay } from '../problem-display';
import { useToast } from '../toasts';
import { useFormAction } from '../use-form-action';

/** C231.10, C232.1, C241.3: the three Connect settings as the API served them. */
export type ConnectSettingsValues = Pick<
  DashboardSettings,
  'connect-inbound' | 'share-token-max-seconds' | 'consent-proof-retention-days'
>;

export interface ConnectSettingsFormProps {
  readonly settings: ConnectSettingsValues;
  /** `settings:write`: without it the settings are read only. */
  readonly canWrite: boolean;
  readonly environmentId: string;
  readonly environmentName: string;
  readonly action: (state: ActionState, formData: FormData) => Promise<ActionResult>;
}

const count = (value: number) => value.toLocaleString('en-US');

const UNITS = [
  [86_400, 'day'],
  [3_600, 'hour'],
  [60, 'minute'],
] as const;

/** A whole number of seconds with the largest whole unit beside it: "1,209,600 seconds (14 days)". */
export function secondsInWords(seconds: number): string {
  const unit = UNITS.find(([size]) => seconds % size === 0);
  const plain = `${count(seconds)} seconds`;
  if (unit === undefined) {
    return plain;
  }
  const amount = seconds / unit[0];
  return `${plain} (${count(amount)} ${unit[1]}${amount === 1 ? '' : 's'})`;
}

const LABELS = {
  inbound: 'Receive connections from other organizations',
  maxSeconds: 'Longest share token life',
  proofDays: 'Consent proof kept after redaction',
} as const;

const DESCRIPTIONS = {
  inbound:
    'For the whole organization. While it is off, no organization can create a connection to yours, and the attempt is answered as if yours did not exist. Every change is audited.',
  maxSeconds: `From ${count(SHARE_TOKEN_MAX_SECONDS.min)} to ${count(SHARE_TOKEN_MAX_SECONDS.max)} seconds. No share token of this environment lives longer; 21 days by default.`,
  proofDays: `From ${count(CONSENT_PROOF_RETENTION_DAYS.min)} to ${count(CONSENT_PROOF_RETENTION_DAYS.max)} days. How long a consent record’s bare fact (time, side, purpose, recipient, categories, text digest, withdrawal) is kept after the data it covers is gone; 0 keeps none.`,
} as const;

const NOT_REPORTED = 'Not reported by the API';

/**
 * C242.1, C231.10: Connect's settings. The opt-in is the organization's (organisation-level, so an
 * environment-scoped role cannot change it, and the API answers 403); the longest token life and the
 * proof retention are the environment's.
 */
export function ConnectSettingsForm({
  settings,
  canWrite,
  environmentId,
  environmentName,
  action,
}: ConnectSettingsFormProps) {
  const { show } = useToast();
  const { pending, problem, formProps } = useFormAction(action, {
    onSuccess: () => {
      show({ tone: 'success', message: 'Connect settings saved.' });
    },
  });
  const inbound = settings['connect-inbound'];
  const maxSeconds = settings['share-token-max-seconds'];
  const proofDays = settings['consent-proof-retention-days'];
  const scope = (
    <p className="text-sm text-ink-muted">
      The opt-in applies to the whole organization; the two numbers apply to the {environmentName}{' '}
      environment.
    </p>
  );

  if (!canWrite) {
    return (
      <div className="flex flex-col gap-3">
        {scope}
        <dl className="grid gap-4 sm:grid-cols-3">
          <Detail term={LABELS.inbound}>
            {inbound === undefined ? NOT_REPORTED : inbound ? 'On' : 'Off'}
          </Detail>
          <Detail term={LABELS.maxSeconds}>
            {maxSeconds === undefined ? NOT_REPORTED : secondsInWords(maxSeconds)}
          </Detail>
          <Detail term={LABELS.proofDays}>
            {proofDays === undefined
              ? NOT_REPORTED
              : `${count(proofDays)} day${proofDays === 1 ? '' : 's'}`}
          </Detail>
        </dl>
      </div>
    );
  }

  return (
    <form {...formProps} noValidate className="flex flex-col gap-4">
      <EnvironmentField environmentId={environmentId} />
      {scope}
      <Checkbox
        name="connect-inbound"
        value="true"
        defaultChecked={inbound === true}
        label={LABELS.inbound}
        description={DESCRIPTIONS.inbound}
      />
      <Field
        label={`${LABELS.maxSeconds} (seconds)`}
        description={DESCRIPTIONS.maxSeconds}
        error={fieldErrorOf(problem, '/share-token-max-seconds')}
      >
        <Input
          type="number"
          name="share-token-max-seconds"
          min={SHARE_TOKEN_MAX_SECONDS.min}
          max={SHARE_TOKEN_MAX_SECONDS.max}
          step={1}
          defaultValue={maxSeconds ?? SHARE_TOKEN_MAX_SECONDS.default}
        />
      </Field>
      <Field
        label={`${LABELS.proofDays} (days)`}
        description={DESCRIPTIONS.proofDays}
        error={fieldErrorOf(problem, '/consent-proof-retention-days')}
      >
        <Input
          type="number"
          name="consent-proof-retention-days"
          min={CONSENT_PROOF_RETENTION_DAYS.min}
          max={CONSENT_PROOF_RETENTION_DAYS.max}
          step={1}
          defaultValue={proofDays ?? CONSENT_PROOF_RETENTION_DAYS.default}
        />
      </Field>
      <ProblemDisplay problem={problem} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save Connect settings'}
        </Button>
      </div>
    </form>
  );
}
