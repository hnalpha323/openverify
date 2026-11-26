'use client';

import type { ShareSourceType } from '@openverify/contracts';
import { Button, Field, Input } from '@openverify/ui';
import { useState, type ReactNode } from 'react';
import { fieldErrorOf } from '../../lib/action-state';
import { ConfirmActionButton } from '../confirm-action-button';
import { FormField } from '../form-field';
import { ProblemDisplay } from '../problem-display';
import { useToast } from '../toasts';
import { useFormAction } from '../use-form-action';
import type { ConnectAction } from './connection-actions';

export interface ExpireShareTokenButtonProps {
  readonly tokenId: string;
  readonly action: ConnectAction;
}

/** C232.4: the source expires a token that is not redeemed yet. */
export function ExpireShareTokenButton({ tokenId, action }: ExpireShareTokenButtonProps) {
  return (
    <ConfirmActionButton
      label="Expire"
      title="Expire this share token"
      description="The destination can no longer peek at or redeem it. Nothing is recalled, since nothing was copied yet."
      confirmLabel="Expire"
      pendingLabel="Expiring…"
      action={action}
      fields={{ 'share-token-id': tokenId }}
      successMessage="The share token expired."
    />
  );
}

export interface RedeemShareTokenFormProps {
  readonly tokenId: string;
  readonly sourceType: ShareSourceType;
  readonly action: ConnectAction;
}

type Mode = 'clone' | 'hydrate';
type AccountLink = 'none' | 'existing' | 'new';

/** C234.1: what each source type may be redeemed as. */
const MODES_OF: Readonly<Record<ShareSourceType, readonly Mode[]>> = {
  inquiry: ['clone', 'hydrate'],
  verification: ['clone'],
  account: ['hydrate'],
  transaction: ['hydrate'],
};

const MODE_LABELS: Readonly<Record<Mode, string>> = {
  clone:
    'Clone: a copy, marked as cloned, that counts only where your template accepts cloned results',
  hydrate: 'Hydrate: fill the shared fields into an account, inquiry or transaction of yours',
};

const LINK_LABELS: Readonly<Record<AccountLink, string>> = {
  none: 'No account link',
  existing: 'An existing account',
  new: 'A new account',
};

const RADIO_CLASS =
  'size-5 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';
const TEXTAREA_CLASS =
  'w-full rounded-lg border border-line bg-surface px-3 py-2 font-mono text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

function Choices<Value extends string>({
  legend,
  name,
  values,
  labels,
  value,
  onChange,
}: {
  readonly legend: string;
  readonly name: string;
  readonly values: readonly Value[];
  readonly labels: Readonly<Record<Value, string>>;
  readonly value: Value;
  readonly onChange: (value: Value) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium text-ink">{legend}</legend>
      {values.map((each) => (
        <label key={each} className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name={name}
            value={each}
            checked={value === each}
            onChange={() => {
              onChange(each);
            }}
            className={RADIO_CLASS}
          />
          {labels[each]}
        </label>
      ))}
    </fieldset>
  );
}

/**
 * C242.2, C234.1: the destination redeems a created token: the mode, the destination, the field
 * mappings, the account linking and its own destination-side consent record. The answer is 202:
 * the copy is made by a job, and the page shows the token pending until it ends.
 */
export function RedeemShareTokenForm({ tokenId, sourceType, action }: RedeemShareTokenFormProps) {
  const modes = MODES_OF[sourceType];
  const [mode, setMode] = useState<Mode>(modes[0] ?? 'hydrate');
  const [link, setLink] = useState<AccountLink>('none');
  const { show } = useToast();
  const { pending, problem, formProps } = useFormAction(action, {
    onSuccess: () => {
      show({
        tone: 'success',
        message: 'The redemption started. The copy is made in the background.',
      });
    },
  });
  const error = (pointer: string): ReactNode => fieldErrorOf(problem, pointer);

  return (
    <form {...formProps} noValidate className="flex flex-col gap-4">
      <input type="hidden" name="share-token-id" value={tokenId} />
      {modes.length > 1 ? (
        <Choices
          legend="Redeem as"
          name="mode"
          values={modes}
          labels={MODE_LABELS}
          value={mode}
          onChange={setMode}
        />
      ) : (
        <>
          <input type="hidden" name="mode" value={mode} />
          <p className="text-sm text-ink-muted">{MODE_LABELS[mode]}.</p>
        </>
      )}
      {mode === 'clone' && sourceType === 'inquiry' && (
        <>
          <Field
            label="Inquiry template ID"
            description="Your template the cloned inquiry runs under (itmpl_…); its published version unless you name one."
            error={error('/meta/inquiry-template-id')}
          >
            <Input name="inquiry-template-id" autoComplete="off" spellCheck={false} />
          </Field>
          <Field
            label="Inquiry template version ID (optional)"
            error={error('/meta/inquiry-template-version-id')}
          >
            <Input name="inquiry-template-version-id" autoComplete="off" spellCheck={false} />
          </Field>
        </>
      )}
      {mode === 'clone' && sourceType === 'verification' && (
        <Field
          label="Inquiry ID"
          description="Your open inquiry the cloned verification joins (inq_…)."
          error={error('/meta/inquiry-id')}
        >
          <Input name="inquiry-id" autoComplete="off" spellCheck={false} />
        </Field>
      )}
      {mode === 'hydrate' && (
        <>
          <Field
            label="Destination ID"
            description="Your account, inquiry or transaction the shared fields fill (acc_…, inq_… or txn_…)."
            error={error('/data/attributes/destination-id')}
          >
            <Input name="destination-id" autoComplete="off" spellCheck={false} />
          </Field>
          <FormField
            label="Field mappings (optional)"
            description="One per line, as source field -> destination field; dots reach a nested field. Fields with the same name are matched without a line."
            error={fieldErrorOf(problem, '/meta/field-mappings')}
          >
            {(control) => (
              <textarea {...control} name="field-mappings" rows={4} className={TEXTAREA_CLASS} />
            )}
          </FormField>
        </>
      )}
      {mode === 'clone' && sourceType === 'inquiry' && (
        <>
          <Choices
            legend="Account"
            name="account-link"
            values={['none', 'existing', 'new'] as const}
            labels={LINK_LABELS}
            value={link}
            onChange={setLink}
          />
          {link === 'existing' && (
            <Field label="Account ID" error={error('/meta/account-id')}>
              <Input name="account-id" autoComplete="off" spellCheck={false} />
            </Field>
          )}
          {link === 'new' && (
            <>
              <Field
                label="New account’s reference ID"
                error={error('/meta/auto-create-account-reference-id')}
              >
                <Input name="auto-create-account-reference-id" autoComplete="off" />
              </Field>
              <Field
                label="New account’s type ID"
                error={error('/meta/auto-create-account-type-id')}
              >
                <Input name="auto-create-account-type-id" autoComplete="off" spellCheck={false} />
              </Field>
            </>
          )}
        </>
      )}
      <Field
        label="Destination consent record ID"
        description="Your own consent record for this share (cnsr_…): the person’s consent to your organization receiving the data, recorded by your flow or attested through the API."
        error={error('/meta/destination-consent-record-id')}
      >
        <Input
          name="destination-consent-record-id"
          required
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
      <ProblemDisplay problem={problem} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Redeeming…' : 'Redeem'}
        </Button>
      </div>
    </form>
  );
}
