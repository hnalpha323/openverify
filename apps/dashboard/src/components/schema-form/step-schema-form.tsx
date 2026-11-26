'use client';

/**
 * A flow step's settings as a form generated from its own zod schema (C153.1, C155.3): every
 * member of the step type's `stepV2Schema` option but its `id` and `type`, through `SchemaForm`,
 * with the capture methods ticked and `captureMethodsByDevice` per device class as client-reported
 * guidance (C153.2). The whole step is judged by its schema, its own refinements included. The
 * builder mounts it in the selected step's panel and records each change as one undoable edit.
 */
import {
  CAPTURE_METHODS,
  DEVICE_KINDS,
  stepV2Schema,
  type FlowV2Step,
  type FlowV2StepType,
} from '@openverify/flow-spec';
import { useMemo, type ReactNode } from 'react';
import { z } from 'zod';
import { TEMPLATE_FORMS_COPY } from '../../lib/copy/template-forms';
import { captureMethodsByDeviceWidgetOf, enumSetWidgetOf } from './enum-set-widgets';
import { problemsOf } from './model';
import { SchemaForm, type SchemaWidget } from './schema-form';

const COPY = TEMPLATE_FORMS_COPY.stepForm;

const OPTIONS: ReadonlyMap<string, z.ZodType> = new Map(
  stepV2Schema.options.map((option) => [option.shape.type.value, option as z.ZodType]),
);
const MEMBER_SCHEMAS = new Map<string, z.ZodType>(
  stepV2Schema.options.map((option) => [
    option.shape.type.value,
    z.strictObject(
      Object.fromEntries(
        Object.entries(option.shape as Record<string, z.ZodType>).filter(
          ([name]) => name !== 'id' && name !== 'type',
        ),
      ),
    ),
  ]),
);

/** The schema of a step type's members a person edits: all but `id` and `type`. */
export function stepMemberSchema(type: FlowV2StepType): z.ZodType {
  const schema = MEMBER_SCHEMAS.get(type);
  if (schema === undefined) {
    throw new TypeError(`no step type ${type}`);
  }
  return schema;
}

const WIDGETS: Readonly<Record<string, SchemaWidget>> = {
  captureMethods: enumSetWidgetOf(CAPTURE_METHODS),
  captureMethodsByDevice: captureMethodsByDeviceWidgetOf(DEVICE_KINDS, CAPTURE_METHODS),
};
const NOTES = { captureMethodsByDevice: COPY.captureByDevice };

export interface StepSchemaFormProps {
  readonly step: FlowV2Step;
  /** A draft, and `inquiry-templates:write`. */
  readonly editable: boolean;
  /** The changed step: one undoable edit, with `message` to announce. */
  readonly onStepChange: (next: FlowV2Step, message: string) => void;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function StepSchemaForm({ step, editable, onStepChange }: StepSchemaFormProps): ReactNode {
  const { id, type, ...members } = step;
  const schema = stepMemberSchema(type);
  const memberProblems = useMemo(() => problemsOf(schema, members), [schema, members]);
  // The step's own refinements, which its members' schema alone does not hold.
  const stepProblems = problemsOf(OPTIONS.get(type) ?? schema, step).filter(
    (problem) =>
      !memberProblems.some(
        (other) => other.pointer === problem.pointer && other.detail === problem.detail,
      ),
  );
  return (
    <SchemaForm
      legend={COPY.legend(id)}
      schema={schema}
      value={members}
      widgets={WIDGETS}
      notes={NOTES}
      errors={stepProblems}
      readOnly={!editable}
      onChange={(next) => {
        const changed =
          [...new Set([...Object.keys(members), ...Object.keys(next)])].find(
            (name) => !same((members as Readonly<Record<string, unknown>>)[name], next[name]),
          ) ?? id;
        onStepChange({ ...next, id, type } as FlowV2Step, COPY.announce(id, changed));
      }}
    />
  );
}
