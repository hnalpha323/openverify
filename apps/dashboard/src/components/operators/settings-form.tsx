'use client';

import type { DashboardSettings, EnvironmentKind } from '@openverify/contracts';
import { Button, Checkbox, Field, Input } from '@openverify/ui';
import { useState } from 'react';
import { SETTINGS_COPY } from '../../lib/copy/settings';
import { fieldErrorOf, type ActionResult, type ActionState } from '../../lib/action-state';
import { ConfirmDialog } from '../confirm-dialog';
import { EnvironmentField } from '../environment-field';
import { ProblemDisplay } from '../problem-display';
import { useToast } from '../toasts';
import { useFormAction } from '../use-form-action';
import { withoutFieldErrors } from '../field-errors';
import { Detail } from '../detail';
import { BudgetTripped } from './budget-tripped';
import { PHASE7_POINTERS, Phase7SettingsFields } from './phase7-settings-fields';
import {
  PLATFORM_POINTERS,
  PlatformSettingsFields,
  platformListPointers,
} from './platform-settings-fields';
import {
  WORKFLOW_SETTING_POINTERS,
  WorkflowSettingsFields,
  workflowListPointers,
} from './workflow-settings-fields';
import {
  ENVIRONMENT_NAMES,
  FACE_FIELDS,
  OTP_FIELD,
  OTP_TRIPPED_TERM,
  REPORT_RETENTION_FIELD,
  RETENTION_FIELDS,
} from './settings-fields';

/** What saving answers: whether any setting changed. */
export interface SettingsSaved {
  readonly changed: boolean;
}

export interface SettingsFormProps {
  readonly settings: DashboardSettings;
  /** The session's environment, whose retention the form changes (the banner names it too). */
  readonly environment: EnvironmentKind;
  /**
   * Its id. The form posts it, and saving answers "The environment changed" when the session
   * is no longer there (switched in another tab), so a form that shows Sandbox never writes
   * production, and the production confirmation always matches what is written (Workflow 2D
   * F002).
   */
  readonly environmentId: string;
  /**
   * `settings:privacy` (C107.7): without it the collection tiers, the biometric lists basis and the
   * graph switches show read-only and are never posted, because the API refuses the whole save.
   */
  readonly canPrivacy?: boolean;
  /** C174.6: the IANA zones the server knows, for the reporting zone's choices. */
  readonly timeZones?: readonly string[];
  /** `saveSettings` from `app/settings/actions.ts`. */
  readonly action: (
    state: ActionState<SettingsSaved>,
    formData: FormData,
  ) => Promise<ActionResult<SettingsSaved>>;
}

const POINTERS = [
  ...PLATFORM_POINTERS,
  ...PHASE7_POINTERS,
  ...WORKFLOW_SETTING_POINTERS,
  '/require-mfa',
  ...RETENTION_FIELDS.map((field) => `/${field.name}`),
  ...FACE_FIELDS.map((field) => `/${field.name}`),
  `/${OTP_FIELD.name}`,
  `/${REPORT_RETENTION_FIELD.name}`,
];

/** Whether the form clears a biometric lists basis the environment has (C97.4). */
function clearsBiometricBasis(settings: DashboardSettings, formData: FormData): boolean {
  const posted = formData.get('biometric-lists-basis');
  return (
    typeof posted === 'string' &&
    posted.trim() === '' &&
    typeof settings['biometric-lists-basis'] === 'string'
  );
}

/**
 * The organization's `require-mfa`, the session environment's retention (C15, C16), its face
 * matching settings (C42.4, C42.6, C47), its text message budget with the read-only time it
 * last tripped (C55.7), and its Phase 7 settings (C107.7), each bounded by the contract's range. The server checks
 * every value, so the browser's own validation is off; a refusal shows on its field by its JSON
 * Pointer. In production, saving asks for a confirmation first: a shorter retention destroys live
 * data.
 */
export function SettingsForm({
  settings,
  environment,
  environmentId,
  canPrivacy = false,
  timeZones = [],
  action,
}: SettingsFormProps) {
  const [held, setHeld] = useState<{ formData: FormData; clearsBasis: boolean } | null>(null);
  const { show } = useToast();
  const { pending, problem, submit, formProps } = useFormAction(action, {
    onSuccess: ({ changed }) => {
      show(
        changed
          ? { tone: 'success', message: 'Settings saved.' }
          : { tone: 'info', message: 'Nothing changed.' },
      );
    },
  });
  const production = environment === 'production';

  return (
    <>
      <form
        action={formProps.action}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          // C97.4: clearing the basis redacts every face and background list, so it asks first.
          const clearsBasis = clearsBiometricBasis(settings, formData);
          if (production || clearsBasis) {
            setHeld({ formData, clearsBasis });
          } else {
            submit(formData);
          }
        }}
        className="flex flex-col gap-8"
      >
        <EnvironmentField environmentId={environmentId} />
        <fieldset className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-6">
          <legend className="px-1 text-lg font-semibold text-ink">Organization</legend>
          <Checkbox
            name="require-mfa"
            value="true"
            label="Require a second factor"
            description="Applies to every environment. An operator without an authenticator app or a security key can only add one until they do."
            defaultChecked={settings['require-mfa']}
          />
          {/* C167.2 (SETTING_LEVEL), C168.8. */}
          <p className="text-sm text-ink-muted">{SETTINGS_COPY.platform.organizationLevel}</p>
          {!settings['require-mfa'] && (
            <p className="text-sm font-medium text-ink">{SETTINGS_COPY.platform.noMfa}</p>
          )}
        </fieldset>
        <fieldset className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-6">
          <legend className="px-1 text-lg font-semibold text-ink">
            Retention in {ENVIRONMENT_NAMES[environment]}
          </legend>
          {production && (
            <p className="text-sm font-medium text-ink">
              These settings change production: live data past its retention is redacted or deleted
              at the next daily run.
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            {RETENTION_FIELDS.map((field) => (
              <Field
                key={field.name}
                label={`${field.term} (days)`}
                description={field.description}
                error={fieldErrorOf(problem, `/${field.name}`)}
              >
                <Input
                  type="number"
                  name={field.name}
                  inputMode="numeric"
                  min={1}
                  max={3650}
                  step={1}
                  defaultValue={settings[field.name] ?? ''}
                />
              </Field>
            ))}
            {/* C73.6: posted only where the API reports it. */}
            {settings[REPORT_RETENTION_FIELD.name] === undefined ? (
              <p className="text-sm text-ink-muted">
                {REPORT_RETENTION_FIELD.term}: not reported by this server.
              </p>
            ) : (
              <Field
                label={REPORT_RETENTION_FIELD.label}
                description={REPORT_RETENTION_FIELD.description}
                error={fieldErrorOf(problem, `/${REPORT_RETENTION_FIELD.name}`)}
              >
                <Input
                  type="number"
                  name={REPORT_RETENTION_FIELD.name}
                  inputMode="numeric"
                  min={REPORT_RETENTION_FIELD.min}
                  max={REPORT_RETENTION_FIELD.max}
                  step={1}
                  defaultValue={settings[REPORT_RETENTION_FIELD.name] ?? ''}
                />
              </Field>
            )}
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-6">
          <legend className="px-1 text-lg font-semibold text-ink">
            Face matching in {ENVIRONMENT_NAMES[environment]}
          </legend>
          <p className="text-sm text-ink-muted">
            Used only for users who give the optional matching consent. A face template is biometric
            data.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {FACE_FIELDS.map((field) => (
              <Field
                key={field.name}
                label={field.label}
                description={field.description}
                error={fieldErrorOf(problem, `/${field.name}`)}
              >
                <Input
                  type="number"
                  name={field.name}
                  inputMode="numeric"
                  min={field.min}
                  max={field.max}
                  step={1}
                  defaultValue={settings[field.name] ?? ''}
                />
              </Field>
            ))}
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-6">
          <legend className="px-1 text-lg font-semibold text-ink">
            Text message codes in {ENVIRONMENT_NAMES[environment]}
          </legend>
          {settings[OTP_FIELD.name] === undefined ? (
            <p className="text-sm text-ink-muted">Not reported by this server.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={OTP_FIELD.label}
                description={OTP_FIELD.description}
                error={fieldErrorOf(problem, `/${OTP_FIELD.name}`)}
              >
                <Input
                  type="number"
                  name={OTP_FIELD.name}
                  inputMode="numeric"
                  min={OTP_FIELD.min}
                  max={OTP_FIELD.max}
                  step={1}
                  defaultValue={settings[OTP_FIELD.name]}
                />
              </Field>
              {/* C55.7: read-only, from the audit log; never posted. */}
              <dl>
                <Detail term={OTP_TRIPPED_TERM}>
                  <BudgetTripped at={settings['otp-sms-budget-tripped-at']} />
                </Detail>
              </dl>
            </div>
          )}
        </fieldset>
        <Phase7SettingsFields
          settings={settings}
          environment={environment}
          canPrivacy={canPrivacy}
          problem={problem}
        />
        <WorkflowSettingsFields
          settings={settings}
          environment={environment}
          canPrivacy={canPrivacy}
          problem={problem}
        />
        <PlatformSettingsFields
          settings={settings}
          environment={environment}
          problem={problem}
          timeZones={timeZones}
        />
        <ProblemDisplay
          problem={withoutFieldErrors(problem, [
            ...POINTERS,
            ...workflowListPointers(problem),
            ...platformListPointers(problem),
          ])}
        />
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save settings'}
          </Button>
        </div>
      </form>
      <ConfirmDialog
        open={held !== null}
        title={
          held?.clearsBasis === true
            ? 'Clear the biometric lists basis?'
            : 'Change the production settings?'
        }
        description={
          held?.clearsBasis === true
            ? `Clearing it redacts every face and background list and its items, for good: their templates, layouts and masked images are deleted, and no such list can be created until a basis is recorded again.${production ? ' These settings change production.' : ''} This cannot be undone.`
            : 'A shorter retention redacts or deletes live data at the next daily run. This cannot be undone.'
        }
        confirmLabel={held?.clearsBasis === true ? 'Clear and save' : 'Save production settings'}
        onCancel={() => {
          setHeld(null);
        }}
        onConfirm={() => {
          if (held !== null) {
            submit(held.formData);
          }
          setHeld(null);
        }}
      />
    </>
  );
}
