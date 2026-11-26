'use client';

import { Button, Checkbox, Field, Input } from '@openverify/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { WebhookFailureAlert } from '@openverify/contracts';
import type { ActionResult, ActionState, DisplayProblem } from '../../lib/action-state';
import { SETTINGS_COPY } from '../../lib/copy/settings';
import { EnvironmentField } from '../environment-field';
import { FormField, controlClassName } from '../form-field';
import { LINK_CLASS } from '../link-styles';
import { OneTimeSecretDialog } from '../one-time-secret-dialog';
import { ProblemDisplay } from '../problem-display';
import { useFormAction } from '../use-form-action';
import type { CreatedWebhook } from './action-data';
import { CustomHeadersEditor } from './custom-headers-editor';
import { EventPicker, type EventPickerGroup } from './event-picker';
import { errorsUnder } from './form-errors';

export type { CreatedWebhook } from './action-data';

/** A webhook's configuration as the edit form starts from it. */
export interface WebhookFormDefaults {
  readonly url: string;
  readonly enabledEvents: readonly string[];
  readonly apiVersion: string | undefined;
  readonly inquiryTemplateIds: readonly string[];
  readonly accountTypeIds: readonly string[];
  /** C143.4 (Phase 8): a workflow, version or run event by its workflow. */
  readonly workflowIds?: readonly string[];
  /** C143.4 (Phase 8): a case event by its template. */
  readonly caseTemplateIds?: readonly string[];
  /** C143.4 (Phase 8): a list event by its list. */
  readonly listIds?: readonly string[];
  readonly attributeBlocklist: readonly string[];
  /** The stored custom headers' names; their values are never shown again (C14). */
  readonly customHeaderNames: readonly string[];
  /** C169.5: the webhook's name and description; absent or null when none. */
  readonly name?: string | null;
  readonly description?: string | null;
  /** C169.6: the failure alert; absent or null when none is set. */
  readonly failureAlert?: WebhookFailureAlert | null;
}

interface WebhookFieldsProps {
  /** C169.5: a new webhook needs a name; an existing one without a name may stay unnamed. */
  readonly nameRequired: boolean;
  readonly groups: readonly EventPickerGroup[];
  /** Every supported API version, oldest first; a new webhook gets the latest. */
  readonly apiVersions: readonly string[];
  readonly defaults?: WebhookFormDefaults;
  readonly problem: DisplayProblem | undefined;
}

const ATTRIBUTES = '/data/attributes';
const COPY = SETTINGS_COPY.webhooks;

/** The controls a webhook is configured with, each showing the errors that point at it. */
function WebhookFields({
  nameRequired,
  groups,
  apiVersions,
  defaults,
  problem,
}: WebhookFieldsProps) {
  const error = (member: string) => errorsUnder(problem, `${ATTRIBUTES}/${member}`);
  const alert = defaults?.failureAlert ?? null;
  return (
    <>
      <Field
        label={COPY.name}
        description={COPY.nameDescription}
        error={error('name')}
        required={nameRequired}
      >
        <Input
          name="name"
          defaultValue={defaults?.name ?? ''}
          autoComplete="off"
          maxLength={200}
          required={nameRequired}
        />
      </Field>
      <FormField
        label={COPY.description}
        description={COPY.descriptionHint}
        error={error('description')}
      >
        {(control) => (
          <textarea
            {...control}
            name="description"
            rows={2}
            maxLength={1000}
            defaultValue={defaults?.description ?? ''}
            className={controlClassName(control)}
          />
        )}
      </FormField>
      <Field
        label="Endpoint URL"
        description="Where OpenVerify sends events: an https URL that answers with a 2xx status."
        error={error('url')}
        required
      >
        <Input
          type="url"
          name="url"
          defaultValue={defaults?.url ?? ''}
          autoComplete="off"
          spellCheck={false}
          placeholder="https://example.com/webhooks/openverify"
        />
      </Field>
      <EventPicker
        groups={groups}
        defaultValue={defaults?.enabledEvents ?? []}
        error={error('enabled-events')}
      />
      <FormField
        label="API version"
        description="The version of the event documents this webhook receives."
        error={error('api-version')}
      >
        {(control) => (
          <select
            {...control}
            name="api-version"
            defaultValue={defaults?.apiVersion ?? apiVersions.at(-1)}
            className={controlClassName(control)}
          >
            {apiVersions.map((version) => (
              <option key={version} value={version}>
                {version}
              </option>
            ))}
          </select>
        )}
      </FormField>
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-sm font-medium text-ink">Filters</legend>
        <p className="text-sm text-ink-muted">
          Deliver only events about these templates, account types, workflows, case templates or
          lists. Leave a filter empty to receive events of every one.
        </p>
        <Field
          label="Inquiry template IDs"
          description="Separate IDs with commas or spaces."
          error={error('filters/inquiry-template-ids')}
        >
          <Input
            name="inquiry-template-ids"
            defaultValue={(defaults?.inquiryTemplateIds ?? []).join(', ')}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <Field
          label="Account type IDs"
          description="Separate IDs with commas or spaces."
          error={error('filters/account-type-ids')}
        >
          <Input
            name="account-type-ids"
            defaultValue={(defaults?.accountTypeIds ?? []).join(', ')}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <Field
          label="Workflow IDs"
          description="Workflow, version and run events of these workflows. Separate IDs with commas or spaces."
          error={error('filters/workflow-ids')}
        >
          <Input
            name="workflow-ids"
            defaultValue={(defaults?.workflowIds ?? []).join(', ')}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <Field
          label="Case template IDs"
          description="Case events of cases on these templates; a comment follows its case. Separate IDs with commas or spaces."
          error={error('filters/case-template-ids')}
        >
          <Input
            name="case-template-ids"
            defaultValue={(defaults?.caseTemplateIds ?? []).join(', ')}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <Field
          label="List IDs"
          description="List events of these lists. Separate IDs with commas or spaces."
          error={error('filters/list-ids')}
        >
          <Input
            name="list-ids"
            defaultValue={(defaults?.listIds ?? []).join(', ')}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
      </fieldset>
      <Field
        label="Attribute blocklist"
        description="Attributes removed from every resource in a delivery before it is signed, such as fields or reference-id. Separate them with commas or spaces."
        error={error('attribute-blocklist')}
      >
        <Input
          name="attribute-blocklist"
          defaultValue={(defaults?.attributeBlocklist ?? []).join(', ')}
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
      <CustomHeadersEditor
        {...(defaults === undefined ? {} : { existingNames: defaults.customHeaderNames })}
        error={error('custom-headers')}
      />
      <fieldset className="flex flex-col gap-3 rounded-xl border border-line p-4">
        <legend className="px-1 font-semibold">{COPY.alertLegend}</legend>
        <Checkbox
          name="failure-alert-enabled"
          value="true"
          label={COPY.alertEnabled}
          defaultChecked={alert?.enabled ?? false}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={COPY.alertThreshold} error={error('failure-alert/threshold')}>
            <Input
              type="number"
              name="failure-alert-threshold"
              inputMode="numeric"
              min={1}
              max={10_000}
              step={1}
              defaultValue={alert?.threshold ?? 5}
            />
          </Field>
          <Field label={COPY.alertWindow} error={error('failure-alert/window-minutes')}>
            <Input
              type="number"
              name="failure-alert-window-minutes"
              inputMode="numeric"
              min={5}
              max={1440}
              step={1}
              defaultValue={alert?.['window-minutes'] ?? 60}
            />
          </Field>
        </div>
        <p className="text-sm text-ink-muted">{COPY.alertNote}</p>
      </fieldset>
    </>
  );
}

export interface CreateWebhookFormProps {
  readonly action: (
    state: ActionState<CreatedWebhook>,
    formData: FormData,
  ) => Promise<ActionResult<CreatedWebhook>>;
  readonly groups: readonly EventPickerGroup[];
  readonly apiVersions: readonly string[];
  /** The session environment the page was rendered for (Workflow 2D F002). */
  readonly environmentId: string;
}

/**
 * Creates a webhook. Its signing secret is shown once in the one-time secret dialog (C21);
 * closing it opens the new webhook's page.
 */
export function CreateWebhookForm({
  action,
  groups,
  apiVersions,
  environmentId,
}: CreateWebhookFormProps) {
  const router = useRouter();
  const [created, setCreated] = useState<CreatedWebhook | null>(null);
  const submit = useFormAction(action, { onSuccess: setCreated });

  return (
    <>
      <form {...submit.formProps} noValidate className="flex flex-col gap-6">
        <EnvironmentField environmentId={environmentId} />
        <WebhookFields
          nameRequired
          groups={groups}
          apiVersions={apiVersions}
          problem={submit.problem}
        />
        <ProblemDisplay problem={submit.problem} />
        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" disabled={submit.pending}>
            {submit.pending ? 'Creating…' : 'Create webhook'}
          </Button>
          <Link href="/webhooks" className={LINK_CLASS}>
            Cancel
          </Link>
        </div>
      </form>
      {created !== null && (
        <OneTimeSecretDialog
          open
          title="Webhook created"
          label="Signing secret"
          secret={created.secret}
          description="Verify the OpenVerify-Signature header of every delivery with this secret. This is the only time it is shown: copy it now and keep it somewhere safe."
          onClose={() => {
            const { id } = created;
            setCreated(null);
            router.push(`/webhooks/${id}`);
          }}
        />
      )}
    </>
  );
}

export interface EditWebhookFormProps {
  /** Saves the changes and opens the webhook's page (a redirect). */
  readonly action: (state: ActionState, formData: FormData) => Promise<ActionResult>;
  readonly webhookId: string;
  readonly defaults: WebhookFormDefaults;
  readonly groups: readonly EventPickerGroup[];
  readonly apiVersions: readonly string[];
}

/** Changes a webhook's configuration; its custom headers stay unless replaced as a whole. */
export function EditWebhookForm({
  action,
  webhookId,
  defaults,
  groups,
  apiVersions,
}: EditWebhookFormProps) {
  const submit = useFormAction(action);

  return (
    <form {...submit.formProps} noValidate className="flex flex-col gap-6">
      <input type="hidden" name="webhook-id" value={webhookId} />
      <WebhookFields
        nameRequired={false}
        groups={groups}
        apiVersions={apiVersions}
        defaults={defaults}
        problem={submit.problem}
      />
      <ProblemDisplay problem={submit.problem} />
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={submit.pending}>
          {submit.pending ? 'Saving…' : 'Save changes'}
        </Button>
        <Link href={`/webhooks/${webhookId}`} className={LINK_CLASS}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
