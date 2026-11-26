/**
 * C52.3: what each form type asks of its entered values beyond its body schema (the step's
 * collected and required members, the business match groups), one module per type, and the
 * refusals they answer: a JSON Pointer into the body per member, never a value.
 */
import type { VerificationTemplateConfig } from '@openverify/core';
import type { FlowStep } from '@openverify/flow-spec';
import type { ProblemFieldError } from '../../errors.js';

/** What a type's rule reads. */
export interface InputRuleContext {
  /** The verification's step in the inquiry's pinned flow. */
  step: FlowStep;
  /** The type's configuration in the pinned version, if any. */
  config: VerificationTemplateConfig | undefined;
  /** The cleaned body. */
  values: Readonly<Record<string, unknown>>;
}

/** One type's rules beyond its body schema. */
export interface InputRule {
  /** Each member the step or the template refuses or requires. */
  refusals(ctx: InputRuleContext): ProblemFieldError[];
}

/** RFC 6901: a reference token with `~` and `/` escaped. */
const token = (segment: string | number): string =>
  String(segment).replaceAll('~', '~0').replaceAll('/', '~1');

/** A refusal of the body member at `path`. */
export function inputError(
  path: string | readonly (string | number)[],
  detail: string,
): ProblemFieldError {
  const segments = typeof path === 'string' ? [path] : path;
  return { location: 'body', pointer: `/${segments.map(token).join('/')}`, detail };
}

/** Whether a member carries a value (an emptied string does not). */
export const isEntered = (value: unknown): boolean =>
  value !== undefined && value !== null && value !== '';

/** A type with no rule beyond its body schema. */
export const NO_INPUT_RULES: InputRule = { refusals: () => [] };
