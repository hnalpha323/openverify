'use client';

/**
 * C153.4 (K14): report template configurations as forms generated from each type's contract
 * schema (`REPORT_TEMPLATE_CONFIG_SCHEMAS`, every key optional: one left out takes its default),
 * with the JSON editor kept below as the fallback. `ReportDraftForm` saves a draft through the
 * existing draft action (`config` as JSON); `CreateReportTemplateForm` creates a template of a
 * chosen type (`POST /report-templates`), whose version 1 the API publishes at once.
 */
import { REPORT_TEMPLATE_CONFIG_SCHEMAS } from '@openverify/contracts';
import { REPORT_TYPES, toReportResourceType, type ReportType } from '@openverify/core';
import { useMemo, useState, type ReactNode, type SubmitEvent } from 'react';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { TEMPLATE_FORMS_COPY } from '../../lib/copy/template-forms';
import { REPORT_TYPE_LABELS } from '../../lib/labels';
import { withoutFieldErrors } from '../field-errors';
import { FormField } from '../form-field';
import { ProblemDisplay } from '../problem-display';
import type { ListChoice } from '../schema-form/member-form';
import { problemsOf, type MemberProblem } from '../schema-form/model';
import { CONTROL_CLASS, SchemaForm, type SchemaWidget } from '../schema-form/schema-form';
import { SubmitButton } from '../submit-button';
import { useToast } from '../toasts';
import { useFormAction } from '../use-form-action';
import { listIdsPickerOf } from './list-ids-picker';
import { reportConfigNotes } from './report-config-model';

const COPY = TEMPLATE_FORMS_COPY;
const CONFIG_POINTER = '/data/attributes/config';

type Config = Readonly<Record<string, unknown>>;

/** The API's errors inside the configuration, by pointer within it. */
function configErrors(errors: readonly { pointer: string; detail: string }[]): MemberProblem[] {
  return errors.flatMap((error) =>
    error.pointer === CONFIG_POINTER || error.pointer.startsWith(`${CONFIG_POINTER}/`)
      ? [{ pointer: error.pointer.slice(CONFIG_POINTER.length), detail: error.detail }]
      : [],
  );
}

/** The generated fields of one type's configuration. */
function ConfigFields({
  reportType,
  value,
  onChange,
  lists,
  errors,
}: {
  readonly reportType: ReportType;
  readonly value: Config;
  readonly onChange: (value: Config) => void;
  readonly lists: readonly ListChoice[];
  readonly errors: readonly MemberProblem[];
}) {
  const widgets = useMemo<Readonly<Record<string, SchemaWidget>>>(
    () => (reportType === 'custom-list' ? { 'list-ids': listIdsPickerOf(lists) } : {}),
    [reportType, lists],
  );
  return (
    <SchemaForm
      legend={COPY.reportForms.draftLegend(REPORT_TYPE_LABELS[toReportResourceType(reportType)])}
      schema={REPORT_TEMPLATE_CONFIG_SCHEMAS[reportType]}
      value={value}
      onChange={onChange}
      widgets={widgets}
      notes={reportConfigNotes(reportType)}
      errors={errors}
    />
  );
}

export interface ReportDraftFormProps {
  readonly reportType: ReportType;
  readonly templateId: string;
  readonly versionId: string;
  /** What the draft sets: its resolved configuration less the keys at their default. */
  readonly config: Config;
  readonly lists: readonly ListChoice[];
  readonly action: (state: ActionState, formData: FormData) => Promise<ActionResult>;
}

export function ReportDraftForm({
  reportType,
  templateId,
  versionId,
  config,
  lists,
  action,
}: ReportDraftFormProps): ReactNode {
  const [value, setValue] = useState<Config>(config);
  const [message, setMessage] = useState('');
  const { show } = useToast();
  const { pending, problem, formProps } = useFormAction(action, {
    onSuccess: () => {
      show({ tone: 'success', message: COPY.reportForms.saved });
    },
  });
  const errors = configErrors(problem?.errors ?? []);

  const onSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (problemsOf(REPORT_TEMPLATE_CONFIG_SCHEMAS[reportType], value).length > 0) {
      setMessage(COPY.memberForm.refusedBeforeSending);
      return;
    }
    setMessage('');
    formProps.action(new FormData(event.currentTarget));
  };

  return (
    <form
      {...formProps}
      onSubmit={onSubmit}
      aria-label={COPY.reportForms.draftForm}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="report-template-id" value={templateId} />
      <input type="hidden" name="version-id" value={versionId} />
      <input type="hidden" name="config" value={JSON.stringify(value)} />
      <ConfigFields
        reportType={reportType}
        value={value}
        onChange={setValue}
        lists={lists}
        errors={errors}
      />
      <p role="status" aria-live="polite" className="text-sm font-medium">
        {message}
      </p>
      <ProblemDisplay
        problem={withoutFieldErrors(
          problem,
          (problem?.errors ?? [])
            .filter((error) => error.pointer.startsWith(CONFIG_POINTER))
            .map((error) => error.pointer),
        )}
      />
      <div>
        <SubmitButton pendingLabel={COPY.memberForm.saving} pending={pending}>
          {COPY.reportForms.save}
        </SubmitButton>
      </div>
      <p className="text-sm text-ink-muted">{COPY.reportForms.jsonFallback}</p>
    </form>
  );
}

export interface CreateReportTemplateFormProps {
  readonly lists: readonly ListChoice[];
  readonly action: (
    state: ActionState<{ path: string }>,
    formData: FormData,
  ) => Promise<ActionResult<{ path: string }>>;
}

export function CreateReportTemplateForm({
  lists,
  action,
}: CreateReportTemplateFormProps): ReactNode {
  const [reportType, setReportType] = useState<ReportType>(REPORT_TYPES[0]);
  const [value, setValue] = useState<Config>({});
  const [message, setMessage] = useState('');
  const { pending, problem, formProps } = useFormAction(action);
  const nameError = (problem?.errors ?? [])
    .filter((error) => error.pointer === '/data/attributes/name')
    .map((error) => error.detail)
    .join('. ');

  const onSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (problemsOf(REPORT_TEMPLATE_CONFIG_SCHEMAS[reportType], value).length > 0) {
      setMessage(COPY.memberForm.refusedBeforeSending);
      return;
    }
    setMessage('');
    formProps.action(new FormData(event.currentTarget));
  };

  return (
    <form
      {...formProps}
      onSubmit={onSubmit}
      aria-label={COPY.reportForms.newTitle}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="config" value={JSON.stringify(value)} />
      <FormField
        label={COPY.reportForms.name}
        required
        error={nameError === '' ? undefined : nameError}
      >
        {(control) => (
          <input {...control} name="name" type="text" maxLength={200} className={CONTROL_CLASS} />
        )}
      </FormField>
      <FormField label={COPY.reportForms.type}>
        {(control) => (
          <select
            {...control}
            name="report-type"
            value={reportType}
            onChange={(event) => {
              setReportType(event.currentTarget.value as ReportType);
              setValue({});
            }}
            className={CONTROL_CLASS}
          >
            {REPORT_TYPES.map((type) => (
              <option key={type} value={type}>
                {REPORT_TYPE_LABELS[toReportResourceType(type)]}
              </option>
            ))}
          </select>
        )}
      </FormField>
      <ConfigFields
        key={reportType}
        reportType={reportType}
        value={value}
        onChange={setValue}
        lists={lists}
        errors={configErrors(problem?.errors ?? [])}
      />
      <p role="status" aria-live="polite" className="text-sm font-medium">
        {message}
      </p>
      <ProblemDisplay
        problem={withoutFieldErrors(
          problem,
          (problem?.errors ?? [])
            .filter(
              (error) =>
                error.pointer.startsWith(CONFIG_POINTER) ||
                error.pointer === '/data/attributes/name',
            )
            .map((error) => error.pointer),
        )}
      />
      <div>
        <SubmitButton pendingLabel={COPY.reportForms.creating} pending={pending}>
          {COPY.reportForms.create}
        </SubmitButton>
      </div>
    </form>
  );
}
