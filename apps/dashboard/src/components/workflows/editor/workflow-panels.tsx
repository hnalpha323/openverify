'use client';

/**
 * The trigger, inputs, variables and outputs panels (C141.9, C118, C113.1, C115.3): what starts a
 * run and what it carries, each path listed with its type and its marks in words (can be unknown,
 * personal data). The trigger's criteria and a recurring trigger's filter are conditions with their
 * own on-null choices (C114.6). Every change is one undoable edit through the document model.
 */
import { isEventName, isTriggerableEvent } from '@openverify/contracts';
import { WORKFLOW_OBJECT_TYPES } from '@openverify/core';
import { Button } from '@openverify/ui';
import { useId, useState } from 'react';
import { ConditionBuilder } from './condition-builder';
import {
  setDeclarations,
  updateStep,
  updateTrigger,
  type DeclarationMember,
  type DraftDefinition,
} from './document-model';
import type { ApplyEdit } from './step-form';
import { PathList } from './variable-picker';
import { declaredPath, type ScopePath } from './variable-scope';

const CONTROL =
  'min-h-11 rounded-md border border-control bg-surface px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function Text({
  label,
  value,
  onText,
  hint,
}: {
  readonly label: string;
  readonly value: string;
  readonly onText: (text: string) => void;
  readonly hint?: string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        defaultValue={value}
        aria-describedby={hint === undefined ? undefined : `${id}-hint`}
        onChange={(event) => {
          onText(event.currentTarget.value);
        }}
        className={CONTROL}
      />
      {hint !== undefined && (
        <p id={`${id}-hint`} className="text-xs text-ink-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

function Check({
  label,
  checked,
  onCheck,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly onCheck: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <input
        id={id}
        type="checkbox"
        className="size-6"
        checked={checked}
        onChange={(event) => {
          onCheck(event.currentTarget.checked);
        }}
      />
      <label htmlFor={id} className="text-sm">
        {label}
      </label>
    </div>
  );
}

export interface TriggerPanelProps {
  readonly definition: DraftDefinition;
  readonly triggerPaths: readonly ScopePath[];
  readonly apply: ApplyEdit;
  readonly onChangeType: () => void;
}

const EVENT_TYPES = new Set(['trigger-event', 'trigger-verification']);

export function TriggerPanel({ definition, triggerPaths, apply, onChangeType }: TriggerPanelProps) {
  const id = useId();
  const { trigger } = definition;
  const [unknown, setUnknown] = useState<readonly string[]>([]);
  if (trigger === null) {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <p>No trigger yet.</p>
        <div>
          <Button variant="secondary" onClick={onChangeType}>
            Set the trigger…
          </Button>
        </div>
      </div>
    );
  }
  const { config } = trigger;
  const change = (patch: Readonly<Record<string, unknown>>, name: string, options = {}) => {
    apply(
      updateTrigger(definition, options, patch),
      `Changed the trigger’s ${name}.`,
      `trigger:${name}`,
    );
  };
  const condition = trigger.type === 'trigger-recurring' ? 'filter' : 'criteria';
  const events = Array.isArray(config.events) ? config.events.map(String) : [];
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button variant="secondary" onClick={onChangeType}>
          Change the trigger…
        </Button>
      </div>
      {EVENT_TYPES.has(trigger.type) && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-events`} className="text-sm font-medium">
            Events, one per line
          </label>
          <textarea
            id={`${id}-events`}
            defaultValue={events.join('\n')}
            rows={3}
            aria-describedby={`${id}-events-help`}
            onChange={(event) => {
              const names = event.currentTarget.value
                .split('\n')
                .map((line) => line.trim())
                .filter((line) => line !== '');
              const refused = names.filter(
                (name) => !isEventName(name) || !isTriggerableEvent(name),
              );
              setUnknown(refused);
              if (refused.length === 0 && names.length > 0) {
                change({ events: names }, 'events');
              }
            }}
            className={`${CONTROL} py-2 font-mono`}
          />
          <p id={`${id}-events-help`} className="text-sm">
            {unknown.length === 0
              ? 'A run’s own events and publish events never start a workflow.'
              : `Not an event a workflow can listen to, so not applied: ${unknown.join(', ')}.`}
          </p>
        </div>
      )}
      {trigger.type === 'trigger-recurring' && (
        <>
          <Text
            label="Every how many minutes"
            value={
              typeof config['every-minutes'] === 'number' ? String(config['every-minutes']) : ''
            }
            hint="A whole number of minutes; leave it empty to use a cron instead."
            onText={(text) => {
              const minutes = Number(text);
              change({ 'every-minutes': text.trim() === '' ? undefined : minutes }, 'interval');
            }}
          />
          <Text
            label="Cron (five fields)"
            value={typeof config.cron === 'string' ? config.cron : ''}
            hint="A cron or an interval, never both."
            onText={(text) => {
              change({ cron: text.trim() === '' ? undefined : text.trim() }, 'cron');
            }}
          />
          <Text
            label="Time zone (IANA)"
            value={typeof config['time-zone'] === 'string' ? config['time-zone'] : ''}
            onText={(text) => {
              change({ 'time-zone': text.trim() }, 'time zone');
            }}
          />
        </>
      )}
      {(trigger.type === 'trigger-recurring' || trigger.type === 'trigger-direct') && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-object`} className="text-sm font-medium">
            Object type
          </label>
          <select
            id={`${id}-object`}
            value={typeof config['object-type'] === 'string' ? config['object-type'] : ''}
            onChange={(event) => {
              change({ 'object-type': event.currentTarget.value }, 'object type');
            }}
            className={CONTROL}
          >
            {WORKFLOW_OBJECT_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>
      )}
      {(EVENT_TYPES.has(trigger.type) || trigger.type === 'trigger-recurring') && (
        <ConditionBuilder
          label={
            trigger.type === 'trigger-recurring'
              ? 'Filter of the trigger'
              : 'Criteria of the trigger'
          }
          condition={config[condition]}
          onNull={typeof config['on-null'] === 'string' ? config['on-null'] : undefined}
          position="trigger"
          scope={triggerPaths}
          onChange={(value, onNull) => {
            change({ [condition]: value, 'on-null': onNull }, condition);
          }}
        />
      )}
      <Check
        label="Allow a run to start this workflow again through its own events (allow-self-trigger)"
        checked={trigger['allow-self-trigger'] === true}
        onCheck={(checked) => {
          change({}, 'options', { 'allow-self-trigger': checked ? true : undefined });
        }}
      />
      <Check
        label="One run per subject at a time: later runs wait for the earlier one (one-run-per-subject)"
        checked={trigger['one-run-per-subject'] === true}
        onCheck={(checked) => {
          change({}, 'options', { 'one-run-per-subject': checked ? true : undefined });
        }}
      />
      <h4 className="text-sm font-semibold">Paths the trigger gives</h4>
      <PathList
        label="Paths of the trigger"
        paths={triggerPaths}
        empty="This trigger has no view of an object: its runs read the inputs."
      />
    </div>
  );
}

interface Declaration {
  readonly name: string;
  readonly type?: string;
  readonly required?: boolean;
  readonly pii?: boolean;
  readonly default?: unknown;
}

const NAME = /^[a-z][a-z0-9_]{0,79}$/;

const PREFIX: Readonly<Record<DeclarationMember, string>> = {
  inputs: 'inputs',
  variables: 'vars',
  outputs: 'outputs',
};

const SOURCE: Readonly<Record<DeclarationMember, string>> = {
  inputs: 'Input',
  variables: 'Variable',
  outputs: 'Output',
};

export interface DeclarationsPanelProps {
  readonly member: DeclarationMember;
  readonly definition: DraftDefinition;
  readonly apply: ApplyEdit;
}

/** The paths a declaration list gives, each with its marks. */
export function declarationPaths(member: DeclarationMember, list: readonly unknown[]): ScopePath[] {
  return list
    .filter(isRecord)
    .map((item) =>
      declaredPath(
        `${PREFIX[member]}.${String(item.name)}`,
        member === 'outputs' ? 'any' : String(item.type),
        SOURCE[member],
        { nullable: member === 'inputs' && item.required !== true, pii: item.pii === true },
      ),
    );
}

export function DeclarationsPanel({ member, definition, apply }: DeclarationsPanelProps) {
  const id = useId();
  const list = definition[member].filter(
    (item): item is Declaration => isRecord(item) && typeof item.name === 'string',
  );
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const word = SOURCE[member].toLowerCase();
  const output = definition.steps.find((step) => step.type === 'output');
  const mappings = isRecord(output?.mappings) ? output.mappings : {};

  const replace = (next: readonly Declaration[], message: string, gesture?: string) => {
    apply(setDeclarations(definition, member, next), message, gesture);
  };
  const edit = (
    index: number,
    patch: Readonly<Record<string, unknown>>,
    message: string,
    gesture?: string,
  ) => {
    replace(
      list.map((item, at) =>
        at === index
          ? (Object.fromEntries(
              Object.entries({ ...item, ...patch }).filter(([, value]) => value !== undefined),
            ) as unknown as Declaration)
          : item,
      ),
      message,
      gesture,
    );
  };

  return (
    <div className="flex flex-col gap-3">
      {list.length === 0 && <p className="text-sm">No {word} declared.</p>}
      {list.map((item, index) => (
        <fieldset key={item.name} className="flex flex-col gap-2 rounded-md border border-line p-2">
          <legend className="px-1 text-sm font-semibold">
            <code className="font-mono text-xs">{`${PREFIX[member]}.${item.name}`}</code>
          </legend>
          {member !== 'outputs' && (
            <Text
              label={`Type of ${item.name}`}
              value={item.type ?? ''}
              hint="string, number, integer, boolean, datetime, id<prefix>, enum<a,b>, list<T> or object{…}; add “ pii” for personal data."
              onText={(type) => {
                edit(
                  index,
                  { type: type.trim() },
                  `Changed the type of ${item.name}.`,
                  `decl:${member}:${item.name}:type`,
                );
              }}
            />
          )}
          {member === 'inputs' && (
            <Check
              label={`${item.name} is required (otherwise it can be unknown)`}
              checked={item.required === true}
              onCheck={(required) => {
                edit(index, { required }, `Changed whether ${item.name} is required.`);
              }}
            />
          )}
          <Check
            label={`${item.name} is personal data`}
            checked={item.pii === true}
            onCheck={(pii) => {
              edit(
                index,
                member === 'outputs' ? { pii } : { pii: pii ? true : undefined },
                `Changed whether ${item.name} is personal data.`,
              );
            }}
          />
          {member === 'outputs' && output !== undefined && (
            <Text
              label={`Value of ${item.name}`}
              value={typeof mappings[item.name] === 'string' ? String(mappings[item.name]) : ''}
              hint="A path written {{ path }}, or a literal."
              onText={(text) => {
                apply(
                  updateStep(definition, output.id, {
                    mappings: { ...mappings, [item.name]: text === '' ? undefined : text },
                  }),
                  `Changed the value of the output ${item.name}.`,
                  `decl:outputs:${item.name}:value`,
                );
              }}
            />
          )}
          <div>
            <Button
              variant="secondary"
              onClick={() => {
                replace(
                  list.filter((_item, at) => at !== index),
                  `Removed the ${word} ${item.name}.`,
                );
              }}
            >
              Remove {item.name}
            </Button>
          </div>
        </fieldset>
      ))}
      <form
        aria-label={`Add ${word === 'input' ? 'an' : 'a'} ${word}`}
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const wanted = name.trim();
          if (!NAME.test(wanted) || list.some((item) => item.name === wanted)) {
            setProblem('A new name is lower-case letters, digits and _, starting with a letter.');
            return;
          }
          setProblem(null);
          setName('');
          const added: Declaration =
            member === 'outputs'
              ? { name: wanted, pii: false }
              : member === 'inputs'
                ? { name: wanted, type: 'string', required: true }
                : { name: wanted, type: 'string' };
          replace([...list, added], `Added the ${word} ${wanted}.`);
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-new`} className="text-sm font-medium">
            New {word} name
          </label>
          <input
            id={`${id}-new`}
            value={name}
            aria-describedby={problem === null ? undefined : `${id}-problem`}
            onChange={(event) => {
              setName(event.currentTarget.value);
            }}
            className={CONTROL}
          />
        </div>
        <Button type="submit" variant="secondary">
          Add
        </Button>
        {problem !== null && (
          <p id={`${id}-problem`} className="w-full text-sm font-medium">
            {problem}
          </p>
        )}
      </form>
      <PathList
        label={`Paths of the ${member}`}
        paths={declarationPaths(member, list)}
        empty={`No path: no ${word} declared.`}
      />
    </div>
  );
}
