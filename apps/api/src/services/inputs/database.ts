/**
 * C52.3, C50.3: what a database step asks of the entered values. The body names a step field
 * with hyphens (`name_first` is `name-first`); a body may carry only the members its step
 * collects, and must carry its required ones: the step's `requiredFields`, and always the name and
 * the country (`DATABASE_REQUIRED_FIELDS`, which every database step collects), without which no
 * source can be asked (C59.1).
 */
import { DATABASE_REQUIRED_FIELDS, type DatabaseField, type FlowStep } from '@openverify/flow-spec';
import { inputError, isEntered, type InputRule } from './rules.js';

type DatabaseStep = Extract<FlowStep, { type: 'database' }>;

/** The body member of a step field (C52.3). */
export const inputNameOf = (field: DatabaseField): string => field.replaceAll('_', '-');

/** The members a database step collects, in its order. */
export function databaseCollectedInputs(step: DatabaseStep): string[] {
  return step.fields.map(inputNameOf);
}

/** The members a database body must carry, in the step's order. */
export function databaseRequiredInputs(step: DatabaseStep): string[] {
  const required = new Set<DatabaseField>([
    ...DATABASE_REQUIRED_FIELDS,
    ...(step.requiredFields ?? []),
  ]);
  return step.fields.filter((field) => required.has(field)).map(inputNameOf);
}

/** C52.3: a database body may carry only the members its step collects, and its required ones. */
export const databaseInputRule: InputRule = {
  refusals({ step, values }) {
    if (step.type !== 'database') {
      return [];
    }
    const collected = new Set(databaseCollectedInputs(step));
    const refused = Object.keys(values)
      .filter((name) => !collected.has(name))
      .map((name) => inputError(name, 'is not collected by this step'));
    const missing = databaseRequiredInputs(step)
      .filter((name) => !isEntered(values[name]))
      .map((name) => inputError(name, 'is required'));
    return [...refused, ...missing];
  },
};
