/**
 * C104.2: the field-schema union, a discriminated union on `type`. These are the wire shapes: each
 * field's own members and their bounds. The rules across a version (the caps, `never`, defaults
 * that must be options, unsupported targets) are the engine's (`engine.ts`), which `transaction-schemas`
 * builds, because they answer problem codes a schema cannot.
 */
import { z } from 'zod';
import {
  FIELD_KEY_PATTERN,
  FIELD_SANITIZERS,
  RELATION_SCHEMA_CARDINALITIES,
  RELATION_SCHEMA_OBJECTS,
  TRANSACTION_LIMITS,
  fieldRedactionPolicySchema,
  fieldWritePolicySchema,
  relationSchemaTargetSchema,
} from './field-types.js';

const timestamp = z.iso.datetime();

/** C104.2: the config every field has. */
const SHARED_CONFIG = {
  required: z.boolean().optional(),
  'archived-at': timestamp.nullable().optional(),
  'deactivated-at': timestamp.nullable().optional(),
  /** A read-only alias: at most 3 dot-separated segments, read as own properties (P22). */
  'source-key-path': z.string().min(1).max(200).nullable().optional(),
  'redaction-policy': fieldRedactionPolicySchema.optional(),
  'write-policy': fieldWritePolicySchema.optional(),
  /** Ours: an equality index (C105.4). */
  searchable: z.boolean().optional(),
  /** C165.3 (Workflow 9B): `filter[fields.<key>]` on the transaction list; top-level only. */
  filterable: z.boolean().optional(),
  /** C104.2 (P21): needed for `redaction-policy: never` on a `string` field. */
  'never-redact-acknowledged': z.boolean().optional(),
};

const key = z.string().min(1).max(TRANSACTION_LIMITS.fieldKeyLength).regex(FIELD_KEY_PATTERN);
const label = z.string().min(1).max(TRANSACTION_LIMITS.fieldLabelLength);

const SHARED = { key, label };

export interface FieldSchemaConfig {
  readonly required?: boolean | undefined;
  readonly 'archived-at'?: string | null | undefined;
  readonly 'deactivated-at'?: string | null | undefined;
  readonly 'source-key-path'?: string | null | undefined;
  readonly 'redaction-policy'?: 'none' | 'never' | undefined;
  readonly 'write-policy'?: 'none' | 'write_once' | undefined;
  readonly searchable?: boolean | undefined;
  readonly filterable?: boolean | undefined;
  readonly 'never-redact-acknowledged'?: boolean | undefined;
}

/** C104.2: a field schema; `array` and `hash` hold more of them. */
export type FieldSchema = Readonly<Record<string, unknown>> & {
  readonly type: string;
  readonly key: string;
  readonly label: string;
  readonly 'default-value'?: unknown;
  readonly config?: FieldSchemaConfig & Readonly<Record<string, unknown>>;
};

const finite = z.number().refine(Number.isFinite, 'must be finite');
const safeInteger = z.int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const isoDate = z.iso.date();

const stringField = z.strictObject({
  type: z.literal('string'),
  ...SHARED,
  'default-value': z.string().max(TRANSACTION_LIMITS.stringMaxLength).optional(),
  config: z
    .strictObject({
      ...SHARED_CONFIG,
      'max-char-length': z.int().min(1).max(TRANSACTION_LIMITS.stringMaxLength).optional(),
      sanitize: z.array(z.enum(FIELD_SANITIZERS)).max(1).optional(),
    })
    .optional(),
});

const integerField = z.strictObject({
  type: z.literal('integer'),
  ...SHARED,
  'default-value': safeInteger.optional(),
  config: z
    .strictObject({ ...SHARED_CONFIG, min: safeInteger.optional(), max: safeInteger.optional() })
    .optional(),
});

const numberField = z.strictObject({
  type: z.literal('number'),
  ...SHARED,
  'default-value': finite.optional(),
  config: z
    .strictObject({ ...SHARED_CONFIG, min: finite.optional(), max: finite.optional() })
    .optional(),
});

const booleanField = z.strictObject({
  type: z.literal('boolean'),
  ...SHARED,
  'default-value': z.boolean().optional(),
  config: z.strictObject(SHARED_CONFIG).optional(),
});

const datetimeField = z.strictObject({
  type: z.literal('datetime'),
  ...SHARED,
  'default-value': timestamp.optional(),
  config: z.strictObject(SHARED_CONFIG).optional(),
});

const emailField = z.strictObject({
  type: z.literal('email-address'),
  ...SHARED,
  'default-value': z.string().max(254).optional(),
  config: z.strictObject(SHARED_CONFIG).optional(),
});

const dateField = z.strictObject({
  type: z.literal('date'),
  ...SHARED,
  'default-value': isoDate.optional(),
  config: z
    .strictObject({
      ...SHARED_CONFIG,
      'min-date': isoDate.optional(),
      'max-date': isoDate.optional(),
    })
    .optional(),
});

const optionText = z.string().min(1).max(TRANSACTION_LIMITS.fieldLabelLength);

const CHOICE_CONFIG = {
  ...SHARED_CONFIG,
  options: z.array(optionText).min(1).max(TRANSACTION_LIMITS.options),
  'option-labels': z.record(optionText, optionText).optional(),
  'allow-empty': z.boolean().optional(),
};

const choicesField = z.strictObject({
  type: z.literal('choices'),
  ...SHARED,
  'default-value': optionText.optional(),
  config: z.strictObject(CHOICE_CONFIG),
});

const multiChoicesField = z.strictObject({
  type: z.literal('multi-choices'),
  ...SHARED,
  'default-value': z.array(optionText).max(TRANSACTION_LIMITS.options).optional(),
  config: z.strictObject(CHOICE_CONFIG),
});

const arrayField = z.strictObject({
  type: z.literal('array'),
  ...SHARED,
  'default-value': z.array(z.unknown()).optional(),
  config: z.strictObject({
    ...SHARED_CONFIG,
    get 'item-schema'(): z.ZodType<FieldSchema> {
      return fieldSchemaSchema;
    },
    /** Required, at most 1,000 (P22). */
    'max-items': z.int().min(1).max(TRANSACTION_LIMITS.arrayItems),
  }),
});

const hashField = z.strictObject({
  type: z.literal('hash'),
  ...SHARED,
  'default-value': z.record(z.string(), z.unknown()).optional(),
  config: z.strictObject({
    ...SHARED_CONFIG,
    get 'item-schemas'(): z.ZodType<readonly FieldSchema[]> {
      return z.array(fieldSchemaSchema).min(1).max(TRANSACTION_LIMITS.fieldsPerVersion);
    },
    'ignore-unknown-keys': z.boolean().optional(),
  }),
});

const fileField = z.strictObject({
  type: z.literal('file'),
  ...SHARED,
  config: z
    .strictObject({
      ...SHARED_CONFIG,
      'max-file-size-bytes': z.int().min(1).max(TRANSACTION_LIMITS.fileMaxBytes).optional(),
      'min-file-size-bytes': z.int().min(0).max(TRANSACTION_LIMITS.fileMaxBytes).optional(),
      /** Checked against the bytes' signature. */
      'supported-mime-types': z.array(z.string().min(3).max(255)).max(50).optional(),
      'page-count-limit-enabled': z.boolean().optional(),
      'page-count-min': z.int().min(1).optional(),
      'page-count-max': z.int().min(1).optional(),
    })
    .optional(),
});

const platformFileField = z.strictObject({
  type: z.literal('platform-file'),
  ...SHARED,
  config: z.strictObject(SHARED_CONFIG).optional(),
});

const jsonField = z.strictObject({
  type: z.literal('json'),
  ...SHARED,
  'default-value': z.unknown().optional(),
  config: z.strictObject({
    ...SHARED_CONFIG,
    /** The restricted subset of C104.3, checked by the engine's keyword allowlist. */
    'json-schema': z.record(z.string(), z.unknown()),
  }),
});

const relationField = z.strictObject({
  type: z.literal('relation-schema'),
  ...SHARED,
  config: z.strictObject({ ...SHARED_CONFIG, target: relationSchemaTargetSchema }),
});

/** C104.2: the discriminated union of the fifteen types. */
export const fieldSchemaSchema = z.discriminatedUnion('type', [
  stringField,
  integerField,
  numberField,
  booleanField,
  datetimeField,
  emailField,
  dateField,
  choicesField,
  multiChoicesField,
  arrayField,
  hashField,
  fileField,
  platformFileField,
  jsonField,
  relationField,
]) as unknown as z.ZodType<FieldSchema>;

/** C104.5: a relation a transaction type declares. */
export const relationSchemaSchema = z.strictObject({
  key,
  target: z.enum(RELATION_SCHEMA_OBJECTS),
  cardinality: z.enum(RELATION_SCHEMA_CARDINALITIES),
});
export type RelationSchema = z.infer<typeof relationSchemaSchema>;
