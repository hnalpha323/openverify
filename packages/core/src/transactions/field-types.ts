/**
 * Transaction field schemas (plan C104): the fifteen public wire types, their caps and the
 * status and relation rules, as constants. They live in core because the pure engine of this
 * folder reads them, and contracts re-exports them. The engine's rules are `transaction-schemas`'.
 */
import { z } from 'zod';

/** C104.2: the fifteen public field-schema wire types. */
export const FIELD_SCHEMA_TYPES = [
  'string',
  'integer',
  'number',
  'boolean',
  'datetime',
  'email-address',
  'date',
  'choices',
  'multi-choices',
  'array',
  'hash',
  'file',
  'platform-file',
  'json',
  'relation-schema',
] as const;
export const fieldSchemaTypeSchema = z.enum(FIELD_SCHEMA_TYPES);
export type FieldSchemaType = z.infer<typeof fieldSchemaTypeSchema>;

/** C104.2: every field's key: 1-64 characters. */
export const FIELD_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/** C104.2: `none` is redactable; `never` keeps the field through redaction (P21). */
export const FIELD_REDACTION_POLICIES = ['none', 'never'] as const;
export const fieldRedactionPolicySchema = z.enum(FIELD_REDACTION_POLICIES);

/** C104.2: `write_once` refuses a second write with 409 `field_write_once`. */
export const FIELD_WRITE_POLICIES = ['none', 'write_once'] as const;
export const fieldWritePolicySchema = z.enum(FIELD_WRITE_POLICIES);

/** C104.2 (P21): the types `redaction-policy: never` is refused on, which can hold personal data. */
export const FIELD_TYPES_NEVER_REFUSED: readonly FieldSchemaType[] = Object.freeze([
  'email-address',
  'file',
  'platform-file',
  'relation-schema',
  'hash',
  'json',
  'array',
]);

/** C105.4: the types with one value to key: an equality index, so never a list or a nested value. */
export const FIELD_TYPES_SEARCHABLE: readonly FieldSchemaType[] = Object.freeze([
  'string',
  'integer',
  'number',
  'boolean',
  'datetime',
  'email-address',
  'date',
  'choices',
]);

/**
 * C165.3 (Workflow 9B; the default taken at the 7B refresh): the types a top-level field may mark
 * `filterable`, read through a plaintext projection (`filter[fields.<key>]` on `GET /transactions`).
 * A `string` field is filterable only when it is also `searchable`, through the existing HMAC
 * equality index (`transaction_field_keys`), so no second index exists.
 */
export const FIELD_TYPES_FILTERABLE: readonly FieldSchemaType[] = Object.freeze([
  'choices',
  'boolean',
  'integer',
  'number',
  'date',
]);

/** C104.2: a `string` field's `sanitize`: trims and removes control characters. */
export const FIELD_SANITIZERS = ['html'] as const;

/** C104.2 (H22): the public targets of a `relation-schema` field. */
export const RELATION_SCHEMA_TARGETS = [
  'document-generic',
  'document-government-id',
  'document-government-id-nfc',
  'document-mdoc',
  'document-qr-code',
  'selfie',
] as const;
export const relationSchemaTargetSchema = z.enum(RELATION_SCHEMA_TARGETS);
export type RelationSchemaTarget = z.infer<typeof relationSchemaTargetSchema>;

/**
 * C104.2 (H22): the verification type a target's `ver_` id must be. `document-mdoc` and
 * `document-qr-code` have no producer, so they answer 422 `relation_target_unsupported`.
 */
export const RELATION_TARGET_VERIFICATION_TYPES = Object.freeze({
  'document-generic': 'document',
  'document-government-id': 'government_id',
  'document-government-id-nfc': 'government_id_nfc',
  selfie: 'selfie',
} as const);

export const RELATION_TARGETS_UNSUPPORTED: readonly RelationSchemaTarget[] = Object.freeze([
  'document-mdoc',
  'document-qr-code',
]);

/** C104.5: what a relation schema points at, and how many. */
export const RELATION_SCHEMA_OBJECTS = ['account', 'transaction'] as const;
export const RELATION_SCHEMA_CARDINALITIES = ['one', 'many'] as const;

/** C104.3 (P22): exactly these keywords; every other one is refused. */
export const JSON_SCHEMA_ALLOWED_KEYWORDS = [
  'type',
  'properties',
  'required',
  'items',
  'enum',
  'const',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'additionalProperties',
  'title',
  'description',
] as const;

/** C104.2-C104.5, C105: the caps (ours). */
export const TRANSACTION_LIMITS = Object.freeze({
  fieldKeyLength: 64,
  fieldLabelLength: 255,
  fieldsPerVersion: 100,
  /** Through `hash` and `array`. */
  nestingLevels: 3,
  searchableFields: 20,
  /** `string`: the default and the ceiling of `max-char-length`. */
  stringDefaultLength: 255,
  stringMaxLength: 1024,
  options: 200,
  /** `array`: `max-items` is required and at most this (P22). */
  arrayItems: 1000,
  /** `file`: the defaults of `max-file-size-bytes` and `min-file-size-bytes`. */
  fileDefaultMaxBytes: 10_000_000,
  fileDefaultMinBytes: 1,
  /**
   * `file`: the ceiling of both sizes (provisional; owner decision 11 after Workflow 7B). The basis
   * is the importer's `IMPORT_LIMITS.fileBytes`: an upload is held in memory.
   */
  fileMaxBytes: 20_000_000,
  /** `json`: the schema's and the value's size and depth (P22). */
  jsonSchemaBytes: 16_384,
  jsonSchemaDepth: 10,
  jsonValueBytes: 65_536,
  jsonValueDepth: 10,
  sourceKeyPathSegments: 3,
  statuses: 50,
  statusLength: 64,
  relationSchemas: 20,
  relatedObjects: 100,
  /** `add-objects` and `remove-objects`. */
  objectIds: 100,
  labelLength: 64,
  modelVersionLength: 64,
  referenceIdLength: 255,
  retentionDays: 3650,
});

/** C104.5: a status, with the spaces the public examples use. */
export const TRANSACTION_STATUS_PATTERN = /^[a-z0-9][a-z0-9 _-]*$/;

/** C104.5: reserved, always first. */
export const TRANSACTION_RESERVED_STATUS = 'created';

/** C104.5: what a new type starts with. */
export const DEFAULT_TRANSACTION_STATUSES = Object.freeze([
  TRANSACTION_RESERVED_STATUS,
  'approved',
  'declined',
  'needs review',
] as const);

/** C104.1: as C71. */
export const TRANSACTION_TYPE_VERSION_STATUSES = ['draft', 'published', 'superseded'] as const;
export const transactionTypeVersionStatusSchema = z.enum(TRANSACTION_TYPE_VERSION_STATUSES);
export type TransactionTypeVersionStatus = z.infer<typeof transactionTypeVersionStatusSchema>;

export const TRANSACTION_TYPE_STATUSES = ['active', 'archived'] as const;
export const transactionTypeStatusSchema = z.enum(TRANSACTION_TYPE_STATUSES);
export type TransactionTypeStatus = z.infer<typeof transactionTypeStatusSchema>;
