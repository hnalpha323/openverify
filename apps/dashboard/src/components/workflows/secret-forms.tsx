'use client';

/**
 * The secrets page's forms (C125, C141.7; Workflow 8C review): create a key, set or rotate its value
 * in this environment, delete it. A value is typed into a password control that the browser is
 * asked not to fill, sent once and never shown again; nothing here can read one back.
 */
import { WORKFLOW_SECRET_LIMITS } from '@openverify/contracts';
import {
  fieldErrorOf,
  type ActionResult,
  type ActionState,
  type DisplayProblem,
} from '../../lib/action-state';
import { ConfirmActionButton } from '../confirm-action-button';
import { EnvironmentField } from '../environment-field';
import { withoutFieldErrors } from '../field-errors';
import { FormField, controlClassName } from '../form-field';
import { FormDialogButton } from '../integrations/form-dialog-button';
import { ProblemDisplay } from '../problem-display';
import { SubmitButton } from '../submit-button';
import { useToast } from '../toasts';
import { useFormAction } from '../use-form-action';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

const KEY = '/data/attributes/key';
const DESCRIPTION = '/data/attributes/description';
const HOSTS_PREFIX = '/data/attributes/allowed-hosts';
const VALUE = '/data/attributes/secret-value';

/** C125.1: a new key, unique in the organisation, with the hosts its value may be sent to. */
export function CreateSecretForm({
  environmentId,
  action,
}: {
  readonly environmentId: string;
  readonly action: Action;
}) {
  const { show } = useToast();
  const form = useFormAction(action, {
    resetOnSuccess: true,
    onSuccess: () => {
      show({ tone: 'success', message: 'The secret was created. Set its value next.' });
    },
  });
  const hostErrors = (form.problem?.errors ?? []).filter((error) =>
    error.pointer.startsWith(HOSTS_PREFIX),
  );
  return (
    <form
      {...form.formProps}
      aria-label="Create a secret"
      noValidate
      className="flex flex-col gap-4"
    >
      <EnvironmentField environmentId={environmentId} />
      <FormField
        label="Key"
        required
        description="snake_case, at most 64 characters. Steps name it as {{secrets.<key>}}."
        error={fieldErrorOf(form.problem, KEY)}
      >
        {(control) => (
          <input
            {...control}
            name="key"
            maxLength={64}
            autoComplete="off"
            className={controlClassName(control)}
          />
        )}
      </FormField>
      <FormField label="Description" error={fieldErrorOf(form.problem, DESCRIPTION)}>
        {(control) => (
          <input
            {...control}
            name="description"
            maxLength={WORKFLOW_SECRET_LIMITS['description-length']}
            className={controlClassName(control)}
          />
        )}
      </FormField>
      <FormField
        label="Allowed hosts"
        required
        description="One host per line. The value is only ever sent to these hosts."
        error={
          hostErrors.length === 0 ? undefined : hostErrors.map((error) => error.detail).join('. ')
        }
      >
        {(control) => (
          <textarea
            {...control}
            name="allowed-hosts"
            rows={3}
            className={controlClassName(control)}
          />
        )}
      </FormField>
      <ProblemDisplay
        problem={withoutFieldErrors(form.problem, [
          KEY,
          DESCRIPTION,
          ...hostErrors.map((error) => error.pointer),
        ])}
      />
      <div>
        <SubmitButton pendingLabel="Creating…" pending={form.pending}>
          Create secret
        </SubmitButton>
      </div>
    </form>
  );
}

/** C125.2: set (no value yet) or rotate the value of `secretKey` in this environment. */
export function SecretValueButton({
  secretKey,
  hasValue,
  action,
}: {
  readonly secretKey: string;
  readonly hasValue: boolean;
  readonly action: Action;
}) {
  const mode = hasValue ? 'rotate' : 'set';
  const label = hasValue ? 'Rotate' : 'Set the value';
  return (
    <FormDialogButton
      label={label}
      accessibleLabel={
        hasValue ? `Rotate the value of ${secretKey}` : `Set the value of ${secretKey}`
      }
      title={hasValue ? `Rotate ${secretKey}` : `Set the value of ${secretKey}`}
      description={
        hasValue
          ? 'The new value replaces the current one in this environment. A signing secret’s previous value keeps verifying for 24 hours.'
          : 'The value is stored sealed for this environment only, and never shown again.'
      }
      submitLabel={hasValue ? 'Rotate' : 'Save value'}
      pendingLabel="Saving…"
      action={action}
      fields={{ key: secretKey, mode }}
      successMessage={hasValue ? 'The value was rotated.' : 'The value was saved.'}
    >
      {(problem) => (
        <FormField label="Value" required error={fieldErrorOf(problem, VALUE)}>
          {(control) => (
            <input
              {...control}
              type="password"
              name="secret-value"
              autoComplete="off"
              spellCheck={false}
              className={controlClassName(control)}
            />
          )}
        </FormField>
      )}
    </FormDialogButton>
  );
}

/** C125.1: deleting a key; the API refuses one a published version still names. */
export function DeleteSecretButton({
  secretKey,
  action,
}: {
  readonly secretKey: string;
  readonly action: Action;
}) {
  return (
    <ConfirmActionButton
      label="Delete"
      accessibleLabel={`Delete ${secretKey}`}
      title={`Delete ${secretKey}?`}
      description="Its value is deleted in every environment. A key a published version still names cannot be deleted."
      confirmLabel="Delete"
      action={action}
      fields={{ key: secretKey }}
      successMessage="The secret was deleted."
    />
  );
}

const HEADERS_PREFIX = '/data/attributes/allowed-placements/headers';
const POINTERS_PREFIX = '/data/attributes/allowed-placements/body-pointers';

/** The errors at or under `prefix`, each named by its position ("Host 2: …"), never its value. */
function listErrors(
  problem: DisplayProblem | undefined,
  prefix: string,
  noun: string,
): { readonly pointers: string[]; readonly text: string | undefined } {
  const errors = (problem?.errors ?? []).filter(
    (error) => error.pointer === prefix || error.pointer.startsWith(`${prefix}/`),
  );
  const text = errors
    .map((error) => {
      const index = /\/(\d+)$/.exec(error.pointer.slice(prefix.length))?.[1];
      return index === undefined
        ? error.detail
        : `${noun} ${String(Number(index) + 1)}: ${error.detail}`;
    })
    .join('. ');
  return { pointers: errors.map((error) => error.pointer), text: text === '' ? undefined : text };
}

/**
 * C125.2: a key's description, the hosts its value may go to and where in a request it may stand
 * (header names, and JSON Pointers into a body). No value is asked for or shown. Each refusal is
 * shown at its list, by position.
 */
export function EditSecretButton({
  secretKey,
  description,
  hosts,
  headers,
  bodyPointers,
  action,
}: {
  readonly secretKey: string;
  readonly description: string | null;
  readonly hosts: readonly string[];
  readonly headers: readonly string[];
  readonly bodyPointers: readonly string[];
  readonly action: Action;
}) {
  return (
    <FormDialogButton
      label="Edit"
      accessibleLabel={`Edit ${secretKey}`}
      title={`Edit ${secretKey}`}
      description="The key and its values stay as they are. Changing the hosts or placements needs a production user session when the key holds a production value, and is recorded in every environment that holds one."
      submitLabel="Save"
      pendingLabel="Saving…"
      action={action}
      fields={{ key: secretKey }}
      successMessage="The secret was updated."
    >
      {(problem) => {
        const hostErrors = listErrors(problem, HOSTS_PREFIX, 'Host');
        const headerErrors = listErrors(problem, HEADERS_PREFIX, 'Header');
        const pointerErrors = listErrors(problem, POINTERS_PREFIX, 'Pointer');
        return (
          <div className="flex flex-col gap-4">
            <FormField label="Description" error={fieldErrorOf(problem, DESCRIPTION)}>
              {(control) => (
                <input
                  {...control}
                  name="description"
                  defaultValue={description ?? ''}
                  maxLength={WORKFLOW_SECRET_LIMITS['description-length']}
                  className={controlClassName(control)}
                />
              )}
            </FormField>
            <FormField
              label="Allowed hosts"
              required
              description="One host per line. The value is only ever sent to these hosts."
              error={hostErrors.text}
            >
              {(control) => (
                <textarea
                  {...control}
                  name="allowed-hosts"
                  rows={3}
                  defaultValue={hosts.join('\n')}
                  className={controlClassName(control)}
                />
              )}
            </FormField>
            <FormField
              label="Headers that may carry it"
              description="One header name per line; authorization by default."
              error={headerErrors.text}
            >
              {(control) => (
                <textarea
                  {...control}
                  name="header-placements"
                  rows={2}
                  defaultValue={headers.join('\n')}
                  className={controlClassName(control)}
                />
              )}
            </FormField>
            <FormField
              label="Body pointers that may carry it"
              description="One JSON Pointer into a request body per line, such as /auth/token; none by default."
              error={pointerErrors.text}
            >
              {(control) => (
                <textarea
                  {...control}
                  name="body-pointers"
                  rows={2}
                  defaultValue={bodyPointers.join('\n')}
                  className={controlClassName(control)}
                />
              )}
            </FormField>
            <ProblemDisplay
              problem={withoutFieldErrors(problem, [
                DESCRIPTION,
                ...hostErrors.pointers,
                ...headerErrors.pointers,
                ...pointerErrors.pointers,
              ])}
            />
          </div>
        );
      }}
    </FormDialogButton>
  );
}
