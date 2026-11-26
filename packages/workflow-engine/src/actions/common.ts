/**
 * What the action contracts share (C115, C122, C128). A config is parsed twice: at publish against
 * the stored step, where a string leaf can still be a `{{ path }}`, and at run time after rendering.
 * So a member a template can fill is a bounded string here and is read for what it holds only at the
 * sink, and a member that decides a grant or a gate is a literal (C121.2, C128.3).
 *
 * `plain` and `personal` are the two PII marks of an output member (C120.6): there is no third, and
 * `createActionRegistry` refuses a member with neither.
 */
import { biometricBasisSchema, decisionBasisSchema } from '@openverify/core';
import {
  contestRouteSchema,
  decisionCommentSchema,
  workflowJsonSchema,
} from '@openverify/contracts';
import { z } from 'zod';

const KIB = 1024;

export const provisional = (value: number, source: string) =>
  Object.freeze({ value, basis: 'provisional' as const, source });

/** C115.2: a template's own cap. */
export const ACTION_TEMPLATE_BYTES = 32 * KIB;

/** A value a template fills: a path, an id or a literal. */
export const actionReferenceSchema = z.string().min(1).max(512);

/** Text a template fills, capped by the sink again on the rendered value (C115.2). */
export const actionTemplateSchema = z.string().min(1).max(ACTION_TEMPLATE_BYTES);

/** A member that takes any JSON value, whose string leaves are templates (C115.1). */
export const actionValueSchema = workflowJsonSchema;

/** A map of template values: `fields`, `inputs`. */
export const actionValueMapSchema = z.record(
  z.string().regex(/^[A-Z][\w.-]{0,127}$/i, 'must be a name'),
  actionValueSchema,
);

export const plain = <Schema extends z.ZodType>(schema: Schema) => schema.meta({ pii: false });
export const personal = <Schema extends z.ZodType>(schema: Schema) => schema.meta({ pii: true });

/** The C127 answers: done, already so by anyone, or another actor decided otherwise first. */
export const ACTION_OUTCOMES = ['applied', 'no_change', 'already_decided'] as const;
export const actionOutcomeSchema = z.enum(ACTION_OUTCOMES);
export type ActionOutcome = z.infer<typeof actionOutcomeSchema>;

/** A decision's id on an output; `null` when the step made no decision (C127.1). */
export const decisionIdSchema = z
  .string()
  .regex(/^idec_/, 'must be a decision id')
  .nullable();

/** C127.1: sealed in the decision record, never in audit metadata. */
export const decisionCommentTemplateSchema = decisionCommentSchema;

/**
 * C128.3, C128.4: what an adverse step declares. Optional here, because a sandbox publishes with a
 * warning; publish in production and the run-time gate read them. They are literals: a basis written
 * by a template would be chosen by a value, not by the operator.
 */
export const adverseConfigShape = {
  'decision-basis': decisionBasisSchema.optional(),
  'contest-route': contestRouteSchema.optional(),
  'biometric-basis': biometricBasisSchema.optional(),
};

/**
 * C127.1: a step that changed nothing made no decision, so its output names none. Only a step that
 * performed the transition holds a decision id.
 */
export const decisionFollowsOutcome = (value: {
  readonly outcome: ActionOutcome;
  readonly 'decision-id': string | null;
}): boolean => value.outcome === 'applied' || value['decision-id'] === null;
