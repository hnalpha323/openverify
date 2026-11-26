/**
 * C152 (decision 10): the closed list of `action` step kinds. No code and no HTTPS request: those
 * stay in Phase 8 workflows behind their sandbox and guard, reached through `run_workflow`.
 */
import { z } from 'zod';
import { isValidTag, normalizeTag } from '@openverify/core';
import { stepIdSchema } from '../../flow.js';
import {
  FIELD_KEY_PATTERN,
  FLOW_V2_CAPS,
  fieldKeySchema,
  publicIdSchema,
  valueSourceSchema,
} from './common.js';

/** C152.2: bounded at 30 s by default and 300 s at most, with a mandatory `error` edge. */
export const RUN_WORKFLOW_TIMEOUT = Object.freeze({ default: 30, min: 1, max: 300 });

const inputNameSchema = z.string().regex(FIELD_KEY_PATTERN, 'must be a snake_case input name');

export const runWorkflowActionSchema = z
  .strictObject({
    kind: z.literal('run_workflow'),
    workflowId: publicIdSchema('wfl'),
    /** Resolved on entry and recorded (C152.2). */
    version: z.union([z.literal('latest-published'), publicIdSchema('wfv')]),
    /** The declared inputs of the target's `trigger-flow` trigger, each a scope path or literal. */
    inputs: z
      .record(inputNameSchema, valueSourceSchema)
      .refine(
        (inputs) => Object.keys(inputs).length <= FLOW_V2_CAPS.mappingEntries,
        'too many inputs',
      )
      .optional(),
    timeoutSeconds: z.int().min(RUN_WORKFLOW_TIMEOUT.min).max(RUN_WORKFLOW_TIMEOUT.max).optional(),
  })
  .meta({ id: 'RunWorkflowAction' });

/** The extracted attributes `FLOW_SCOPE_EXTRACTIONS` names, in the scope's kebab-case. */
const extractionAttributeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,63}$/, 'must be an attribute');

export const copyExtractionsActionSchema = z
  .strictObject({
    kind: z.literal('copy_extractions'),
    /** A verification step that dominates this action (a graph rule). */
    fromStep: stepIdSchema,
    /** Field key to the extracted attribute it receives; types checked at publish (C152.3). */
    mapping: z
      .record(fieldKeySchema, extractionAttributeSchema)
      .refine((mapping) => Object.keys(mapping).length >= 1, 'map at least one field')
      .refine(
        (mapping) => Object.keys(mapping).length <= FLOW_V2_CAPS.mappingEntries,
        'too many fields',
      ),
  })
  .meta({ id: 'CopyExtractionsAction' });

export const updateAccountFieldsActionSchema = z
  .strictObject({
    kind: z.literal('update_account_fields'),
    /** Account field key to a scope path or literal; the account type validates it (C152.4). */
    mapping: z
      .record(fieldKeySchema, valueSourceSchema)
      .refine((mapping) => Object.keys(mapping).length >= 1, 'map at least one field')
      .refine(
        (mapping) => Object.keys(mapping).length <= FLOW_V2_CAPS.mappingEntries,
        'too many fields',
      ),
  })
  .meta({ id: 'UpdateAccountFieldsAction' });

/** A literal tag name already in its normal form (Phase 8 C115.6: never a tag from a value). */
const tagSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(
    (tag) => isValidTag(tag) && normalizeTag(tag) === tag,
    'must be a tag in its normal form',
  );

export const tagInquiryActionSchema = z
  .strictObject({
    kind: z.literal('tag_inquiry'),
    add: z.array(tagSchema).max(FLOW_V2_CAPS.tagsPerAction).optional(),
    remove: z.array(tagSchema).max(FLOW_V2_CAPS.tagsPerAction).optional(),
  })
  .refine((action) => (action.add?.length ?? 0) + (action.remove?.length ?? 0) > 0, {
    message: 'add or remove at least one tag',
    path: ['add'],
  })
  .meta({ id: 'TagInquiryAction' });

export const flagForReviewActionSchema = z
  .strictObject({
    kind: z.literal('flag_for_review'),
    /** Recorded and shown in the console, never to the person (C152.6). */
    reasonCode: z
      .string()
      // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
      .regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/, 'must be snake_case')
      .max(64),
  })
  .meta({ id: 'FlagForReviewAction' });

export const flowActionSchema = z.discriminatedUnion('kind', [
  runWorkflowActionSchema,
  copyExtractionsActionSchema,
  updateAccountFieldsActionSchema,
  tagInquiryActionSchema,
  flagForReviewActionSchema,
]);

export const FLOW_ACTION_KINDS = [
  'run_workflow',
  'copy_extractions',
  'update_account_fields',
  'tag_inquiry',
  'flag_for_review',
] as const;
export type FlowActionKind = (typeof FLOW_ACTION_KINDS)[number];
export type FlowAction = z.infer<typeof flowActionSchema>;
