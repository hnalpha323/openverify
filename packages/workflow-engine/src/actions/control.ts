/**
 * C115.4, C127.10, C119.9, C118.3: compute and control. These run in the interpreter, or start other
 * runs. A computed value is marked PII, because an operand can be (C115.6): the mark is what a reader
 * without PII visibility is held to, and the taint rules run at publish.
 */
import { WORKFLOW_RUN_STATUSES } from '@openverify/core';
import { workflowDeclaredNameSchema, workflowModuleVersionSchema } from '@openverify/contracts';
import { z } from 'zod';
import {
  actionReferenceSchema,
  actionValueMapSchema,
  actionValueSchema,
  personal,
  plain,
} from './common.js';

/** C127.10: the public operators. */
export const CALCULATE_OPERATORS = ['add', 'subtract', 'multiply', 'divide', 'sum', 'avg'] as const;

/** Why `default` was used (H21). */
export const CALCULATE_DEFAULT_REASONS = [
  'divide_by_zero',
  'operand_not_a_number',
  'operand_null',
  'no_operands',
  'not_finite',
] as const;

export const calculateConfigSchema = z.strictObject({
  operator: z.enum(CALCULATE_OPERATORS),
  operands: z.array(actionValueSchema).min(1).max(100),
  /** Used when the operation fails, and said so in the output. */
  default: z.number().optional(),
});
export type CalculateConfig = z.infer<typeof calculateConfigSchema>;

interface CalculateAnswer {
  readonly defaulted: boolean;
  readonly 'default-reason': string | null;
}

export const calculateOutputSchema = z
  .strictObject({
    value: personal(z.number().nullable()),
    defaulted: plain(z.boolean()),
    'default-reason': plain(z.enum(CALCULATE_DEFAULT_REASONS).nullable()),
  })
  .refine((value: CalculateAnswer) => value.defaulted === (value['default-reason'] !== null), {
    message: 'a defaulted value says why',
    path: ['default-reason'],
  });
export type CalculateOutput = z.infer<typeof calculateOutputSchema>;

/** C115.4 (public W20). */
export const UPDATE_VARIABLE_OPERATORS = ['set', 'unset', 'push', 'remove'] as const;

export const updateVariableConfigSchema = z.strictObject({
  name: workflowDeclaredNameSchema,
  operator: z.enum(UPDATE_VARIABLE_OPERATORS),
  value: actionValueSchema.optional(),
});
export type UpdateVariableConfig = z.infer<typeof updateVariableConfigSchema>;

/** The value stays in the run's sealed variables; the output says what happened to it. */
export const updateVariableOutputSchema = z.strictObject({
  name: plain(workflowDeclaredNameSchema),
  operator: plain(z.enum(UPDATE_VARIABLE_OPERATORS)),
  /** Whether the variable holds a value now. */
  held: plain(z.boolean()),
});
export type UpdateVariableOutput = z.infer<typeof updateVariableOutputSchema>;

export const runWorkflowConfigSchema = z.strictObject({
  'workflow-id': actionReferenceSchema,
  version: workflowModuleVersionSchema,
  inputs: actionValueMapSchema.optional(),
  /** C119.9 (ours). */
  'wait-for-completion': z.boolean().optional(),
});
export type RunWorkflowConfig = z.infer<typeof runWorkflowConfigSchema>;

export const runWorkflowOutputSchema = z.strictObject({
  'workflow-run-id': plain(z.string().regex(/^wfr_/)),
  status: plain(z.enum(WORKFLOW_RUN_STATUSES)),
  /** `null` until a waited run ends. Masked like any run's outputs (C120.6). */
  outputs: personal(actionValueSchema.nullable()),
});
export type RunWorkflowOutput = z.infer<typeof runWorkflowOutputSchema>;

/** C118.3 (public W5). */
export const SCHEDULE_UNITS = ['minutes', 'hours', 'days'] as const;
export const SCHEDULE_DIRECTIONS = ['before', 'after'] as const;

export const scheduleWorkflowConfigSchema = z.strictObject({
  'workflow-id': actionReferenceSchema,
  'subject-id': actionReferenceSchema.optional(),
  /** `run-time`, or a path to a date field of an object. */
  'base-time': actionReferenceSchema,
  offset: z.int().min(0).max(1_000_000),
  units: z.enum(SCHEDULE_UNITS),
  direction: z.enum(SCHEDULE_DIRECTIONS),
  inputs: actionValueMapSchema.optional(),
});
export type ScheduleWorkflowConfig = z.infer<typeof scheduleWorkflowConfigSchema>;

export const scheduleWorkflowOutputSchema = z.strictObject({
  'scheduled-run-id': plain(z.string().min(1).max(64)),
  'run-at': plain(z.iso.datetime({ offset: true })),
});
export type ScheduleWorkflowOutput = z.infer<typeof scheduleWorkflowOutputSchema>;
