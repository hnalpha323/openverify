'use client';

import type { CaseTemplateVersionResource } from '@openverify/contracts';
import {
  CASE_ATTACHMENT_TYPES,
  CASE_HELD_OBJECT_TYPES,
  CASE_LAYOUT_MODULES,
  CASE_LIMITS,
  CASE_SLA_STARTS_ON,
} from '@openverify/core';
import { Checkbox } from '@openverify/ui';
import { useId, type ReactNode } from 'react';
import type { ActionResult, ActionState, DisplayProblem } from '../../lib/action-state';
import { withoutFieldErrors } from '../field-errors';
import { FormField, controlClassName } from '../form-field';
import { JsonEditor } from '../json-editor';
import { ProblemDisplay } from '../problem-display';
import { SubmitButton } from '../submit-button';
import { useToast } from '../toasts';
import { useFormAction } from '../use-form-action';
import {
  ATTACHMENT_TYPE_WORDS,
  HELD_OBJECT_TYPE_WORDS,
  LAYOUT_MODULE_WORDS,
  SLA_STARTS_ON_WORDS,
} from './case-words';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

export interface VersionChoice {
  readonly id: string;
  readonly name: string;
}

export interface VersionEditorProps {
  readonly templateId: string;
  readonly version: CaseTemplateVersionResource;
  /** What the version may name, as far as the operator reads it (`case-queues:read`). */
  readonly choices: {
    readonly queues: readonly VersionChoice[];
    readonly assignmentPolicies: readonly VersionChoice[];
    readonly slaPolicies: readonly VersionChoice[];
  };
  readonly action: Action;
}

const ROOT = '/data/attributes';
const MEMBERS = [
  'field-schemas',
  'statuses',
  'transitions',
  'resolutions',
  'default-queue-id',
  'assignment-policy-id',
  'sla-policy-id',
  'sla-starts-on',
  'held-object-types',
  'attachment-policy',
  'notify-on-create',
  'layout-modules',
] as const;
type Member = (typeof MEMBERS)[number];

/** The problem's errors inside one member, by pointer within it. */
function errorsIn(problem: DisplayProblem | undefined, member: Member) {
  const root = `${ROOT}/${member}`;
  return (problem?.errors ?? [])
    .filter((error) => error.pointer === root || error.pointer.startsWith(`${root}/`))
    .map((error) => ({ pointer: error.pointer.slice(root.length) || '/', detail: error.detail }));
}

/** One member's errors as a field's message. */
function messageOf(problem: DisplayProblem | undefined, member: Member): string | undefined {
  const errors = errorsIn(problem, member);
  return errors.length === 0
    ? undefined
    : errors
        .map((error) =>
          error.pointer === '/' ? error.detail : `${error.pointer}: ${error.detail}`,
        )
        .join('. ');
}

/** A select of `choices`, keeping the saved id as an option even when the reader cannot name it. */
function ChoiceSelect({
  label,
  name,
  value,
  choices,
  none,
  error,
}: {
  readonly label: string;
  readonly name: Member;
  readonly value: string | null;
  readonly choices: readonly VersionChoice[];
  readonly none: string;
  readonly error: string | undefined;
}) {
  return (
    <FormField label={label} error={error}>
      {(control) => (
        <select
          {...control}
          name={name}
          defaultValue={value ?? ''}
          className={controlClassName(control)}
        >
          <option value="">{none}</option>
          {choices.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.name}
            </option>
          ))}
          {value !== null && !choices.some((choice) => choice.id === value) && (
            <option value={value}>{value}</option>
          )}
        </select>
      )}
    </FormField>
  );
}

/** A labelled group of checkboxes. */
function CheckboxGroup({
  legend,
  description,
  error,
  children,
}: {
  readonly legend: string;
  readonly description?: string;
  readonly error?: string | undefined;
  readonly children: ReactNode;
}) {
  const id = useId();
  return (
    <fieldset
      aria-labelledby={`${id}-legend`}
      aria-describedby={
        [
          description === undefined ? undefined : `${id}-description`,
          error === undefined ? undefined : `${id}-error`,
        ]
          .filter(Boolean)
          .join(' ') || undefined
      }
      className="flex flex-col gap-2"
    >
      <legend id={`${id}-legend`} className="text-sm font-medium text-ink">
        {legend}
      </legend>
      {description !== undefined && (
        <p id={`${id}-description`} className="text-sm text-ink-muted">
          {description}
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
      {error !== undefined && (
        <p id={`${id}-error`} className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/**
 * A draft version's editor (C130.2, C142.1): its fields and statuses as JSON documents (each error
 * shown under its document at its pointer), the moves between the saved statuses as a grid of
 * checkboxes, its resolutions one per line, the queue and policies it starts a case with, when the
 * SLA starts, what a case may hold, the attachment policy, who is told of a new case and the default
 * modules. A refusal keeps everything as typed.
 */
export function VersionEditor({ templateId, version, choices, action }: VersionEditorProps) {
  const { show } = useToast();
  const form = useFormAction(action, {
    onSuccess: () => {
      show({ tone: 'success', message: 'Saved the draft.' });
    },
  });
  const shown = form.problem;
  const { attributes } = version;
  const moves = new Set(
    Object.entries(attributes.transitions).flatMap(([from, to]) =>
      to.map((key) => `${from}>${key}`),
    ),
  );
  const modules = new Map(attributes['layout-modules'].map((module) => [module.key, module]));
  const placed = MEMBERS.flatMap((member) =>
    errorsIn(shown, member).map(
      (error) => `${ROOT}/${member}${error.pointer === '/' ? '' : error.pointer}`,
    ),
  );
  return (
    <form {...form.formProps} aria-label="Edit the draft" className="flex flex-col gap-6">
      <input type="hidden" name="case-template-id" value={templateId} />
      <input type="hidden" name="version-id" value={version.id} />
      <JsonEditor
        label="Fields"
        name="field-schemas"
        rows={14}
        description="The field schemas a case of this version carries, as transaction types write them. A case field is never a file (attachments carry files) or JSON."
        defaultValue={JSON.stringify(attributes['field-schemas'], null, 2)}
        errors={errorsIn(shown, 'field-schemas')}
      />
      <JsonEditor
        label="Statuses"
        name="statuses"
        rows={14}
        description="Each status has a key, a label, a category (initial, intermediate or end), pauses-sla, required-comment, status-tags and status-tag-required. A version needs exactly one initial status and at least one end status."
        defaultValue={JSON.stringify(attributes.statuses, null, 2)}
        errors={errorsIn(shown, 'statuses')}
      />
      <CheckboxGroup
        legend="Allowed moves"
        description="Which status a case may move to from each status, for the statuses saved. After adding or removing a status, save, then choose its moves. Publishing refuses an end status that no path of moves reaches from the initial status."
        error={messageOf(shown, 'transitions')}
      >
        {attributes.statuses.flatMap((from) =>
          attributes.statuses
            .filter((to) => to.key !== from.key)
            .map((to) => (
              <Checkbox
                key={`${from.key}>${to.key}`}
                name="transition"
                value={`${from.key}>${to.key}`}
                defaultChecked={moves.has(`${from.key}>${to.key}`)}
                label={`From ${from.label} to ${to.label}`}
              />
            )),
        )}
      </CheckboxGroup>
      <FormField
        label="Resolutions"
        description="One per line. Resolving a case into an end status sets one of these; with none chosen, the status’s label when it is one of them."
        error={messageOf(shown, 'resolutions')}
      >
        {(control) => (
          <textarea
            {...control}
            name="resolutions"
            rows={3}
            defaultValue={attributes.resolutions.join('\n')}
            className={controlClassName(control)}
          />
        )}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <ChoiceSelect
          label="Default queue"
          name="default-queue-id"
          value={attributes['default-queue-id']}
          choices={choices.queues}
          none="None: a case enters no queue"
          error={messageOf(shown, 'default-queue-id')}
        />
        <ChoiceSelect
          label="Assignment policy"
          name="assignment-policy-id"
          value={attributes['assignment-policy-id']}
          choices={choices.assignmentPolicies}
          none="None: assigned by hand or pulled"
          error={messageOf(shown, 'assignment-policy-id')}
        />
        <ChoiceSelect
          label="SLA policy"
          name="sla-policy-id"
          value={attributes['sla-policy-id']}
          choices={choices.slaPolicies}
          none="None: no SLA unless one is set on the case"
          error={messageOf(shown, 'sla-policy-id')}
        />
        <FormField label="The SLA starts" error={messageOf(shown, 'sla-starts-on')}>
          {(control) => (
            <select
              {...control}
              name="sla-starts-on"
              defaultValue={attributes['sla-starts-on']}
              className={controlClassName(control)}
            >
              {CASE_SLA_STARTS_ON.map((each) => (
                <option key={each} value={each}>
                  {SLA_STARTS_ON_WORDS[each]}
                </option>
              ))}
            </select>
          )}
        </FormField>
      </div>
      <CheckboxGroup legend="Objects a case may hold" error={messageOf(shown, 'held-object-types')}>
        {CASE_HELD_OBJECT_TYPES.map((type) => (
          <Checkbox
            key={type}
            name="held-object-types"
            value={type}
            defaultChecked={attributes['held-object-types'].includes(type)}
            label={HELD_OBJECT_TYPE_WORDS[type]}
          />
        ))}
      </CheckboxGroup>
      <FormField
        label="Attachments per case"
        description={`0 to ${String(CASE_LIMITS['attachments-per-case'].value)}; each file at most 10 MiB.`}
        error={messageOf(shown, 'attachment-policy')}
      >
        {(control) => (
          <input
            {...control}
            type="number"
            name="attachment-max-files"
            min={0}
            max={CASE_LIMITS['attachments-per-case'].value}
            defaultValue={attributes['attachment-policy']['max-files']}
            className={controlClassName(control)}
          />
        )}
      </FormField>
      <CheckboxGroup legend="Attachment types">
        {CASE_ATTACHMENT_TYPES.map((type) => (
          <Checkbox
            key={type}
            name="attachment-types"
            value={type}
            defaultChecked={attributes['attachment-policy'].types.includes(type)}
            label={ATTACHMENT_TYPE_WORDS[type]}
          />
        ))}
      </CheckboxGroup>
      <FormField
        label="Told of a new case"
        description="User IDs, separated by spaces, commas or lines. Publishing refuses anyone who cannot read this template’s cases."
        error={messageOf(shown, 'notify-on-create')}
      >
        {(control) => (
          <textarea
            {...control}
            name="notify-on-create"
            rows={2}
            defaultValue={attributes['notify-on-create'].join('\n')}
            className={controlClassName(control)}
          />
        )}
      </FormField>
      <CheckboxGroup
        legend="Default modules"
        description="The modules of a case’s page. Each keeps the permissions it was saved with; a reader without them does not see it."
        error={messageOf(shown, 'layout-modules')}
      >
        {CASE_LAYOUT_MODULES.map((key) => {
          const saved = modules.get(key);
          return (
            <div key={key}>
              <Checkbox
                name="layout-modules"
                value={key}
                defaultChecked={saved !== undefined}
                label={LAYOUT_MODULE_WORDS[key]}
              />
              {saved !== undefined && saved['required-permissions'].length > 0 && (
                <input
                  type="hidden"
                  name={`module-permissions:${key}`}
                  value={saved['required-permissions'].join(' ')}
                />
              )}
            </div>
          );
        })}
      </CheckboxGroup>
      <ProblemDisplay problem={withoutFieldErrors(shown, placed)} />
      <div>
        <SubmitButton pendingLabel="Saving…" pending={form.pending}>
          Save draft
        </SubmitButton>
      </div>
    </form>
  );
}
