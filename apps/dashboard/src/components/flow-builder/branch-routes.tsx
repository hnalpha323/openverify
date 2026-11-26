'use client';

/**
 * A branch's routes in the builder (C150, C155.5's Logic for branches): each route's condition with
 * the shared condition builder (8D's, one path against one literal, AND groups, OR between groups,
 * a nullable path offered only "is" and "is unknown"), the flow's own on-null choices with no
 * default (C150.3), every fact the routes read with its type, source, tier and stage (C150.8,
 * C150.10), and, where an author would look for them, why no `lists.*` path and no signal outside
 * the flow-provisional ones is offered (C150.2, C150.9).
 */
import {
  FLOW_V2_CAPS,
  type BranchStep,
  type FlowProblem,
  type FlowV2,
} from '@openverify/flow-spec';
import { useId, useState } from 'react';
import { FLOW_BUILDER_COPY } from '../../lib/copy/flow-builder';
import { ConditionBuilder } from '../workflows/editor/condition-builder';
import { onNullChoicesOf, readCondition } from '../workflows/editor/condition-model';
import { pathMarks } from '../workflows/editor/variable-picker';
import { FLOW_ADAPTER, type FlowAdapterContext } from './flow-adapter';
import { updateFlowStep } from './flow-model';

const copy = FLOW_BUILDER_COPY.branch;
const warningWords = FLOW_BUILDER_COPY.branchWarnings;
const waitWords = FLOW_BUILDER_COPY.wait;

/** `value` without its member `member` (a member left out, never set to undefined). */
function without<Value extends object>(value: Value, member: string): Value {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== member)) as Value;
}

/** A new wait's length (provisional, ours): two of the session's 2-second polls and a margin. */
const FIRST_WAIT_SECONDS = 5;

export function BranchRoutes({
  flow,
  step,
  editable,
  problems = [],
  context = {},
  onApply,
}: {
  readonly flow: FlowV2;
  readonly step: BranchStep;
  readonly editable: boolean;
  /** The format's problems of the whole flow (`checkFlowGraph`), the branch's warnings among them. */
  readonly problems?: readonly FlowProblem[];
  /** What the scope reads besides the flow: the version's field schemas (C149, C150.2). */
  readonly context?: FlowAdapterContext;
  readonly onApply: (flow: FlowV2, message: string) => void;
}) {
  const scope = FLOW_ADAPTER.conditionScope(flow, step.id, context);
  const byPath = new Map(scope.map((path) => [path.path, path]));
  const read = [
    ...new Set(
      step.routes.flatMap((route) =>
        (readCondition(route.condition) ?? []).flatMap((group) =>
          group.map((clause) => clause.path),
        ),
      ),
    ),
  ];
  return (
    <div className="flex flex-col gap-4">
      {step.routes.map((route) => (
        <fieldset key={route.key} disabled={!editable} className="flex flex-col gap-2">
          <ConditionBuilder
            label={copy.condition(route.label)}
            // A new route's `{}` is "no comparison yet", which the builder writes back as `{}`.
            condition={Object.keys(route.condition).length === 0 ? undefined : route.condition}
            onNull={route.onNull}
            position="flow-route"
            routes={step.routes.map((other) => ({ key: other.key, label: other.label }))}
            own={route.key}
            scope={scope}
            onChange={(condition, onNull) => {
              const routes = step.routes.map((other) =>
                other.key === route.key
                  ? {
                      key: other.key,
                      label: other.label,
                      condition: (condition ?? {}) as Record<string, unknown>,
                      ...(onNull === undefined ? {} : { onNull }),
                    }
                  : other,
              );
              onApply(updateFlowStep(flow, { ...step, routes }), copy.changed(route.label));
            }}
          />
        </fieldset>
      ))}
      <section className="flex flex-col gap-1 text-sm">
        <ul aria-label={copy.facts} className="list-disc ps-5">
          {read.length === 0 ? (
            <li>{copy.noFacts}</li>
          ) : (
            read.map((path) => {
              const described = byPath.get(path);
              return (
                <li key={path}>
                  <code className="font-mono text-xs">{path}</code>
                  {described === undefined ? ` (${copy.unknownPath})` : `: ${pathMarks(described)}`}
                </li>
              );
            })
          )}
        </ul>
        <p>{copy.absent}</p>
      </section>
      <BranchWarnings flow={flow} step={step} problems={problems} />
      <BranchWait
        flow={flow}
        step={step}
        editable={editable}
        read={read}
        scope={scope}
        onApply={onApply}
      />
    </div>
  );
}

/**
 * C150.9, C150.11: the warnings `checkFlowGraph` (the code the API runs) reports at this branch, in
 * words; they never count as the step's errors (FB-9).
 */
function BranchWarnings({
  flow,
  step,
  problems,
}: {
  readonly flow: FlowV2;
  readonly step: BranchStep;
  readonly problems: readonly FlowProblem[];
}) {
  const index = flow.steps.findIndex((each) => each.id === step.id);
  const own = problems.filter(
    (problem) =>
      problem.severity === 'warning' &&
      new RegExp(`^/steps/${String(index)}(?:/|$)`).test(problem.pointer),
  );
  if (own.length === 0) {
    return null;
  }
  const words = (problem: FlowProblem): string => {
    if (problem.code === 'client_signal_before_screen') {
      return warningWords.client_signal_before_screen;
    }
    if (problem.code === 'tipping_off_route') {
      const route = /\/routes\/(\d+)/.exec(problem.pointer);
      const label = route === null ? undefined : step.routes[Number(route[1])]?.label;
      return warningWords.tipping_off_route(label === undefined ? 'A route' : `Route ${label}`);
    }
    return warningWords.other(problem.detail);
  };
  return (
    <section className="flex flex-col gap-1 text-sm">
      <ul aria-label={warningWords.heading} className="flex flex-col gap-1">
        {own.map((problem, at) => (
          <li key={`${String(at)}:${problem.code}`}>
            <span aria-hidden="true">ℹ </span>
            Warning: {words(problem)}
          </li>
        ))}
      </ul>
      <p>{warningWords.note}</p>
    </section>
  );
}

/**
 * C150.5, C150.9: the branch's `waitFor` edited in place: the facts that can be unknown here (the
 * nullable facts the routes read and the flow-provisional signals), the longest wait within the
 * contract's bounds, and what a value still unknown after it does (each route's onNull).
 */
function BranchWait({
  flow,
  step,
  editable,
  read,
  scope,
  onApply,
}: {
  readonly flow: FlowV2;
  readonly step: BranchStep;
  readonly editable: boolean;
  readonly read: readonly string[];
  readonly scope: readonly { readonly path: string; readonly nullable: boolean }[];
  readonly onApply: (flow: FlowV2, message: string) => void;
}) {
  const id = useId();
  const cap = FLOW_V2_CAPS.waitMaxSeconds;
  const waited = step.waitFor?.facts ?? [];
  const nullable = new Set(scope.filter((path) => path.nullable).map((path) => path.path));
  const candidates = [
    ...new Set([
      ...waited,
      ...read.filter((path) => nullable.has(path)),
      ...scope
        .filter((path) => path.nullable && path.path.startsWith('signals.'))
        .map((path) => path.path),
    ]),
  ];
  const [secondsText, setSecondsText] = useState(String(step.waitFor?.maxSeconds ?? ''));
  const [refused, setRefused] = useState(false);
  const notWaited = read.filter((path) => path.startsWith('signals.') && !waited.includes(path));
  const routes = step.routes.map((route) => ({ key: route.key, label: route.label }));

  const write = (facts: readonly string[], seconds: number, message: string) => {
    const rest = without(step, 'waitFor');
    onApply(
      updateFlowStep(
        flow,
        facts.length === 0
          ? rest
          : { ...rest, waitFor: { facts: [...facts], maxSeconds: seconds } },
      ),
      message,
    );
  };

  return (
    <fieldset
      disabled={!editable}
      aria-describedby={`${id}-description`}
      className="flex flex-col gap-2 rounded-md border border-line p-2 text-sm"
    >
      <legend className="px-1 font-medium">{waitWords.legend}</legend>
      <p id={`${id}-description`}>{waitWords.description}</p>
      {candidates.length === 0 ? (
        <p>{waitWords.none}</p>
      ) : (
        candidates.map((path) => (
          <label key={path} className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={waited.includes(path)}
              onChange={(event) => {
                const on = event.currentTarget.checked;
                const facts = on ? [...waited, path] : waited.filter((fact) => fact !== path);
                const seconds = step.waitFor?.maxSeconds ?? FIRST_WAIT_SECONDS;
                if (on && step.waitFor === undefined) {
                  setSecondsText(String(seconds));
                }
                write(facts, seconds, on ? waitWords.added(path) : waitWords.removed(path));
              }}
              className="size-6"
            />
            <code className="font-mono text-xs">{path}</code>
          </label>
        ))
      )}
      {notWaited.length > 0 && <p>{waitWords.notWaited(notWaited.join(', '))}</p>}
      {step.waitFor !== undefined && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-seconds`} className="font-medium">
            {waitWords.seconds}
          </label>
          <input
            id={`${id}-seconds`}
            type="number"
            min={1}
            max={cap}
            step={1}
            value={secondsText}
            aria-describedby={`${id}-seconds-hint`}
            aria-invalid={refused || undefined}
            onChange={(event) => {
              const text = event.currentTarget.value;
              setSecondsText(text);
              const seconds = Number(text);
              const valid = Number.isInteger(seconds) && seconds >= 1 && seconds <= cap;
              setRefused(!valid);
              if (valid) {
                write(waited, seconds, waitWords.secondsChanged(seconds));
              }
            }}
            className="min-h-11 w-32 rounded-md border border-control px-3"
          />
          <p id={`${id}-seconds-hint`}>
            {refused ? waitWords.secondsRefused(cap) : waitWords.secondsHint(cap)}
          </p>
          <ul aria-label={waitWords.after} className="list-disc ps-5">
            {step.routes.map((route) => {
              const choice = onNullChoicesOf('flow-route', routes, route.key).find(
                (each) => each.value === route.onNull,
              );
              return (
                <li key={route.key}>
                  {waitWords.routeOnNull(route.label, choice?.label ?? waitWords.noOnNull)}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </fieldset>
  );
}
