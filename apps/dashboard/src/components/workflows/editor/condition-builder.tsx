'use client';

/**
 * The condition builder (C114, C141.4): comparisons in groups, every comparison of a group holding
 * (AND) and any group holding (OR), written in our dialect as each control changes. A value that can
 * be unknown (null) is never offered "is not", and once a comparison reads one, the condition says
 * what happens then through its on-null choice, which has no default (C114.6): until it is chosen
 * the builder says so and the API's check refuses it (`on_null_missing`). A personal-data path is
 * never offered for a comparison with typed text (C114.5). A condition the builder did not write is
 * left to the definition.
 */
import { Button } from '@openverify/ui';
import { useId, useState } from 'react';
import {
  PREDICATE_ON_NULL_CHOICES,
  PREDICATE_ON_NULL_WORDS,
  clauseProblem,
  onNullChoicesOf,
  operatorsFor,
  operatorWords,
  readCondition,
  readsNullable,
  writeCondition,
  type Clause,
  type ClauseOperator,
  type ConditionGroups,
  type ConditionPosition,
} from './condition-model';
import { pathMarks } from './variable-picker';
import type { ScopePath } from './variable-scope';

/** `value` without its member `member` (a member left out, never set to undefined). */
function without<Value extends object>(value: Value, member: string): Value {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== member)) as Value;
}

export interface ConditionBuilderProps {
  /** Names the builder: "Condition of the route High". */
  readonly label: string;
  readonly condition: unknown;
  readonly onNull: string | undefined;
  readonly position: ConditionPosition;
  /** A conditional's routes, for a route's on-null choices. */
  readonly routes?: readonly { readonly key: string; readonly label: string }[];
  /** The route this condition belongs to, never its own on-null target. */
  readonly own?: string;
  readonly scope: readonly ScopePath[];
  readonly onChange: (condition: unknown, onNull: string | undefined) => void;
}

const CONTROL =
  'min-h-11 rounded-md border border-control bg-surface px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

function defaultValue(path: ScopePath): unknown {
  switch (path.type) {
    case 'number':
    case 'integer':
      return 0;
    case 'boolean':
      return true;
    case 'enum':
      return path.options[0] ?? '';
    default:
      return '';
  }
}

function ValueControl({
  id,
  label,
  path,
  value,
  onValue,
}: {
  readonly id: string;
  readonly label: string;
  readonly path: ScopePath;
  readonly value: unknown;
  readonly onValue: (value: unknown) => void;
}) {
  if (path.type === 'boolean' || path.type === 'enum') {
    const options = path.type === 'boolean' ? ['true', 'false'] : path.options;
    return (
      <select
        id={id}
        aria-label={label}
        value={String(value)}
        onChange={(event) => {
          const text = event.currentTarget.value;
          onValue(path.type === 'boolean' ? text === 'true' : text);
        }}
        className={CONTROL}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {path.type === 'boolean' ? (option === 'true' ? 'Yes (true)' : 'No (false)') : option}
          </option>
        ))}
      </select>
    );
  }
  const numeric = path.type === 'number' || path.type === 'integer';
  return (
    <input
      id={id}
      aria-label={label}
      inputMode={numeric ? 'decimal' : undefined}
      defaultValue={String(value)}
      onChange={(event) => {
        const text = event.currentTarget.value;
        const number = Number(text);
        onValue(numeric && text.trim() !== '' && Number.isFinite(number) ? number : text);
      }}
      className={CONTROL}
    />
  );
}

export function ConditionBuilder({
  label,
  condition,
  onNull,
  position,
  routes = [],
  own = '',
  scope,
  onChange,
}: ConditionBuilderProps) {
  const id = useId();
  const read = readCondition(condition);
  const [groups, setGroups] = useState<ConditionGroups>(read ?? []);
  const comparable = scope.filter((path) => operatorsFor(path).length > 0);
  const byPath = new Map(scope.map((path) => [path.path, path]));

  if (read === null) {
    return (
      <section aria-label={label} className="flex flex-col gap-1 text-sm">
        <h4 className="font-medium">{label}</h4>
        <p>This condition was written in the definition, and the builder does not edit it there.</p>
      </section>
    );
  }

  const commit = (next: ConditionGroups, nextOnNull = onNull) => {
    setGroups(next);
    const nullable = readsNullable(next, scope);
    onChange(writeCondition(next), nullable ? nextOnNull : undefined);
  };

  const newClause = (): Clause | null => {
    const [first] = comparable;
    if (first === undefined) {
      return null;
    }
    const [operator = 'is'] = operatorsFor(first);
    return { path: first.path, operator, value: defaultValue(first) };
  };

  const change = (groupIndex: number, clauseIndex: number, clause: Clause | null) => {
    commit(
      groups
        .map((group, index) =>
          index === groupIndex
            ? group.flatMap((item, at) =>
                at === clauseIndex ? (clause === null ? [] : [clause]) : [item],
              )
            : group,
        )
        .filter((group) => group.length > 0),
    );
  };

  const nullable = readsNullable(groups, scope);
  const choices = onNullChoicesOf(position, routes, own);

  return (
    <section aria-label={label} className="flex flex-col gap-3 text-sm">
      <h4 className="font-medium">{label}</h4>
      {groups.length === 0 && (
        <p>
          {position === 'route'
            ? 'No condition: this route is taken whenever it is tried.'
            : 'No condition.'}
        </p>
      )}
      {groups.map((group, groupIndex) => (
        <fieldset
          key={groupIndex}
          className="flex flex-col gap-2 rounded-md border border-line p-2"
        >
          <legend className="px-1 font-medium">
            {groupIndex === 0 ? 'All of these hold' : 'Or all of these hold'}
          </legend>
          {group.map((clause, clauseIndex) => {
            const path = byPath.get(clause.path);
            const at = `${id}-${String(groupIndex)}-${String(clauseIndex)}`;
            const name = `comparison ${String(clauseIndex + 1)} of group ${String(groupIndex + 1)}`;
            const problem = clauseProblem(clause, path);
            const operators: readonly ClauseOperator[] =
              path === undefined ? [] : operatorsFor(path);
            return (
              <div key={clauseIndex} className="flex flex-wrap items-center gap-2">
                <select
                  aria-label={`Path of ${name}`}
                  value={clause.path}
                  onChange={(event) => {
                    const next = byPath.get(event.currentTarget.value);
                    if (next !== undefined) {
                      const [operator = 'is'] = operatorsFor(next);
                      change(groupIndex, clauseIndex, {
                        path: next.path,
                        operator,
                        value: defaultValue(next),
                      });
                    }
                  }}
                  className={CONTROL}
                >
                  {path === undefined && <option value={clause.path}>{clause.path}</option>}
                  {comparable.map((candidate) => (
                    <option key={candidate.path} value={candidate.path}>
                      {candidate.path} ({pathMarks(candidate)})
                    </option>
                  ))}
                </select>
                <select
                  aria-label={`Comparison of ${name}`}
                  value={clause.operator}
                  onChange={(event) => {
                    change(groupIndex, clauseIndex, {
                      ...clause,
                      operator: event.currentTarget.value as ClauseOperator,
                    });
                  }}
                  className={CONTROL}
                >
                  {operators.map((operator) => (
                    <option key={operator} value={operator}>
                      {operatorWords(operator)}
                    </option>
                  ))}
                </select>
                {path !== undefined && clause.operator !== 'is-null' && (
                  <ValueControl
                    id={`${at}-value`}
                    label={`Value of ${name}`}
                    path={path}
                    value={clause.value}
                    onValue={(value) => {
                      change(groupIndex, clauseIndex, { ...clause, value });
                    }}
                  />
                )}
                {(clause.operator === 'any-is' ||
                  clause.operator === 'all-are' ||
                  clause.operator === 'none-is') && (
                  <select
                    aria-label={`When an element of ${name} cannot be read`}
                    value={clause.predicateOnNull ?? ''}
                    onChange={(event) => {
                      const rest = without(clause, 'predicateOnNull');
                      const value = event.currentTarget.value;
                      change(
                        groupIndex,
                        clauseIndex,
                        value === '' ? rest : { ...rest, predicateOnNull: value },
                      );
                    }}
                    className={CONTROL}
                  >
                    <option value="">Not chosen: the condition’s own on-null decides</option>
                    {PREDICATE_ON_NULL_CHOICES.map((choice) => (
                      <option key={choice} value={choice}>
                        {PREDICATE_ON_NULL_WORDS[choice] ?? choice}
                      </option>
                    ))}
                  </select>
                )}
                <Button
                  variant="secondary"
                  onClick={() => {
                    change(groupIndex, clauseIndex, null);
                  }}
                >
                  Remove {name}
                </Button>
                {problem !== null && <p className="w-full font-medium">{problem}</p>}
              </div>
            );
          })}
          <div>
            <Button
              variant="secondary"
              onClick={() => {
                const clause = newClause();
                if (clause !== null) {
                  commit(
                    groups.map((item, index) => (index === groupIndex ? [...item, clause] : item)),
                  );
                }
              }}
            >
              Add a comparison to group {String(groupIndex + 1)}
            </Button>
          </div>
        </fieldset>
      ))}
      {comparable.length === 0 ? (
        <p>
          No path in scope here can be compared; personal data is never compared with typed text.
        </p>
      ) : (
        <div>
          <Button
            variant="secondary"
            onClick={() => {
              const clause = newClause();
              if (clause !== null) {
                commit([...groups, [clause]]);
              }
            }}
          >
            {groups.length === 0 ? 'Add a comparison' : 'Add an “or” group'}
          </Button>
        </div>
      )}
      {nullable && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-on-null`} className="font-medium">
            When a value it reads is unknown (null)
          </label>
          <select
            id={`${id}-on-null`}
            value={onNull ?? ''}
            aria-describedby={`${id}-on-null-help`}
            onChange={(event) => {
              const value = event.currentTarget.value;
              commit(groups, value === '' ? undefined : value);
            }}
            className={CONTROL}
          >
            <option value="">Choose what happens</option>
            {choices.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
          <p id={`${id}-on-null-help`}>
            {onNull === undefined
              ? 'Not chosen yet: there is no default, and the check refuses the condition until you choose (on_null_missing).'
              : 'An unknown value is never read as false.'}
          </p>
        </div>
      )}
    </section>
  );
}
