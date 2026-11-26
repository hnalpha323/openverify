'use client';

/**
 * C112.6: names a new workflow and opens its draft (Workflow 8C review, C141), empty or started
 * from a review-first decision template (C128.5) with the basis, contest route and case template
 * the operator gives. A template only makes a draft; it is published like any other.
 */
import { BIOMETRIC_BASES, DECISION_BASES } from '@openverify/core';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { fieldErrorOf, type ActionResult, type ActionState } from '../../lib/action-state';
import { EnvironmentField } from '../environment-field';
import { withoutFieldErrors } from '../field-errors';
import { FormField, controlClassName } from '../form-field';
import { ProblemDisplay } from '../problem-display';
import { SubmitButton } from '../submit-button';
import { useFormAction } from '../use-form-action';
import { DECISION_TEMPLATES } from './decision-templates';

const NAME = '/data/attributes/name';
const DESCRIPTION = '/data/attributes/description';
const TEMPLATE_POINTERS = [
  '/template',
  '/case-template-id',
  '/decision-basis',
  '/contest-route',
  '/contest-route/url',
  '/contest-route/contact',
  '/biometric-basis',
];

const DECISION_BASIS_WORDS: Readonly<Record<(typeof DECISION_BASES)[number], string>> = {
  contract: 'Contract',
  law: 'Law',
  'explicit-consent': 'Explicit consent',
};

const BIOMETRIC_BASIS_WORDS: Readonly<Record<(typeof BIOMETRIC_BASES)[number], string>> = {
  'explicit-consent': 'Explicit consent',
  'substantial-public-interest': 'Substantial public interest',
};

export function CreateWorkflowForm({
  environmentId,
  action,
}: {
  readonly environmentId: string;
  readonly action: (
    state: ActionState<{ readonly workflowId: string }>,
    formData: FormData,
  ) => Promise<ActionResult<{ readonly workflowId: string }>>;
}) {
  const router = useRouter();
  const [template, setTemplate] = useState('');
  const form = useFormAction(action, {
    onSuccess: ({ workflowId }) => {
      router.push(`/workflows/${workflowId}/draft`);
    },
  });
  return (
    <form
      {...form.formProps}
      aria-label="Create a workflow"
      noValidate
      className="flex flex-wrap items-end gap-4"
    >
      <EnvironmentField environmentId={environmentId} />
      <FormField label="Name" required error={fieldErrorOf(form.problem, NAME)}>
        {(control) => (
          <input {...control} name="name" maxLength={255} className={controlClassName(control)} />
        )}
      </FormField>
      <FormField label="Description" error={fieldErrorOf(form.problem, DESCRIPTION)}>
        {(control) => (
          <input
            {...control}
            name="description"
            maxLength={500}
            className={controlClassName(control)}
          />
        )}
      </FormField>
      <FormField label="Start from a template">
        {(control) => (
          <select
            {...control}
            name="template"
            value={template}
            onChange={(event) => {
              setTemplate(event.target.value);
            }}
            className={controlClassName(control)}
          >
            <option value="">An empty draft</option>
            {DECISION_TEMPLATES.map((choice) => (
              <option key={choice.key} value={choice.key}>
                {choice.name}
              </option>
            ))}
          </select>
        )}
      </FormField>
      {template !== '' && (
        <fieldset className="flex w-full flex-col gap-3">
          <legend className="text-sm font-semibold">The template’s decision</legend>
          <p className="text-sm">
            {DECISION_TEMPLATES.find((choice) => choice.key === template)?.description} The template
            makes a draft; nothing is published. In production a decline needs its basis and contest
            route before it can be published; left empty here, you fill them in the draft.
          </p>
          <div className="flex flex-wrap items-end gap-4">
            <FormField
              label="Case template id"
              description="The review case’s template (ctmpl_…)."
              error={fieldErrorOf(form.problem, '/case-template-id')}
            >
              {(control) => (
                <input
                  {...control}
                  name="case-template-id"
                  spellCheck={false}
                  className={controlClassName(control)}
                />
              )}
            </FormField>
            <FormField label="Decision basis" error={fieldErrorOf(form.problem, '/decision-basis')}>
              {(control) => (
                <select
                  {...control}
                  name="decision-basis"
                  defaultValue=""
                  className={controlClassName(control)}
                >
                  <option value="">Not declared yet</option>
                  {DECISION_BASES.map((basis) => (
                    <option key={basis} value={basis}>
                      {DECISION_BASIS_WORDS[basis]}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
            <FormField
              label="Contest route URL"
              description="An https: page where the person contests the decision."
              error={fieldErrorOf(form.problem, '/contest-route/url')}
            >
              {(control) => (
                <input
                  {...control}
                  name="contest-url"
                  type="url"
                  className={controlClassName(control)}
                />
              )}
            </FormField>
            <FormField
              label="Contest route contact"
              description="Or how the person reaches a reviewer, such as an address."
              error={fieldErrorOf(form.problem, '/contest-route/contact')}
            >
              {(control) => (
                <input
                  {...control}
                  name="contest-contact"
                  maxLength={200}
                  className={controlClassName(control)}
                />
              )}
            </FormField>
            <FormField
              label="Biometric basis"
              description="For a decline that reads a biometric result."
              error={fieldErrorOf(form.problem, '/biometric-basis')}
            >
              {(control) => (
                <select
                  {...control}
                  name="biometric-basis"
                  defaultValue=""
                  className={controlClassName(control)}
                >
                  <option value="">Not declared yet</option>
                  {BIOMETRIC_BASES.map((basis) => (
                    <option key={basis} value={basis}>
                      {BIOMETRIC_BASIS_WORDS[basis]}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
          </div>
        </fieldset>
      )}
      <SubmitButton pendingLabel="Creating…" pending={form.pending}>
        Create workflow
      </SubmitButton>
      <ProblemDisplay
        className="w-full"
        problem={withoutFieldErrors(form.problem, [NAME, DESCRIPTION, ...TEMPLATE_POINTERS])}
      />
    </form>
  );
}
