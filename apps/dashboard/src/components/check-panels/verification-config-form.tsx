'use client';

/**
 * The settings tab's verification checks (C153.1): the check panels of every verification type the
 * draft configures, saved as the whole `verification-config` with the draft's ETag through the
 * settings save action. Each change is announced politely; nothing is sent while the contract
 * refuses the configuration (C11: every type keeps an enabled, required check).
 */
import {
  API_VERIFICATION_TYPES,
  verificationConfigSchema,
  type VerificationConfig,
} from '@openverify/contracts';
import type { AnyFlow } from '@openverify/flow-spec';
import { useState, type ReactNode, type SubmitEvent } from 'react';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { TEMPLATE_FORMS_COPY } from '../../lib/copy/template-forms';
import { ProblemDisplay } from '../problem-display';
import { problemsOf } from '../schema-form/model';
import { SubmitButton } from '../submit-button';
import { useToast } from '../toasts';
import { useFormAction } from '../use-form-action';
import { VerificationTypePanel } from './verification-type-panel';

const COPY = TEMPLATE_FORMS_COPY;

export interface VerificationConfigFormProps {
  readonly config: VerificationConfig;
  /** The draft's flow, whose branches may read the checks. */
  readonly flow: AnyFlow;
  readonly ids: { readonly templateId: string; readonly versionId: string; readonly etag: string };
  readonly action: (state: ActionState, formData: FormData) => Promise<ActionResult>;
  readonly readOnly?: boolean;
}

export function VerificationConfigForm({
  config: initial,
  flow,
  ids,
  action,
  readOnly = false,
}: VerificationConfigFormProps): ReactNode {
  const [config, setConfig] = useState<VerificationConfig>(initial);
  const [message, setMessage] = useState('');
  const { show } = useToast();
  const legend = COPY.verificationConfig.legend;
  const { pending, problem, formProps } = useFormAction(action, {
    onSuccess: () => {
      show({ tone: 'success', message: COPY.memberForm.saved(legend) });
    },
  });
  const types = API_VERIFICATION_TYPES.filter((apiType) => config[apiType] !== undefined);
  const panels =
    types.length === 0 ? (
      <p className="text-sm">{COPY.verificationConfig.none}</p>
    ) : (
      types.map((apiType) => (
        <VerificationTypePanel
          key={apiType}
          apiType={apiType}
          config={config[apiType]}
          flow={flow}
          editable={!readOnly}
          onChange={(next, words) => {
            setConfig({ ...config, [apiType]: next });
            setMessage(words);
          }}
        />
      ))
    );

  if (readOnly) {
    return <div className="flex flex-col gap-6">{panels}</div>;
  }

  const onSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (problemsOf(verificationConfigSchema, config).length > 0) {
      setMessage(COPY.memberForm.refusedBeforeSending);
      return;
    }
    setMessage('');
    formProps.action(new FormData(event.currentTarget));
  };

  return (
    <form {...formProps} onSubmit={onSubmit} aria-label={legend} className="flex flex-col gap-6">
      <input type="hidden" name="inquiry-template-id" value={ids.templateId} />
      <input type="hidden" name="version-id" value={ids.versionId} />
      <input type="hidden" name="etag" value={ids.etag} />
      <input type="hidden" name="member" value="verification-config" />
      <input type="hidden" name="value" value={JSON.stringify(config)} />
      {panels}
      <p role="status" aria-live="polite" className="text-sm font-medium">
        {message}
      </p>
      <ProblemDisplay problem={problem} />
      <div>
        <SubmitButton pendingLabel={COPY.memberForm.saving} pending={pending}>
          {COPY.verificationConfig.save}
        </SubmitButton>
      </div>
    </form>
  );
}
