'use client';

/**
 * A step's settings as a form (C141.4): an action's config members typed by the catalogue's config
 * schema, each text field with "Insert a variable" (C115.3); a wait's time or events with its filter;
 * a conditional's ordered routes, each with its label and condition (C114). A change applies as one
 * undoable edit per field while it is typed; a value that does not hold its type is said at its
 * field and not applied. An egress step whose settings read personal data says so (C121.4), and an
 * Evaluate Code step links its sandbox test (C120.7, C141.9).
 */
import { Button } from '@openverify/ui';
import Link from 'next/link';
import { useId, useRef, useState } from 'react';
import { LINK_CLASS } from '../../link-styles';
import { ConditionBuilder } from './condition-builder';
import {
  moveRoute,
  removeRoute,
  updateRoute,
  updateStep,
  type DraftDefinition,
  type DraftStep,
  type Edited,
} from './document-model';
import type { CatalogueAction } from './palette-model';
import {
  fieldsOf,
  fieldText,
  parseFieldText,
  type FieldKind,
  type FormField,
} from './schema-form-model';
import { VariablePicker } from './variable-picker';
import { egressOf, type ScopePath } from './variable-scope';

export type ApplyEdit = (edited: Edited | null, message: string, gesture?: string) => void;

export interface StepFormProps {
  readonly workflowId: string;
  readonly step: DraftStep;
  readonly definition: DraftDefinition;
  readonly action: CatalogueAction | undefined;
  readonly scope: readonly ScopePath[];
  readonly apply: ApplyEdit;
}

const CONTROL =
  'min-h-11 rounded-md border border-control bg-surface px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const TEXTUAL: ReadonlySet<FieldKind> = new Set(['text', 'number', 'integer', 'json']);

/** One field: its control, its hint, its problem and, for text, the variable picker. */
function SchemaField({
  field,
  value,
  scope,
  onValue,
}: {
  readonly field: FormField;
  readonly value: unknown;
  readonly scope: readonly ScopePath[];
  readonly onValue: (value: unknown) => void;
}) {
  const id = useId();
  const [text, setText] = useState(() => fieldText(field, value));
  const [problem, setProblem] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const control = useRef<HTMLTextAreaElement & HTMLSelectElement>(null);
  const label = `${field.name}${field.required ? ' (required)' : ''}`;

  const take = (next: string) => {
    setText(next);
    const parsed = parseFieldText(field, next);
    if (parsed.ok) {
      setProblem(null);
      onValue(parsed.value);
    } else {
      setProblem(parsed.problem);
    }
  };

  const described = `${id}-hint${problem === null ? '' : ` ${id}-problem`}`;
  const choices =
    field.kind === 'boolean'
      ? [
          ['true', 'Yes'],
          ['false', 'No'],
        ]
      : field.options.map((option) => [option, option]);

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {field.kind === 'boolean' || field.kind === 'enum' ? (
        <select
          id={id}
          ref={control}
          value={text}
          aria-describedby={described}
          onChange={(event) => {
            take(event.currentTarget.value);
          }}
          className={CONTROL}
        >
          <option value="">Not set</option>
          {choices.map(([option = '', words = '']) => (
            <option key={option} value={option}>
              {words}
            </option>
          ))}
        </select>
      ) : (
        <textarea
          id={id}
          ref={control}
          value={text}
          rows={field.kind === 'json' ? 4 : field.kind === 'text' ? 2 : 1}
          aria-describedby={described}
          aria-invalid={problem === null ? undefined : true}
          onChange={(event) => {
            take(event.currentTarget.value);
          }}
          className={`${CONTROL} py-2 font-mono`}
        />
      )}
      <p id={`${id}-hint`} className="text-xs text-ink-muted">
        {field.hint}
      </p>
      {problem !== null && (
        <p id={`${id}-problem`} className="text-sm font-medium">
          {problem}
        </p>
      )}
      {TEXTUAL.has(field.kind) && !field.secret && (
        <div>
          <Button
            variant="secondary"
            onClick={() => {
              setPicking(true);
            }}
          >
            Insert a variable into {field.name}
          </Button>
        </div>
      )}
      <VariablePicker
        open={picking}
        field={field.name}
        scope={scope}
        onClose={() => {
          setPicking(false);
        }}
        onPick={(path) => {
          setPicking(false);
          const reference = `{{ ${path} }}`;
          const at = control.current?.selectionStart ?? text.length;
          take(`${text.slice(0, at)}${reference}${text.slice(at)}`);
          control.current?.focus();
        }}
      />
    </div>
  );
}

function ActionForm({ workflowId, step, definition, action, scope, apply }: StepFormProps) {
  const fields = fieldsOf(action?.configSchema);
  const config = isRecord(step.config) ? step.config : {};
  const egress = egressOf(step, action, scope);
  const key = String(step['action-key']);
  return (
    <div className="flex flex-col gap-3">
      {egress.length > 0 && (
        <p className="rounded-md border border-line p-2 text-sm font-medium">
          <span aria-hidden="true">⇢ </span>
          Egress: personal data leaves OpenVerify in this step ({egress.join(', ')}). Publishing
          needs your pii:view and the acknowledgement egress:{step.id}, and each send is audited.
        </p>
      )}
      {action === undefined ? (
        <p className="text-sm">
          The catalogue has no {key} here, so its settings are edited in the definition.
        </p>
      ) : fields.length === 0 ? (
        <p className="text-sm">This action has no settings.</p>
      ) : (
        <fieldset className="flex flex-col gap-3">
          <legend className="text-sm font-semibold">Settings of {key}</legend>
          {fields.map((field) => (
            <SchemaField
              key={field.name}
              field={field}
              value={config[field.name]}
              scope={scope}
              onValue={(value) => {
                apply(
                  updateStep(definition, step.id, { config: { ...config, [field.name]: value } }),
                  `Changed ${field.name} of ${step.name}.`,
                  `config:${step.id}:${field.name}`,
                );
              }}
            />
          ))}
        </fieldset>
      )}
      <ContinueOnError step={step} definition={definition} apply={apply} />
      {key === 'evaluate_code' && (
        <p className="text-sm">
          <Link
            href={`/workflows/${workflowId}/test-runs?start-step=${step.id}&end-step=${step.id}`}
            className={LINK_CLASS}
          >
            Test this step
          </Link>{' '}
          in a sandbox test run, from this step to this step.
        </p>
      )}
    </div>
  );
}

function ContinueOnError({
  step,
  definition,
  apply,
}: Pick<StepFormProps, 'step' | 'definition' | 'apply'>) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <input
        id={id}
        type="checkbox"
        className="size-6"
        checked={step['continue-on-error'] === true}
        onChange={(event) => {
          apply(
            updateStep(definition, step.id, {
              'continue-on-error': event.currentTarget.checked ? true : undefined,
            }),
            `Changed whether ${step.name} continues on error.`,
          );
        }}
      />
      <label htmlFor={id} className="text-sm">
        Continue on error: the run goes on, and every output of this step can then be unknown (null)
      </label>
    </div>
  );
}

const member = (
  name: string,
  kind: FieldKind,
  hint: string,
  options: string[] = [],
): FormField => ({
  name,
  kind,
  required: true,
  options,
  hint,
  secret: false,
});

const WAIT_FIELDS: Readonly<Record<string, readonly FormField[]>> = {
  time: [member('seconds', 'integer', 'A whole number of seconds, from 1 to 2,592,000 (30 days).')],
  events: [
    member('subject', 'text', 'A path to the id of the object whose events end the wait.'),
    member('timeout-seconds', 'integer', 'A whole number of seconds, at most 2,592,000 (30 days).'),
    member('on-timeout', 'enum', 'What the run does when no event came.', ['continue', 'error']),
  ],
};

function WaitForm({ step, definition, scope, apply }: StepFormProps) {
  const id = useId();
  const events = Array.isArray(step.events) ? step.events.map(String) : [];
  const fields = WAIT_FIELDS[String(step.mode)] ?? [];
  const change = (patch: Readonly<Record<string, unknown>>, name: string) => {
    apply(
      updateStep(definition, step.id, patch),
      `Changed ${name} of ${step.name}.`,
      `wait:${step.id}:${name}`,
    );
  };
  return (
    <div className="flex flex-col gap-3">
      {fields.map((field) => (
        <SchemaField
          key={field.name}
          field={field}
          value={step[field.name]}
          scope={field.name === 'subject' ? [] : scope}
          onValue={(value) => {
            change({ [field.name]: value }, field.name);
          }}
        />
      ))}
      {step.mode === 'events' && (
        <>
          <label htmlFor={`${id}-events`} className="text-sm font-medium">
            Events, one per line
          </label>
          <textarea
            id={`${id}-events`}
            defaultValue={events.join('\n')}
            rows={3}
            onChange={(event) => {
              change(
                {
                  events: event.currentTarget.value
                    .split('\n')
                    .map((line) => line.trim())
                    .filter((line) => line !== ''),
                },
                'events',
              );
            }}
            className={`${CONTROL} py-2 font-mono`}
          />
          <ConditionBuilder
            label={`Filter of ${step.name}`}
            condition={step.filter}
            onNull={typeof step['on-null'] === 'string' ? step['on-null'] : undefined}
            position="wait"
            scope={scope}
            onChange={(filter, onNull) => {
              change({ filter, 'on-null': onNull }, 'filter');
            }}
          />
        </>
      )}
    </div>
  );
}

interface Route {
  readonly key: string;
  readonly label: string;
  readonly condition?: unknown;
  readonly 'on-null'?: string;
}

function RouteForms({ step, definition, scope, apply }: StepFormProps) {
  const routes = (Array.isArray(step.routes) ? step.routes : []).filter(
    (route): route is Route => isRecord(route) && typeof route.key === 'string',
  );
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">
        Routes are tried in this order, and the first whose condition holds is taken; else is last.
      </p>
      {routes.map((route, index) => (
        <fieldset key={route.key} className="flex flex-col gap-2 rounded-md border border-line p-2">
          <legend className="px-1 text-sm font-semibold">
            Route {String(index + 1)}: {route.label}
          </legend>
          <RouteLabel
            route={route}
            onLabel={(label) => {
              apply(
                updateRoute(definition, step.id, route.key, { label }),
                `Renamed the route ${route.key}.`,
                `route:${step.id}:${route.key}:label`,
              );
            }}
          />
          <ConditionBuilder
            label={`Condition of the route ${route.label}`}
            condition={route.condition}
            onNull={route['on-null']}
            position="route"
            routes={routes}
            own={route.key}
            scope={scope}
            onChange={(condition, onNull) => {
              apply(
                updateRoute(definition, step.id, route.key, { condition, 'on-null': onNull }),
                `Changed the condition of the route ${route.label}.`,
                `route:${step.id}:${route.key}:condition`,
              );
            }}
          />
          <div
            role="group"
            aria-label={`Order of the route ${route.label}`}
            className="flex flex-wrap gap-2"
          >
            <Button
              variant="secondary"
              disabled={index === 0}
              onClick={() => {
                apply(
                  moveRoute(definition, step.id, route.key, 'up'),
                  `Moved the route ${route.label} up.`,
                );
              }}
            >
              Try {route.label} earlier
            </Button>
            <Button
              variant="secondary"
              disabled={index === routes.length - 1}
              onClick={() => {
                apply(
                  moveRoute(definition, step.id, route.key, 'down'),
                  `Moved the route ${route.label} down.`,
                );
              }}
            >
              Try {route.label} later
            </Button>
            <Button
              variant="secondary"
              disabled={routes.length === 1}
              onClick={() => {
                apply(
                  removeRoute(definition, step.id, route.key),
                  `Removed the route ${route.label}.`,
                );
              }}
            >
              Remove the route {route.label}
            </Button>
          </div>
        </fieldset>
      ))}
      <ContinueOnError step={step} definition={definition} apply={apply} />
    </div>
  );
}

function RouteLabel({
  route,
  onLabel,
}: {
  readonly route: Route;
  readonly onLabel: (label: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        Label
      </label>
      <input
        id={id}
        defaultValue={route.label}
        maxLength={80}
        onChange={(event) => {
          const label = event.currentTarget.value.trim();
          if (label !== '') {
            onLabel(label);
          }
        }}
        className={CONTROL}
      />
    </div>
  );
}

/**
 * R005 (C113.2, C114.6): a loop's own settings: the list a for-each or map loop runs over, and a
 * while loop's condition with its on-null (error or stop, no default) and its bound. The body and
 * its back-edge are edited from the outline.
 */
function LoopForm({ step, definition, scope, apply }: StepFormProps) {
  const id = useId();
  const change = (patch: Readonly<Record<string, unknown>>, name: string) => {
    apply(
      updateStep(definition, step.id, patch),
      `Changed ${name} of ${step.name}.`,
      `loop:${step.id}:${name}`,
    );
  };
  if (step.mode !== 'while') {
    return (
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-items`} className="text-sm font-medium">
          List to loop over
        </label>
        <input
          id={`${id}-items`}
          defaultValue={typeof step.items === 'string' ? step.items : ''}
          aria-describedby={`${id}-items-hint`}
          onChange={(event) => {
            const items = event.currentTarget.value.trim();
            if (items !== '') {
              change({ items }, 'the list');
            }
          }}
          className={`${CONTROL} font-mono`}
        />
        <p id={`${id}-items-hint`} className="text-sm">
          A path to a list, such as trigger.items; the check refuses a path that is not one.
        </p>
      </div>
    );
  }
  const most = typeof step['max-iterations'] === 'number' ? step['max-iterations'] : 10;
  return (
    <div className="flex flex-col gap-3">
      <ConditionBuilder
        label={`Condition of ${step.name}`}
        // `false` is the new loop's "never": the builder starts with no comparison.
        condition={step.condition === false ? undefined : step.condition}
        onNull={typeof step['on-null'] === 'string' ? step['on-null'] : undefined}
        position="while"
        scope={scope}
        onChange={(condition, onNull) => {
          change({ condition: condition ?? false, 'on-null': onNull }, 'the condition');
        }}
      />
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-most`} className="text-sm font-medium">
          Most times the body runs
        </label>
        <input
          id={`${id}-most`}
          type="number"
          min={1}
          step={1}
          defaultValue={String(most)}
          onChange={(event) => {
            const value = Number(event.currentTarget.value);
            if (Number.isInteger(value) && value >= 1) {
              change({ 'max-iterations': value }, 'the bound');
            }
          }}
          className={`${CONTROL} w-32`}
        />
      </div>
    </div>
  );
}

/** The form of a step's own settings; the name and ports stay in the settings panel. */
export function StepForm(props: StepFormProps) {
  switch (props.step.type) {
    case 'action':
      return <ActionForm {...props} />;
    case 'wait':
      return <WaitForm {...props} />;
    case 'conditional':
      return <RouteForms {...props} />;
    case 'loop':
      return <LoopForm {...props} />;
    default:
      return <p className="text-sm">Edit this step’s other settings in the definition.</p>;
  }
}
