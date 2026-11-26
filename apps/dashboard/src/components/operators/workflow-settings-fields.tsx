/**
 * C143.7: the workflow settings of the settings form, in the session's environment, under
 * `settings:write`: the run windows, the in-flight cap, the HTTPS ports and hosts, the message
 * recipients, countries and link hosts, and the case retention. The private networks also need
 * `settings:privacy` (C124.3): without it they show read-only and are never posted, because the API
 * refuses the whole save. A setting the server does not report is left out, so it is never posted.
 * A list is typed one entry per line; a list whose `null` means something (the host allowlist off,
 * the SMS countries following the template) has a box beside it and a `<name>-shown` marker.
 */
import type { DashboardSettings, EnvironmentKind } from '@openverify/contracts';
import { Checkbox, Field, Input } from '@openverify/ui';
import { fieldErrorOf, type DisplayProblem } from '../../lib/action-state';
import { FormField, controlClassName } from '../form-field';
import {
  ENVIRONMENT_NAMES,
  WORKFLOW_LIST_FIELDS,
  WORKFLOW_NUMBER_FIELDS,
  WORKFLOW_SETTING_NAMES,
  type WorkflowListField,
} from './settings-fields';

/** The pointers the workflow settings show at their own fields: each setting and its entries. */
export const WORKFLOW_SETTING_POINTERS: readonly string[] = WORKFLOW_SETTING_NAMES.map(
  (name) => `/${name}`,
);

/** The errors of a list's entries ("Entry 2: …"), or of the list itself, by pointer. */
export function listErrorOf(problem: DisplayProblem | undefined, name: string): string | undefined {
  const prefix = `/${name}`;
  const text = (problem?.errors ?? [])
    .filter((error) => error.pointer === prefix || error.pointer.startsWith(`${prefix}/`))
    .map((error) => {
      const index = /^\/(\d+)$/.exec(error.pointer.slice(prefix.length))?.[1];
      return index === undefined
        ? error.detail
        : `Entry ${String(Number(index) + 1)}: ${error.detail}`;
    })
    .join('. ');
  return text === '' ? undefined : text;
}

/** The entry pointers of every list, so the form's own problem display leaves them out. */
export function workflowListPointers(problem: DisplayProblem | undefined): string[] {
  return (problem?.errors ?? [])
    .map((error) => error.pointer)
    .filter((pointer) =>
      WORKFLOW_LIST_FIELDS.some((field) => pointer.startsWith(`/${field.name}/`)),
    );
}

const linesOf = (value: unknown): string =>
  Array.isArray(value) ? value.map((entry) => String(entry)).join('\n') : '';

function ListField({
  field,
  value,
  problem,
}: {
  readonly field: WorkflowListField;
  readonly value: unknown;
  readonly problem: DisplayProblem | undefined;
}) {
  return (
    <div className="flex flex-col gap-2">
      {field.toggle !== null && (
        <>
          <input type="hidden" name={`${field.name}-shown`} value="true" />
          <Checkbox
            name={`${field.name}-on`}
            value="true"
            label={field.toggle.label}
            description={field.toggle.off}
            defaultChecked={value !== null}
          />
        </>
      )}
      <FormField
        label={field.label}
        description={field.description}
        error={listErrorOf(problem, field.name)}
      >
        {(control) => (
          <textarea
            {...control}
            name={field.name}
            rows={3}
            spellCheck={false}
            defaultValue={linesOf(value)}
            className={controlClassName(control)}
          />
        )}
      </FormField>
    </div>
  );
}

export function WorkflowSettingsFields({
  settings,
  environment,
  canPrivacy,
  problem,
}: {
  readonly settings: DashboardSettings;
  readonly environment: EnvironmentKind;
  readonly canPrivacy: boolean;
  readonly problem: DisplayProblem | undefined;
}) {
  const served = (name: string) => settings[name as keyof DashboardSettings] !== undefined;
  if (!WORKFLOW_SETTING_NAMES.some(served)) {
    return null;
  }
  return (
    <fieldset className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-6">
      <legend className="px-1 text-lg font-semibold text-ink">
        Workflows in {ENVIRONMENT_NAMES[environment]}
      </legend>
      <div className="grid gap-4 sm:grid-cols-2">
        {WORKFLOW_NUMBER_FIELDS.filter((field) => served(field.name)).map((field) => (
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
      <div className="grid gap-4 sm:grid-cols-2">
        {WORKFLOW_LIST_FIELDS.filter((field) => served(field.name)).map((field) => {
          const value = settings[field.name];
          if (field.privacy && !canPrivacy) {
            const entries = Array.isArray(value) && value.length > 0 ? value.join(', ') : 'none';
            return (
              <p key={field.name} className="text-sm">
                {`Private networks: ${entries} (needs settings:privacy to change)`}
              </p>
            );
          }
          return <ListField key={field.name} field={field} value={value} problem={problem} />;
        })}
      </div>
    </fieldset>
  );
}
