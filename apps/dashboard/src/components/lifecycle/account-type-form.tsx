'use client';

import type { AccountTypeResource } from '@openverify/contracts';
import { useState } from 'react';
import {
  fieldErrorOf,
  type ActionResult,
  type ActionState,
  type DisplayProblem,
} from '../../lib/action-state';
import { EnvironmentField } from '../environment-field';
import { FormField, controlClassName } from '../form-field';
import { JsonEditor } from '../json-editor';
import { withoutFieldErrors } from '../field-errors';
import { ProblemDisplay } from '../problem-display';
import { SubmitButton } from '../submit-button';
import { useToast } from '../toasts';
import { useFormAction } from '../use-form-action';
import { ContestRouteFields } from '../workflows/contest-route';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

const NAME = '/data/attributes/name';
const SCHEMA = '/data/attributes/fields-schema';

const EXAMPLE = `{
  "name_first": { "type": "string", "label": "First name" }
}`;

/** The fields of both forms: the name and the fields schema, with the action's errors by path. */
function AccountTypeFields({
  problem,
  name,
  schema,
  schemaDescription,
}: {
  readonly problem: DisplayProblem | undefined;
  readonly name?: string;
  readonly schema: string;
  readonly schemaDescription: string;
}) {
  const errors = problem?.errors ?? [];
  const inSchema = (pointer: string) => pointer === SCHEMA || pointer.startsWith(`${SCHEMA}/`);
  // The editor shows its errors by their path inside the schema: `/founded`, not the request's.
  const schemaErrors = errors
    .filter((error) => inSchema(error.pointer))
    .map((error) => ({ ...error, pointer: error.pointer.slice(SCHEMA.length) || '/' }));
  const shown = errors
    .filter((error) => error.pointer === NAME || inSchema(error.pointer))
    .map((error) => error.pointer);

  return (
    <>
      <FormField label="Name" error={fieldErrorOf(problem, NAME)} required>
        {(control) => (
          <input
            {...control}
            name="name"
            maxLength={100}
            autoComplete="off"
            defaultValue={name}
            className={controlClassName(control)}
          />
        )}
      </FormField>
      <JsonEditor
        label="Fields schema"
        name="fields-schema"
        rows={8}
        defaultValue={schema}
        description={schemaDescription}
        errors={schemaErrors}
      />
      {/* Always announced (Workflow 2D F006); name and schema errors show at their fields. */}
      <ProblemDisplay problem={withoutFieldErrors(problem, shown)} />
    </>
  );
}

const FIELD_SHAPE =
  'Each field key (snake_case) maps to { "type": "string" | "number" | "boolean" | "date", "label": "…" }. Up to 100 fields.';

const FORM_CLASS = 'flex flex-col gap-4 rounded-xl border border-line bg-surface p-6';

/**
 * Creates an account type (C13): its name and the fields its accounts take, as JSON, in the
 * environment the page was rendered for (`environmentId`, Workflow 2D F002).
 */
export function AccountTypeForm({
  action,
  environmentId,
}: {
  readonly action: Action;
  readonly environmentId: string;
}) {
  const { show } = useToast();
  // A new key after each success empties the form, the JSON editor's own state included.
  const [created, setCreated] = useState(0);
  // A refusal keeps the name and schema typed (Workflow 2D K003).
  const { pending, problem, formProps } = useFormAction(action, {
    onSuccess: () => {
      setCreated((count) => count + 1);
      show({ tone: 'success', message: 'Created the account type.' });
    },
  });

  return (
    <form key={created} {...formProps} aria-label="New account type" className={FORM_CLASS}>
      <h2 className="text-lg font-semibold">New account type</h2>
      <EnvironmentField environmentId={environmentId} />
      <AccountTypeFields problem={problem} schema={EXAMPLE} schemaDescription={FIELD_SHAPE} />
      <div>
        <SubmitButton pendingLabel="Creating…" pending={pending}>
          Create account type
        </SubmitButton>
      </div>
    </form>
  );
}

export interface AccountTypeEditFormProps {
  readonly action: Action;
  /** The session environment the page was rendered for (Workflow 2D F002). */
  readonly environmentId: string;
  readonly accountType: AccountTypeResource;
}

/**
 * Changes an account type (C25.3): its name, and its fields schema as one JSON document that
 * replaces the whole schema. Keys may be added and labels changed; the API refuses a removed or
 * retyped key with a 422 at that key's path, which shows in the editor, and the form keeps what
 * was typed.
 */
export function AccountTypeEditForm({
  action,
  environmentId,
  accountType,
}: AccountTypeEditFormProps) {
  const { show } = useToast();
  const { pending, problem, formProps } = useFormAction(action, {
    onSuccess: () => {
      show({ tone: 'success', message: 'Saved the account type.' });
    },
  });

  return (
    <form {...formProps} aria-label="Edit the account type" className={FORM_CLASS}>
      <h2 className="text-lg font-semibold">Edit the account type</h2>
      <EnvironmentField environmentId={environmentId} />
      <input type="hidden" name="account-type-id" value={accountType.id} />
      <AccountTypeFields
        problem={problem}
        name={accountType.attributes.name}
        schema={JSON.stringify(accountType.attributes['fields-schema'], null, 2)}
        schemaDescription={`The whole schema: add fields or change labels. A field cannot be removed or change its type, because accounts may hold values for it. ${FIELD_SHAPE}`}
      />
      {/* C128.3: an account's automated archive may name this route instead of its own. */}
      <input type="hidden" name="contest-route-shown" value="true" />
      <ContestRouteFields
        route={accountType.attributes['contest-route']}
        problem={problem}
        pointer="/data/attributes/contest-route"
      />
      <div>
        <SubmitButton pendingLabel="Saving…" pending={pending}>
          Save changes
        </SubmitButton>
      </div>
    </form>
  );
}
