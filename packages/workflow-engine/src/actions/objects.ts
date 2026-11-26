/**
 * C127.6-C127.9: accounts, transactions, relations, devices and the generic object actions. A
 * generic action names its `object-type` literally, because the grant has to be known at publish
 * (C121.2) while the object id is usually a template. `createWorkflowActionEntries` holds that member
 * to the object-type table, so Workflow 8B adds `case` by passing a row (F33).
 */
import { deviceTrustReasonSchema } from '@openverify/contracts';
import { z } from 'zod';
import {
  actionOutcomeSchema,
  actionReferenceSchema,
  actionTemplateSchema,
  actionValueMapSchema,
  actionValueSchema,
  adverseConfigShape,
  decisionCommentTemplateSchema,
  decisionFollowsOutcome,
  decisionIdSchema,
  personal,
  plain,
} from './common.js';

const DECISION_RULE = { message: 'a step that changed nothing made no decision' };

const accountIdSchema = z.string().regex(/^acc_/);
const transactionIdSchema = z.string().regex(/^txn_/);
const objectIdSchema = z.string().min(1).max(64);

/** A type of the object-type table; the catalogue narrows it (F33). */
export const actionObjectTypeNameSchema = z
  .string()
  .regex(/^[a-z][a-z-]{0,31}$/, 'must be an object type');

export const objectConfigShape = {
  'object-type': actionObjectTypeNameSchema,
  'object-id': actionReferenceSchema,
};

// ---------------------------------------------------------------------------------------------
// Accounts (C127.6)

export const findOrCreateAccountConfigSchema = z.strictObject({
  'account-type-id': actionReferenceSchema,
  /** C127.6: `reference-id` or a declared identifier field, with a concatenable value. */
  identifier: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('reference-id'), value: actionTemplateSchema }),
    z.strictObject({
      kind: z.literal('field'),
      'field-key': actionReferenceSchema,
      value: actionTemplateSchema,
    }),
  ]),
  fields: actionValueMapSchema.optional(),
});
export type FindOrCreateAccountConfig = z.infer<typeof findOrCreateAccountConfigSchema>;

/** C127.6: it never merges accounts, so the answer is one of these two. */
export const findOrCreateAccountOutputSchema = z.strictObject({
  'account-id': plain(accountIdSchema),
  outcome: plain(z.enum(['found', 'created'])),
});
export type FindOrCreateAccountOutput = z.infer<typeof findOrCreateAccountOutputSchema>;

// ---------------------------------------------------------------------------------------------
// Transactions and relations (C127.7)

export const createTransactionConfigSchema = z.strictObject({
  'transaction-type-id': actionReferenceSchema,
  /** Validated by the pinned type version. */
  fields: actionValueMapSchema,
  'reference-id': actionReferenceSchema.optional(),
});
export type CreateTransactionConfig = z.infer<typeof createTransactionConfigSchema>;

export const createTransactionOutputSchema = z.strictObject({
  'transaction-id': plain(transactionIdSchema),
  status: plain(z.string().min(1).max(64)),
  outcome: plain(actionOutcomeSchema),
});
export type CreateTransactionOutput = z.infer<typeof createTransactionOutputSchema>;

export const updateTransactionStatusConfigSchema = z.strictObject({
  'transaction-id': actionReferenceSchema,
  /**
   * A literal: whether the step is adverse depends on it (C122.1), so a value must not choose it.
   */
  status: z.string().min(1).max(64),
  comment: decisionCommentTemplateSchema.optional(),
  ...adverseConfigShape,
});
export type UpdateTransactionStatusConfig = z.infer<typeof updateTransactionStatusConfigSchema>;

export const updateTransactionStatusOutputSchema = z
  .strictObject({
    'transaction-id': plain(transactionIdSchema),
    status: plain(z.string().min(1).max(64)),
    outcome: plain(actionOutcomeSchema),
    'decision-id': plain(decisionIdSchema),
  })
  .refine(decisionFollowsOutcome, DECISION_RULE);
export type UpdateTransactionStatusOutput = z.infer<typeof updateTransactionStatusOutputSchema>;

/** Phase 5's relation for an account, C105's for a transaction. */
export const RELATION_OBJECT_TYPES = ['account', 'transaction'] as const;

export const relationConfigSchema = z.strictObject({
  'object-type': z.enum(RELATION_OBJECT_TYPES),
  'object-id': actionReferenceSchema,
  /** An account's `relation-type`, or a transaction's `relation-schema-key`. */
  'relation-key': z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/, 'must be a relation key'),
  'target-id': actionReferenceSchema,
});
export type RelationConfig = z.infer<typeof relationConfigSchema>;

export const relationOutputSchema = z.strictObject({
  'object-id': plain(objectIdSchema),
  'target-id': plain(objectIdSchema),
  outcome: plain(actionOutcomeSchema),
});
export type RelationOutput = z.infer<typeof relationOutputSchema>;

// ---------------------------------------------------------------------------------------------
// Trust Device (C127.9)

const trustKnown = (config: {
  readonly 'trust-reason'?: string | undefined;
  readonly untrust?: true | undefined;
}): boolean => (config['trust-reason'] === undefined) === (config.untrust === true);

export const trustDeviceConfigSchema = z
  .strictObject({
    'device-id': actionReferenceSchema,
    'trust-reason': deviceTrustReasonSchema.optional(),
    untrust: z.literal(true).optional(),
  })
  .refine(trustKnown, 'give a trust-reason to trust, or untrust: true to clear the mark');
export type TrustDeviceConfig = z.infer<typeof trustDeviceConfigSchema>;

export const trustDeviceOutputSchema = z.strictObject({
  'device-id': plain(z.string().regex(/^dev_/)),
  /** `null` after an untrust. */
  'trusted-at': plain(z.iso.datetime({ offset: true }).nullable()),
  outcome: plain(actionOutcomeSchema),
});
export type TrustDeviceOutput = z.infer<typeof trustDeviceOutputSchema>;

// ---------------------------------------------------------------------------------------------
// Tags, fetch, update, redact (C127.8)

/** C127.8: a tag name may never be built from a PII-tainted value (`pii_into_plain_sink`). */
const tagConfigShape = { ...objectConfigShape, tag: z.string().min(1).max(255) };

export const tagObjectConfigSchema = z.strictObject(tagConfigShape);
export type TagObjectConfig = z.infer<typeof tagObjectConfigSchema>;

export const removeTagConfigSchema = z.strictObject(tagConfigShape);
export type RemoveTagConfig = z.infer<typeof removeTagConfigSchema>;

export const copyTagsConfigSchema = z.strictObject({
  'from-object-type': actionObjectTypeNameSchema,
  'from-object-id': actionReferenceSchema,
  ...objectConfigShape,
});
export type CopyTagsConfig = z.infer<typeof copyTagsConfigSchema>;

export const tagOutputSchema = z.strictObject({
  'object-id': plain(objectIdSchema),
  outcome: plain(actionOutcomeSchema),
  'tag-count': plain(z.int().min(0)),
});
export type TagOutput = z.infer<typeof tagOutputSchema>;

export const fetchObjectConfigSchema = z.strictObject(objectConfigShape);
export type FetchObjectConfig = z.infer<typeof fetchObjectConfigSchema>;

/** C120.6: `object` is untyped here, so it is masked whole without PII visibility. */
export const fetchObjectOutputSchema = z.strictObject({
  'object-type': plain(actionObjectTypeNameSchema),
  'object-id': plain(objectIdSchema),
  object: personal(actionValueSchema),
});
export type FetchObjectOutput = z.infer<typeof fetchObjectOutputSchema>;

/** C127.8: the public operators. */
export const UPDATE_OBJECT_OPERATORS = ['set', 'unset', 'append', 'push', 'remove'] as const;

export const updateObjectConfigSchema = z.strictObject({
  ...objectConfigShape,
  /** A custom field, `tags` or a writable attribute of the table's row; read at publish. */
  field: z.string().min(1).max(128),
  operator: z.enum(UPDATE_OBJECT_OPERATORS),
  value: actionValueSchema.optional(),
  /** C122.1: archiving an account is adverse, so this step can need a basis. */
  ...adverseConfigShape,
});
export type UpdateObjectConfig = z.infer<typeof updateObjectConfigSchema>;

export const updateObjectOutputSchema = z.strictObject({
  'object-id': plain(objectIdSchema),
  outcome: plain(actionOutcomeSchema),
  'decision-id': plain(decisionIdSchema),
});
export type UpdateObjectOutput = z.infer<typeof updateObjectOutputSchema>;

export const redactObjectConfigSchema = z.strictObject(objectConfigShape);
export type RedactObjectConfig = z.infer<typeof redactObjectConfigSchema>;

/** C127.8, outcome 6: a redacted subject reads `no_change`. */
export const redactObjectOutputSchema = z.strictObject({
  'object-id': plain(objectIdSchema),
  outcome: plain(actionOutcomeSchema),
});
export type RedactObjectOutput = z.infer<typeof redactObjectOutputSchema>;
